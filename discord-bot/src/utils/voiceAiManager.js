import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { askAI } from './aiManager.js';

// A resposta de voz usa espeak-ng localmente: sem API key, cota ou modelo pesado.
const ESPEAK_VOICE = process.env.VOICE_TTS_VOICE?.trim() || 'pt-br';
const ESPEAK_SPEED = process.env.VOICE_TTS_SPEED?.trim() || '155';
const MAX_TTS_CHUNK_LENGTH = 1_800;
const MAX_SPEECH_LENGTH = 1_500;
const ESPEAK_SYNTHESIS_TIMEOUT_MS = Number(process.env.VOICE_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.VOICE_TTS_TIMEOUT_MS)
  : 30_000;
const FFMPEG_TIMEOUT_MS = 45_000;

export function isVoiceConfigured() {
  return process.env.VOICE_TTS_DISABLED?.trim().toLowerCase() !== 'true';
}

function splitSpeechText(text) {
  const normalized = String(text ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<@&?\d+>|<#\d+>|<@!?\d+>/g, '')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEECH_LENGTH);

  if (!normalized) return [];

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > MAX_TTS_CHUNK_LENGTH) {
    const boundary = remaining.slice(0, MAX_TTS_CHUNK_LENGTH + 1).lastIndexOf(' ');
    const cutAt = boundary > 40 ? boundary : MAX_TTS_CHUNK_LENGTH;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function runProcess(command, args, input, timeoutMs) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error(`${command} excedeu o tempo limite`);
      error.code = 'PROCESS_TIMEOUT';
      rejectProcess(error);
    }, timeoutMs);

    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      clearTimeout(timer);
      rejectProcess(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`${command} encerrou com código ${code}: ${Buffer.concat(stderr).toString().slice(0, 500)}`);
        error.code = 'PROCESS_ERROR';
        rejectProcess(error);
        return;
      }
      resolveProcess();
    });

    child.stdin.end(input);
  });
}

async function synthesizeEspeakChunk(chunk) {
  const workDir = await mkdtemp(join(tmpdir(), 'savage-espeak-'));
  const wavPath = join(workDir, 'speech.wav');

  try {
    await runProcess(
      'espeak-ng',
      ['-v', ESPEAK_VOICE, '-s', ESPEAK_SPEED, '-w', wavPath],
      chunk,
      ESPEAK_SYNTHESIS_TIMEOUT_MS,
    );

    const audio = await readFile(wavPath);
    if (!audio.length) {
      const error = new Error('espeak-ng gerou um WAV vazio');
      error.code = 'ESPEAK_EMPTY_AUDIO';
      throw error;
    }
    return audio;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function convertWavToMp3(wav, outputPath) {
  const workDir = await mkdtemp(join(tmpdir(), 'savage-mp3-'));
  const wavPath = join(workDir, 'speech.wav');
  try {
    await writeFile(wavPath, wav);
    await runProcess(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        wavPath,
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        outputPath,
      ],
      '',
      FFMPEG_TIMEOUT_MS,
    );
    return readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function textToSpeech(text) {
  if (!isVoiceConfigured()) {
    throw new Error('VOICE_TTS_DISABLED está ativado');
  }

  const chunks = splitSpeechText(text);
  if (!chunks.length) throw new Error('Não há texto falável');

  const chunk = chunks[0];
  const wav = await synthesizeEspeakChunk(chunk);
  const outputPath = join(tmpdir(), `savage-espeak-${randomUUID()}.mp3`);
  try {
    return await convertWavToMp3(wav, outputPath);
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

export async function answerWithVoice({ message, prompt }) {
  const answer = await askAI({
    guildId: message.guildId,
    userId: message.author.id,
    prompt,
    serverName: message.guild?.name,
    voice: true,
  });

  try {
    const audio = await textToSpeech(answer);
    return { answer, audio };
  } catch (error) {
    error.aiAnswer = answer;
    throw error;
  }
}