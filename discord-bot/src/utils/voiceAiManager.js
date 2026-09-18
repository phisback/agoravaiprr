import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { askAI } from './aiManager.js';

// O Kokoro roda sem API externa e usa a voz feminina brasileira pf_dora.
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const KOKORO_PYTHON = resolve(
  process.env.KOKORO_PYTHON?.trim() || join(PROJECT_ROOT, '.venv', 'bin', 'python'),
);
const KOKORO_SCRIPT = resolve(
  process.env.KOKORO_SCRIPT?.trim() || join(PROJECT_ROOT, 'scripts', 'kokoro_tts_worker.py'),
);
const KOKORO_MODEL = resolve(
  process.env.KOKORO_MODEL_PATH?.trim()
    || join(PROJECT_ROOT, 'data', 'tts', 'kokoro', 'kokoro-v1.0.onnx'),
);
const KOKORO_VOICES = resolve(
  process.env.KOKORO_VOICES_PATH?.trim()
    || join(PROJECT_ROOT, 'data', 'tts', 'kokoro', 'voices-v1.0.bin'),
);
const MAX_TTS_CHUNK_LENGTH = 1_800;
const MAX_SPEECH_LENGTH = 1_500;
const KOKORO_VOICE = process.env.KOKORO_VOICE?.trim() || 'pf_dora';
const KOKORO_SPEED = Number(process.env.KOKORO_SPEED) > 0
  ? Number(process.env.KOKORO_SPEED)
  : 1.04;
const KOKORO_SAMPLE_RATE = 24_000;
const configuredPitch = Number(process.env.KOKORO_PITCH);
const KOKORO_PITCH = Number.isFinite(configuredPitch) && configuredPitch >= 0.9 && configuredPitch <= 1.35
  ? configuredPitch
  : 1.12;
const KOKORO_SYNTHESIS_TIMEOUT_MS = Number(process.env.VOICE_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.VOICE_TTS_TIMEOUT_MS)
  : 120_000;
const FFMPEG_TIMEOUT_MS = 45_000;

let kokoroWorker = null;
let kokoroWorkerError = null;
const kokoroRequests = new Map();

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

function rejectKokoroRequests(error, worker) {
  if (worker && kokoroWorker !== worker) return;
  if (kokoroWorker === worker) kokoroWorker = null;
  kokoroWorkerError = error;
  for (const [requestId, request] of kokoroRequests) {
    clearTimeout(request.timer);
    kokoroRequests.delete(requestId);
    request.reject(error);
  }
}

function startKokoroWorker() {
  if (kokoroWorker && kokoroWorker.exitCode === null && !kokoroWorker.killed) {
    return kokoroWorker;
  }

  const worker = spawn(KOKORO_PYTHON, [KOKORO_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      KOKORO_MODEL_PATH: KOKORO_MODEL,
      KOKORO_VOICES_PATH: KOKORO_VOICES,
      KOKORO_VOICE,
      KOKORO_SPEED: String(KOKORO_SPEED),
    },
  });
  kokoroWorker = worker;
  kokoroWorkerError = null;

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
      const request = kokoroRequests.get(result.id);
      if (!request) continue;
      clearTimeout(request.timer);
      kokoroRequests.delete(result.id);
      if (!result.ok) {
        const error = new Error(result.error || 'Kokoro não conseguiu gerar o áudio');
        error.code = result.code || 'KOKORO_SYNTHESIS_ERROR';
        request.reject(error);
      } else {
        request.resolve(result.outputPath);
      }
    }
  });

  let errorOutput = '';
  worker.stderr.setEncoding('utf8');
  worker.stderr.on('data', data => {
    errorOutput = `${errorOutput}${data}`.slice(-1_500);
  });
  worker.on('error', error => {
    error.code = error.code || 'KOKORO_WORKER_ERROR';
    rejectKokoroRequests(error, worker);
  });
  worker.on('close', code => {
    if (kokoroWorker !== worker) return;
    const error = new Error(
      `Worker do Kokoro encerrou com código ${code}${errorOutput ? `: ${errorOutput.trim()}` : ''}`,
    );
    error.code = 'KOKORO_WORKER_CLOSED';
    rejectKokoroRequests(error, worker);
  });

  return worker;
}

async function synthesizeKokoroChunk(chunk) {
  if (!await fileExists(KOKORO_PYTHON)) {
    const error = new Error(`Python do Kokoro não encontrado em ${KOKORO_PYTHON}`);
    error.code = 'KOKORO_PYTHON_MISSING';
    throw error;
  }
  if (!await fileExists(KOKORO_SCRIPT)) {
    const error = new Error(`Worker do Kokoro não encontrado em ${KOKORO_SCRIPT}`);
    error.code = 'KOKORO_SCRIPT_MISSING';
    throw error;
  }
  if (!await fileExists(KOKORO_MODEL) || !await fileExists(KOKORO_VOICES)) {
    const error = new Error('Modelo do Kokoro não encontrado. Faça o build do bot novamente.');
    error.code = 'KOKORO_MODEL_MISSING';
    throw error;
  }

  const worker = startKokoroWorker();
  const requestId = randomUUID();
  const workDir = await mkdtemp(join(tmpdir(), 'savage-kokoro-'));
  const wavPath = join(workDir, 'speech.wav');

  try {
    const generatedPath = await new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        kokoroRequests.delete(requestId);
        worker.kill('SIGKILL');
        const error = new Error('Kokoro excedeu o tempo limite');
        error.code = 'KOKORO_TIMEOUT';
        rejectRequest(error);
      }, KOKORO_SYNTHESIS_TIMEOUT_MS);
      kokoroRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });

      worker.stdin.write(JSON.stringify({
        id: requestId,
        text: chunk,
        outputPath: wavPath,
      }) + '\n', error => {
        if (!error) return;
        clearTimeout(timer);
        kokoroRequests.delete(requestId);
        error.code = error.code || 'KOKORO_WORKER_WRITE_ERROR';
        rejectRequest(error);
      });
    });

    const audio = await readFile(generatedPath);
    if (!audio.length) {
      const error = new Error('Kokoro gerou um WAV vazio');
      error.code = 'KOKORO_EMPTY_AUDIO';
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
        '-af',
        [
          `asetrate=${Math.round(KOKORO_SAMPLE_RATE * KOKORO_PITCH)}`,
          `aresample=${KOKORO_SAMPLE_RATE}`,
          `atempo=${(1 / KOKORO_PITCH).toFixed(6)}`,
        ].join(','),
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
  const wav = await synthesizeKokoroChunk(chunk);
  const outputPath = join(tmpdir(), `savage-kokoro-${randomUUID()}.mp3`);
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