import { createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage } from '@napi-rs/canvas';

const CARD_W = 358;
const CARD_H = 500;
const CARDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/cards');
const PACK_BANNER_FILE = path.join(CARDS_DIR, 'pokemon-pack-shop-banner.png');

export function loadPackBanner() {
  return readFile(PACK_BANNER_FILE);
}

function drawCard(ctx, card, image, x, y, scale = 1) {
  const w = CARD_W * scale;
  const h = CARD_H * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.drawImage(image, 0, 0, w, h);
  ctx.restore();
}

export async function generateCardSheet(cards, options = {}) {
  const columns = Math.max(1, options.columns ?? cards.length);
  const cardWidth = options.cardWidth ?? CARD_W;
  const cardHeight = Math.round(CARD_H * (cardWidth / CARD_W));
  const gap = options.gap ?? 24;
  const rows = Math.ceil(cards.length / columns);
  const width = Math.min(cards.length, columns) * cardWidth + (Math.min(cards.length, columns) + 1) * gap;
  const height = rows * cardHeight + (rows + 1) * gap;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);
  const images = await Promise.all(cards.map(async card => {
    const file = path.join(CARDS_DIR, card.artFile);
    return loadImage(await readFile(file));
  }));
  cards.forEach((card, index) => drawCard(
    ctx,
    card,
    images[index],
    gap + (index % columns) * (cardWidth + gap),
    gap + Math.floor(index / columns) * (cardHeight + gap),
    cardWidth / CARD_W,
  ));
  return canvas.toBuffer('image/png');
}

export async function generatePokedexSheet(cards, ownedKeys, options = {}) {
  const columns = options.columns ?? 5;
  const gap = 18;
  const cardWidth = 220;
  const cardHeight = Math.round(CARD_H * (cardWidth / CARD_W));
  const rows = Math.ceil(cards.length / columns);
  const width = columns * cardWidth + (columns + 1) * gap;
  const height = rows * cardHeight + (rows + 1) * gap;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, width, height);

  const images = await Promise.all(cards.map(async card => {
    const file = path.join(CARDS_DIR, card.artFile);
    return loadImage(await readFile(file));
  }));

  cards.forEach((card, index) => {
    const x = gap + (index % columns) * (cardWidth + gap);
    const y = gap + Math.floor(index / columns) * (cardHeight + gap);
    const unlocked = ownedKeys.has(card.key);
    ctx.save();
    if (!unlocked) ctx.globalAlpha = 0.3;
    ctx.drawImage(images[index], x, y, cardWidth, cardHeight);
    ctx.restore();
    if (!unlocked) {
      ctx.save();
      ctx.fillStyle = 'rgba(5, 8, 18, 0.48)';
      ctx.fillRect(x, y, cardWidth, cardHeight);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 92px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x + cardWidth / 2, y + cardHeight / 2);
      ctx.restore();
    }
  });
  return canvas.toBuffer('image/png');
}