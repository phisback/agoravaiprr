import { askAI } from './aiManager.js';

const CARTESIA_API_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = process.env.CARTESIA_VERSION?.trim() || '2026-03-01';
const CARTESIA_MODEL = process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5';
const CARTESIA_LANGUAGE = process.env.CARTESIA_LANGUAGE?.trim() || 'pt';
const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID?.trim()
  || 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4';
const CARTESIA_TIMEOUT_MS = Number(process.env.CARTESIA_TTS_TIMEOUT_MS) > 0
  ? Number(process.env.CARTESIA_TTS_TIMEOUT_MS)
  : 60_000;

const MAX_TTS_CHUNK_LENGTH = 1_800;
const MAX_SPEECH_LENGTH = 1_500;

export function isVoiceConfigured() {
  return process.env.VOICE_TTS_DISABLED?.trim().toLowerCase() !== 'true'
    && Boolean(process.env.CARTESIA_API_KEY?.trim());
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

async function synthesizeCartesia(text) {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('CARTESIA_API_KEY não configurada');
    error.code = 'CARTESIA_API_KEY_MISSING';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CARTESIA_TIMEOUT_MS);

  try {
    const response = await fetch(CARTESIA_API_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: CARTESIA_MODEL,
        transcript: text,
        voice: {
          mode: 'id',
          id: CARTESIA_VOICE_ID,
        },
        output_format: {
          container: 'mp3',
          sample_rate: 44_100,
          bit_rate: 128_000,
        },
        language: CARTESIA_LANGUAGE,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      const error = new Error(`Cartesia respondeu ${response.status}: ${details}`);
      error.code = `CARTESIA_HTTP_${response.status}`;
      throw error;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) {
      const error = new Error('Cartesia gerou um MP3 vazio');
      error.code = 'CARTESIA_EMPTY_AUDIO';
      throw error;
    }
    return audio;
  } catch (error) {
    if (error?.name === 'AbortError') {
      error.code = 'CARTESIA_TIMEOUT';
      error.message = 'Cartesia excedeu o tempo limite';
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function textToSpeech(text) {
  if (process.env.VOICE_TTS_DISABLED?.trim().toLowerCase() === 'true') {
    const error = new Error('VOICE_TTS_DISABLED está ativado');
    error.code = 'VOICE_TTS_DISABLED';
    throw error;
  }
  if (!process.env.CARTESIA_API_KEY?.trim()) {
    const error = new Error('CARTESIA_API_KEY não configurada');
    error.code = 'CARTESIA_API_KEY_MISSING';
    throw error;
  }

  const chunks = splitSpeechText(text);
  if (!chunks.length) {
    const error = new Error('Não há texto falável');
    error.code = 'EMPTY_SPEECH_TEXT';
    throw error;
  }

  return synthesizeCartesia(chunks[0]);
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