import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FONTS_DIR = join(__dirname, '../../fonts');
const TEMPLATE_PATH = join(__dirname, '../../assets/crash-card-template.png');

GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Regular.ttf')), 'CrashRegular');
GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Bold.ttf')), 'CrashBold');

const DESIGN_W = 1024;
const DESIGN_H = 576;
let templatePromise;

function getTemplate() {
  templatePromise ??= loadImage(TEMPLATE_PATH);
  return templatePromise;
}

function formatMultiplier(value) {
  return `${Number(value || 1).toFixed(2).replace('.', ',')}x`;
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function cover(ctx, x, y, width, height, color = '#0d0b17') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function chartPoint(multiplier, maxMultiplier, progress) {
  const safeMax = Math.max(2, maxMultiplier);
  const normalized = Math.min(1, Math.log(Math.max(1, multiplier)) / Math.log(safeMax));
  return {
    x: 105 + Math.max(0.02, progress) * 822,
    y: 432 - normalized * 214,
  };
}

function drawChartGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(221, 131, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = 198 + (234 / 5) * i;
    ctx.beginPath();
    ctx.moveTo(105, y);
    ctx.lineTo(927, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 8; i += 1) {
    const x = 105 + (822 / 8) * i;
    ctx.beginPath();
    ctx.moveTo(x, 198);
    ctx.lineTo(x, 432);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 147, 242, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(105, 198, 822, 234);
  ctx.restore();
}

function drawRocket(ctx, x, y, crashed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.42);
  ctx.shadowColor = crashed ? '#ff4f83' : '#ff86eb';
  ctx.shadowBlur = 18;
  ctx.fillStyle = crashed ? '#ff668f' : '#fff4ff';
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.bezierCurveTo(15, -7, 16, 10, 0, 22);
  ctx.bezierCurveTo(-16, 10, -15, -7, 0, -20);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#d62eb6';
  ctx.beginPath();
  ctx.arc(0, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffbaf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -5, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = crashed ? '#ff4f83' : '#ff7de4';
  ctx.beginPath();
  ctx.moveTo(-8, 15); ctx.lineTo(0, 36); ctx.lineTo(8, 15); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawCrashBurst(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ff5f9c';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff4f8d';
  ctx.shadowBlur = 16;
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 22, Math.sin(angle) * 22);
    ctx.lineTo(Math.cos(angle) * (44 + (i % 3) * 7), Math.sin(angle) * (44 + (i % 3) * 7));
    ctx.stroke();
  }
  ctx.fillStyle = '#ff709f';
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPill(ctx, x, y, width, height, label, color) {
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = 'rgba(18, 7, 27, 0.96)';
  ctx.fill();
  ctx.strokeStyle = `${color}cc`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 12px CrashBold';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y + height / 2 + 4);
  ctx.textAlign = 'left';
}

export async function generateCrashCard({
  multiplier = 1,
  crashAt = 2,
  status = 'playing',
  bet = 0,
  payout = 0,
  elapsedMs = 0,
}) {
  const template = await getTemplate();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, template.width, template.height);
  ctx.save();
  ctx.scale(template.width / DESIGN_W, template.height / DESIGN_H);

  const crashed = status === 'crashed';
  const cashed = status === 'cashed';
  const current = Math.max(1, Number(multiplier) || 1);
  const target = Math.max(2, Number(crashAt) || 2, current * 1.15);
  const progress = Math.min(0.96, Math.max(0.02, elapsedMs / 80_000));
  const point = chartPoint(current, target, progress);
  const accent = crashed ? '#ff6f9f' : cashed ? '#b5ffdb' : '#ff91ef';

  // Replace only the live status fields while preserving the supplied artwork.
  cover(ctx, 78, 78, 250, 25);
  ctx.fillStyle = crashed ? '#ffabc2' : cashed ? '#c5ffe3' : '#f4c8ff';
  ctx.font = '700 13px CrashBold';
  ctx.fillText(
    crashed ? 'A trajetória foi interrompida' : cashed ? 'Saque confirmado' : 'Acompanhe a subida e saia no seu tempo',
    80,
    96,
  );

  cover(ctx, 386, 84, 255, 74, '#100b1b');
  ctx.fillStyle = crashed ? '#ff94b8' : cashed ? '#b8ffda' : '#fff4ff';
  ctx.font = '700 62px CrashBold';
  ctx.textAlign = 'center';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.fillText(formatMultiplier(current), 514, 139);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';

  cover(ctx, 794, 38, 172, 35, '#100b1b');
  drawPill(ctx, 794, 38, 172, 35, crashed ? 'QUEBROU' : cashed ? 'SACADO' : 'AO VIVO', accent);

  cover(ctx, 57, 124, 248, 34, '#160c20');
  drawPill(ctx, 57, 124, 248, 34, current < 1.5 ? 'MOMENTO' : current < 3 ? 'PRESSÃO' : 'ALTO RISCO', current < 1.5 ? '#ffb1f3' : accent);
  cover(ctx, 733, 118, 270, 48, '#160c20');
  drawPill(ctx, 739, 124, 252, 34, `PRÓXIMO ALVO  ${formatMultiplier(Math.max(1.5, Math.ceil((current + 0.01) * 2) / 2))}`, '#f3b5ff');

  cover(ctx, 102, 196, 828, 238, '#0d0d19');
  drawChartGrid(ctx);
  const baseY = 432;
  const points = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    points.push(chartPoint(1 + (current - 1) * t ** 1.35, target, Math.max(0.02, progress * t)));
  }
  ctx.beginPath();
  ctx.moveTo(105, baseY);
  for (const item of points) ctx.lineTo(item.x, item.y);
  ctx.lineTo(point.x, baseY);
  ctx.closePath();
  ctx.fillStyle = crashed ? 'rgba(255, 84, 147, 0.20)' : 'rgba(255, 93, 231, 0.22)';
  ctx.fill();
  ctx.beginPath();
  points.forEach((item, index) => index === 0 ? ctx.moveTo(item.x, item.y) : ctx.lineTo(item.x, item.y));
  ctx.strokeStyle = crashed ? '#ff619b' : '#ff9af2';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (crashed) drawCrashBurst(ctx, point.x, point.y);
  else drawRocket(ctx, point.x, point.y, false);

  cover(ctx, 37, 218, 62, 180);
  ctx.fillStyle = '#f0c8ff';
  ctx.font = '400 11px CrashRegular';
  ctx.textAlign = 'right';
  for (let i = 1; i <= 3; i += 1) {
    const value = 1 + (target - 1) * (i / 4);
    ctx.fillText(formatMultiplier(value), 91, 432 - 214 * (i / 4) + 4);
  }
  ctx.textAlign = 'left';
  cover(ctx, 860, 431, 74, 22);
  ctx.fillText(formatMultiplier(target), 925, 449);

  cover(ctx, 110, 480, 145, 62, '#160c20');
  cover(ctx, 344, 480, 180, 62, '#160c20');
  ctx.font = '700 12px CrashBold';
  ctx.fillStyle = '#f0c8ff';
  ctx.fillText('APOSTA', 120, 496);
  ctx.fillText('RETORNO', 360, 496);
  ctx.font = '700 23px CrashBold';
  ctx.fillStyle = '#fff4ff';
  ctx.fillText(formatCoins(bet), 120, 522);
  ctx.fillStyle = crashed ? '#ff91b4' : '#b8ffda';
  ctx.fillText(formatCoins(payout), 360, 522);

  cover(ctx, 640, 500, 320, 30, '#100b1b');
  ctx.fillStyle = '#e9c6f4';
  ctx.font = '400 13px CrashRegular';
  ctx.textAlign = 'right';
  ctx.fillText(
    status === 'playing' ? 'Saque enquanto a curva estiver subindo' : crashed ? `Ponto de quebra: ${formatMultiplier(crashAt)}` : 'Rodada encerrada',
    947,
    519,
  );
  ctx.textAlign = 'left';

  cover(ctx, 606, 489, 140, 16, '#100b1b');
  ctx.fillStyle = '#c78fca';
  ctx.font = '400 8px CrashRegular';
  ctx.fillText(`SUBSTANCY • CRASH • ${formatMultiplier(current)}`, 610, 499);
  ctx.restore();
  return canvas.toBuffer('image/png');
}