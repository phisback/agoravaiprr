import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { askAI } from './aiManager.js';

// Chatterbox é o motor principal: clona a voz usando o áudio autorizado de referência.
// O Edge TTS é mantido somente como fallback quando o modelo local falhar ou exceder o tempo.
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const CHATTERBOX_PYTHON = resolve(
  process.env.CHATTERBOX_PYTHON?.trim() || join(PROJECT_ROOT, '.venv', 'bin', 'python'),
);
const CHATTERBOX_SCRIPT = resolve(
  process.env.CHATTERBOX_SCRIPT?.trim() || join(PROJECT_ROOT, 'scripts', 'chatterbox_tts_worker.py'),
);
const CHATTERBOX_REFERENCE_AUDIO = resolve(
  process.env.CHATTERBOX_REFERENCE_AUDIO?.trim()
    || join(PROJECT_ROOT, 'assets', 'tts', 'chatterbox-reference.wav'),
);
const CHATTERBOX_CACHE_DIR = resolve(
  process.env.CHATTERBOX_CACHE_DIR?.trim()
    || join(PROJECT_ROOT, 'data', 'tts', 'chatterbox-cache'),
);
const CHATTERBOX_DEVICE = process.env.CHATTERBOX_DEVICE?.trim() || 'cpu';
const CHATTERBOX_LANGUAGE = process.env.CHATTERBOX_LANGUAGE?.trim() || 'pt';
const CHATTERBOX_T3_MODEL = process.env.CHATTERBOX_T3_MODEL?.trim() || 'v3';
const CHATTERBOX_SYNTHESIS_TIMEOUT_MS = Number(process.env.CHATTERBOX_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.CHATTERBOX_TTS_TIMEOUT_MS)
  : 300_000;

const EDGE_TTS_PYTHON = resolve(
  process.env.EDGE_TTS_PYTHON?.trim() || join(PROJECT_ROOT, '.venv', 'bin', 'python'),
);
const EDGE_TTS_SCRIPT = resolve(
  process.env.EDGE_TTS_SCRIPT?.trim() || join(PROJECT_ROOT, 'scripts', 'edge_tts_worker.py'),
);
const EDGE_TTS_TIMEOUT_MS = Number(process.env.EDGE_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.EDGE_TTS_TIMEOUT_MS)
  : 60_000;

const MAX_TTS_CHUNK_LENGTH = 1_800;
const MAX_SPEECH_LENGTH = 1_500;
const FFMPEG_TIMEOUT_MS = 45_000;

let chatterboxWorker = null;
let chatterboxWorkerError = null;
const chatterboxRequests = new Map();

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

function runProcess(command, args, timeoutMs) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr = [];
    let settled = false;
    let timer;

    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => finish(() => rejectProcess(error)));
    child.on('close', code => finish(() => {
      if (code !== 0) {
        const error = new Error(
          `${command} encerrou com código ${code}: ${Buffer.concat(stderr).toString().slice(0, 500)}`,
        );
        error.code = 'PROCESS_ERROR';
        rejectProcess(error);
        return;
      }
      resolveProcess();
    }));

    timer = setTimeout(() => {
      const error = new Error(`${command} excedeu o tempo limite`);
      error.code = 'PROCESS_TIMEOUT';
      child.kill('SIGKILL');
      finish(() => rejectProcess(error));
    }, timeoutMs);
  });
}

function rejectChatterboxRequests(error, worker) {
  if (worker && chatterboxWorker !== worker) return;
  if (chatterboxWorker === worker) chatterboxWorker = null;
  chatterboxWorkerError = error;
  for (const [requestId, request] of chatterboxRequests) {
    clearTimeout(request.timer);
    chatterboxRequests.delete(requestId);
    request.reject(error);
  }
}

