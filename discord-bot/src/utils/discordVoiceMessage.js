import { spawn } from 'node:child_process';
import { MessageFlags, Routes } from 'discord.js';

const SAMPLE_RATE = 48_000;
const MAX_OGG_BYTES = 25 * 1024 * 1024;
const MAX_PCM_BYTES = 64 * 1024 * 1024;

function runFfmpeg(input, args, maxOutputBytes) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      ...args,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks = [];
    let outputBytes = 0;
    let stderr = '';
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      ffmpeg.kill('SIGKILL');
      reject(error);
    };

    ffmpeg.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        fail(new Error('A conversão de voz excedeu o limite de tamanho.'));
        return;
      }
      chunks.push(chunk);
    });
    ffmpeg.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    ffmpeg.stdin.on('error', error => {
      if (error.code !== 'EPIPE') fail(error);
    });
    ffmpeg.on('error', fail);
    ffmpeg.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`FFmpeg encerrou com código ${code}: ${stderr.trim() || 'erro desconhecido'}`));
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks, outputBytes));
    });

    ffmpeg.stdin.end(input);
  });
}

function buildWaveform(pcm, durationSeconds) {
  const sampleCount = Math.floor(pcm.length / 2);
  const pointCount = Math.max(1, Math.min(256, Math.ceil(durationSeconds * 10)));
  const rmsValues = new Array(pointCount);
  let peak = 0;

  for (let point = 0; point < pointCount; point += 1) {
    const start = Math.floor(point * sampleCount / pointCount);
    const end = Math.max(start + 1, Math.floor((point + 1) * sampleCount / pointCount));
    let sumSquares = 0;

    for (let sample = start; sample < end; sample += 1) {
      const value = pcm.readInt16LE(sample * 2) / 32_768;
      sumSquares += value * value;
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    rmsValues[point] = rms;
    if (rms > peak) peak = rms;
  }

  const scale = peak > 0 ? 255 / peak : 0;
  return Buffer.from(rmsValues.map(value => Math.min(255, Math.round(value * scale)))).toString('base64');
}

export async function prepareDiscordVoiceAttachment(mp3) {
  if (!Buffer.isBuffer(mp3) || mp3.length === 0) {
    throw new Error('O áudio recebido está vazio.');
  }

  const ogg = await runFfmpeg(mp3, [
    '-i', 'pipe:0',
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-c:a', 'libopus',
    '-b:a', '32k',
    '-vbr', 'off',
    '-application', 'voip',
    '-frame_duration', '20',
    '-f', 'ogg',
    'pipe:1',
  ], MAX_OGG_BYTES);

  const pcm = await runFfmpeg(ogg, [
    '-i', 'pipe:0',
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-acodec', 'pcm_s16le',
    '-f', 's16le',
    'pipe:1',
  ], MAX_PCM_BYTES);

  const durationSeconds = pcm.length / 2 / SAMPLE_RATE;
  if (!ogg.length || durationSeconds <= 0) {
    throw new Error('A conversão não produziu um áudio de voz válido.');
  }

  return {
    data: ogg,
    durationSeconds: Math.round(durationSeconds * 1_000) / 1_000,
    waveform: buildWaveform(pcm, durationSeconds),
  };
}

export async function sendVoiceMessageReply(message, mp3) {
  const voice = await prepareDiscordVoiceAttachment(mp3);

  try {
    return await message.client.rest.post(Routes.channelMessages(message.channelId), {
      body: {
        flags: MessageFlags.IsVoiceMessage,
        message_reference: {
          message_id: message.id,
          fail_if_not_exists: false,
        },
        allowed_mentions: {
          parse: [],
          replied_user: false,
        },
        attachments: [{
          id: 0,
          filename: 'voice-message.ogg',
          duration_secs: voice.durationSeconds,
          waveform: voice.waveform,
        }],
      },
      files: [{
        name: 'voice-message.ogg',
        data: voice.data,
        contentType: 'audio/ogg',
      }],
    });
  } catch (error) {
    const isPermissionError = error?.status === 403
      || Number(error?.code) === 50013
      || Number(error?.rawError?.code) === 50013;
    if (!isPermissionError) throw error;

    console.warn('[IA VOZ] Sem permissão para enviar mensagem de voz; enviando o MP3 como fallback.');
    return message.reply({ files: [{ attachment: mp3, name: 'audio.mp3' }] });
  }
}