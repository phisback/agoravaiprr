import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { askAI } from './aiManager.js';

// A resposta de voz usa Piper localmente com uma voz neural brasileira.
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PIPER_BIN = resolve(
  process.env.PIPER_BIN?.trim() || join(PROJECT_ROOT, '.venv', 'bin', 'piper'),
);
const PIPER_MODEL = resolve(
  process.env.PIPER_MODEL_PATH?.trim()
    || join(PROJECT_ROOT, 'data', 'tts', 'piper', 'pt_BR-faber-medium.onnx'),
);
const MAX_TTS_CHUNK_LENGTH = 1_800;
const MAX_SPEECH_LENGTH = 1_500;
const PIPER_SYNTHESIS_TIMEOUT_MS = Number(process.env.VOICE_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.VOICE_TTS_TIMEOUT_MS)
  : 60_000;
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

function fileExists(path) {
  return stat(path).then(() => true).catch(() => false);
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

async function synthesizePiperChunk(chunk) {
  if (!await fileExists(PIPER_BIN)) {
    const error = new Error(`Executável do Piper não encontrado em ${PIPER_BIN}`);
    error.code = 'PIPER_BIN_MISSING';
    throw error;
  }
  if (!await fileExists(PIPER_MODEL)) {
    const error = new Error(`Modelo brasileiro do Piper não encontrado em ${PIPER_MODEL}`);
    error.code = 'PIPER_MODEL_MISSING';
    throw error;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'savage-piper-'));
  const wavPath = join(workDir, 'speech.wav');

  try {
    await runProcess(
      PIPER_BIN,
      [
        '--model', PIPER_MODEL,
        '--output_file', wavPath,
        '--sentence-silence', '0.12',
      ],
      chunk,
      PIPER_SYNTHESIS_TIMEOUT_MS,
    );

    const audio = await readFile(wavPath);
    if (!audio.length) {
      const error = new Error('Piper gerou um WAV vazio');
      error.code = 'PIPER_EMPTY_AUDIO';
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
  const wav = await synthesizePiperChunk(chunk);
  const outputPath = join(tmpdir(), `savage-piper-${randomUUID()}.mp3`);
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