function startChatterboxWorker() {
  if (chatterboxWorker && chatterboxWorker.exitCode === null && !chatterboxWorker.killed) {
    return chatterboxWorker;
  }

  const worker = spawn(CHATTERBOX_PYTHON, [CHATTERBOX_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHATTERBOX_REFERENCE_AUDIO,
      CHATTERBOX_DEVICE,
      CHATTERBOX_LANGUAGE,
      CHATTERBOX_T3_MODEL,
      HF_HOME: CHATTERBOX_CACHE_DIR,
      HUGGINGFACE_HUB_CACHE: join(CHATTERBOX_CACHE_DIR, 'hub'),
    },
  });
  chatterboxWorker = worker;
  chatterboxWorkerError = null;

  let outputBuffer = '';
  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', data => {
    outputBuffer += data;
    let newlineIndex = outputBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = outputBuffer.slice(0, newlineIndex).trim();
      outputBuffer = outputBuffer.slice(newlineIndex + 1);
      newlineIndex = outputBuffer.indexOf('\n');
      if (!line) continue;

      let result;
      try {
        result = JSON.parse(line);
      } catch {
        continue;
      }

      const request = chatterboxRequests.get(result.id);
      if (!request) continue;
      clearTimeout(request.timer);
      chatterboxRequests.delete(result.id);
      if (!result.ok) {
        const error = new Error(result.error || 'Chatterbox não conseguiu gerar o áudio');
        error.code = result.code || 'CHATTERBOX_SYNTHESIS_ERROR';
        request.reject(error);
      } else {
        request.resolve(result.outputPath);
      }
    }
  });

  let errorOutput = '';
  worker.stderr.setEncoding('utf8');
  worker.stderr.on('data', data => {
    errorOutput = `${errorOutput}${data}`.slice(-2_000);
  });
  worker.stdin.on('error', error => {
    error.code = error.code || 'CHATTERBOX_WORKER_WRITE_ERROR';
    rejectChatterboxRequests(error, worker);
  });
  worker.on('error', error => {
    error.code = error.code || 'CHATTERBOX_WORKER_ERROR';
    rejectChatterboxRequests(error, worker);
  });
  worker.on('close', code => {
    if (chatterboxWorker !== worker) return;
    const error = new Error(
      `Worker do Chatterbox encerrou com código ${code}${errorOutput ? `: ${errorOutput.trim()}` : ''}`,
    );
    error.code = 'CHATTERBOX_WORKER_CLOSED';
    rejectChatterboxRequests(error, worker);
  });

  return worker;
}

async function synthesizeChatterbox(text) {
  if (!await fileExists(CHATTERBOX_PYTHON)) {
    const error = new Error(`Python do Chatterbox não encontrado em ${CHATTERBOX_PYTHON}`);
    error.code = 'CHATTERBOX_PYTHON_MISSING';
    throw error;
  }
  if (!await fileExists(CHATTERBOX_SCRIPT)) {
    const error = new Error(`Worker do Chatterbox não encontrado em ${CHATTERBOX_SCRIPT}`);
    error.code = 'CHATTERBOX_SCRIPT_MISSING';
    throw error;
  }
  if (!await fileExists(CHATTERBOX_REFERENCE_AUDIO)) {
    const error = new Error(`Áudio de referência não encontrado em ${CHATTERBOX_REFERENCE_AUDIO}`);
    error.code = 'CHATTERBOX_REFERENCE_MISSING';
    throw error;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'savage-chatterbox-'));
  const wavPath = join(workDir, 'speech.wav');

  try {
    const worker = startChatterboxWorker();
    const requestId = randomUUID();
    const generatedPath = await new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        const error = new Error('Chatterbox excedeu o tempo limite');
        error.code = 'CHATTERBOX_TIMEOUT';
        rejectChatterboxRequests(error, worker);
        if (worker.exitCode === null && !worker.killed) worker.kill('SIGKILL');
        if (chatterboxRequests.has(requestId)) {
          chatterboxRequests.delete(requestId);
          rejectRequest(error);
        }
      }, CHATTERBOX_SYNTHESIS_TIMEOUT_MS);

      chatterboxRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });

      if (worker.exitCode !== null || worker.killed || !worker.stdin.writable) {
        const error = chatterboxWorkerError || new Error('Worker do Chatterbox não está disponível');
        error.code = error.code || 'CHATTERBOX_WORKER_WRITE_ERROR';
        rejectChatterboxRequests(error, worker);
        if (worker.exitCode === null && !worker.killed) worker.kill('SIGKILL');
        if (chatterboxRequests.has(requestId)) {
          clearTimeout(timer);
          chatterboxRequests.delete(requestId);
          rejectRequest(error);
        }
        return;
      }

      worker.stdin.write(JSON.stringify({
        id: requestId,
        text,
        outputPath: wavPath,
      }) + '\n', error => {
        if (!error) return;
        clearTimeout(timer);
        chatterboxRequests.delete(requestId);
        error.code = error.code || 'CHATTERBOX_WORKER_WRITE_ERROR';
        rejectRequest(error);
      });
    });

    const audio = await readFile(generatedPath);
    if (!audio.length) {
      const error = new Error('Chatterbox gerou um WAV vazio');
      error.code = 'CHATTERBOX_EMPTY_AUDIO';
      throw error;
    }
    return audio;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function synthesizeEdgeTts(text) {
  if (!await fileExists(EDGE_TTS_PYTHON)) {
    const error = new Error(`Python do Edge TTS não encontrado em ${EDGE_TTS_PYTHON}`);
    error.code = 'EDGE_TTS_PYTHON_MISSING';
    throw error;
  }
  if (!await fileExists(EDGE_TTS_SCRIPT)) {
    const error = new Error(`Worker do Edge TTS não encontrado em ${EDGE_TTS_SCRIPT}`);
    error.code = 'EDGE_TTS_SCRIPT_MISSING';
    throw error;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'savage-edge-tts-'));
  const requestPath = join(workDir, 'request.json');
  const outputPath = join(workDir, 'speech.mp3');

  try {
    await writeFile(requestPath, JSON.stringify({ text, outputPath }));
    await runProcess(EDGE_TTS_PYTHON, [EDGE_TTS_SCRIPT, requestPath], EDGE_TTS_TIMEOUT_MS);

    const audio = await readFile(outputPath);
    if (!audio.length) {
      const error = new Error('Edge TTS gerou um MP3 vazio');
      error.code = 'EDGE_TTS_EMPTY_AUDIO';
      throw error;
    }
    return audio;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildFfmpegArgs(wavPath, outputPath) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    wavPath,
    '-af',
    'anull',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    outputPath,
  ];
}

async function convertWavToMp3(wav) {
  const workDir = await mkdtemp(join(tmpdir(), 'savage-mp3-'));
  const wavPath = join(workDir, 'speech.wav');
  const outputPath = join(workDir, 'speech.mp3');

  try {
    await writeFile(wavPath, wav);
    await runProcess('ffmpeg', buildFfmpegArgs(wavPath, outputPath), FFMPEG_TIMEOUT_MS);
    const audio = await readFile(outputPath);
    if (!audio.length) {
      const error = new Error('FFmpeg gerou um MP3 vazio');
      error.code = 'EMPTY_MP3';
      throw error;
    }
    return audio;
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
  try {
    return await convertWavToMp3(await synthesizeChatterbox(chunk));
  } catch (chatterboxError) {
    console.error(
      `[CHATTERBOX] ${chatterboxError?.code || 'CHATTERBOX_ERROR'}:`,
      chatterboxError?.message ?? chatterboxError,
    );
    try {
      return await synthesizeEdgeTts(chunk);
    } catch (edgeError) {
      console.error(`[EDGE TTS] ${edgeError?.code || 'EDGE_TTS_ERROR'}:`, edgeError?.message ?? edgeError);
      throw edgeError;
    }
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