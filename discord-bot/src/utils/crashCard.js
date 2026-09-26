import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FONTS_DIR = join(__dirname, '../../fonts');

GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Regular.ttf')), 'CrashRegular');
GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Bold.ttf')), 'CrashBold');

const WIDTH = 960;
const HEIGHT = 540;
const CHART = { left: 86, top: 176, width: 788, height: 250 };

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

function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace('.', ',')}x`;
}

function formatCoins(value) {
  return Number(value).toLocaleString('pt-BR');
}

function chartPoint(multiplier, maxMultiplier, progress) {
  const safeMax = Math.max(2, maxMultiplier);
  const normalized = Math.min(1, Math.log(Math.max(1, multiplier)) / Math.log(safeMax));
  const x = CHART.left + Math.max(0.02, progress) * CHART.width;
  const y = CHART.top + CHART.height - normalized * (CHART.height - 18);
  return { x, y };
}

function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(137, 173, 221, 0.10)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 5; i += 1) {
    const y = CHART.top + (CHART.height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(CHART.left, y);
    ctx.lineTo(CHART.left + CHART.width, y);
    ctx.stroke();
  }

  for (let i = 0; i <= 8; i += 1) {
    const x = CHART.left + (CHART.width / 8) * i;
    ctx.beginPath();
    ctx.moveTo(x, CHART.top);
    ctx.lineTo(x, CHART.top + CHART.height);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRocket(ctx, x, y, crashed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.42);

  ctx.shadowColor = crashed ? 'rgba(255, 78, 110, 0.95)' : 'rgba(91, 224, 255, 0.95)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = crashed ? '#ff5c78' : '#e7fbff';
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.bezierCurveTo(19, -8, 20, 12, 0, 27);
  ctx.bezierCurveTo(-20, 12, -19, -8, 0, -24);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = crashed ? '#6f1e39' : '#207dba';
  ctx.beginPath();
  ctx.arc(0, -6, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = crashed ? '#ff9a70' : '#ffcf69';
  ctx.beginPath();
  ctx.moveTo(-9, 17);
  ctx.lineTo(0, 42);
  ctx.lineTo(9, 17);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = crashed ? '#ff2e62' : '#52e7ff';
  ctx.beginPath();
  ctx.moveTo(-12, 12);
  ctx.lineTo(-25, 27);
  ctx.lineTo(-8, 23);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(25, 27);
  ctx.lineTo(8, 23);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCrashBurst(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(255, 91, 120, 0.92)';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#ff4e78';
  ctx.shadowBlur = 22;
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    const inner = 30 + (i % 2) * 6;
    const outer = 62 + (i % 3) * 12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fillStyle = '#ff6b77';
  ctx.fill();
  ctx.restore();
}

export function generateCrashCard({
  multiplier = 1,
  crashAt = 2,
  status = 'playing',
  bet = 0,
  payout = 0,
  elapsedMs = 0,
}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const crashed = status === 'crashed';
  const cashed = status === 'cashed';
  const active = status === 'playing';
  const current = Math.max(1, Number(multiplier) || 1);
  const maxMultiplier = Math.max(2, Number(crashAt) || 2, current * 1.15);
  const progress = Math.min(0.96, Math.max(0.02, elapsedMs / 80_000));
  const point = chartPoint(current, maxMultiplier, progress);

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#071326');
  background.addColorStop(0.55, '#0d1f3e');
  background.addColorStop(1, crashed ? '#2a102d' : '#071426');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(720, 60, 10, 720, 60, 360);
  glow.addColorStop(0, crashed ? 'rgba(255, 71, 111, 0.22)' : 'rgba(64, 215, 255, 0.20)');
  glow.addColorStop(1, 'rgba(4, 12, 28, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let i = 0; i < 14; i += 1) {
    ctx.fillRect(0, 86 + i * 31, WIDTH, 1);
  }

  ctx.font = '700 18px CrashBold';
  ctx.fillStyle = '#8ca9d0';
  ctx.fillText('SAVAGE', 56, 58);
  ctx.font = '700 18px CrashBold';
  ctx.fillStyle = crashed ? '#ff728c' : '#62e4ff';
  ctx.fillText('CRASH', 142, 58);

  ctx.font = '400 14px CrashRegular';
  ctx.fillStyle = '#7895bd';
  ctx.fillText(
    crashed ? 'A trajetória foi interrompida' : cashed ? 'Saque confirmado' : 'Acompanhe a subida e saia no seu tempo',
    56,
    82,
  );

  const statusLabel = crashed ? 'QUEBROU' : cashed ? 'SACADO' : 'AO VIVO';
  const statusColor = crashed ? '#ff6b82' : cashed ? '#7fe4ab' : '#63e2ff';
  roundRect(ctx, 780, 35, 124, 38, 19);
  ctx.fillStyle = crashed ? 'rgba(255, 83, 112, 0.16)' : cashed ? 'rgba(95, 219, 157, 0.14)' : 'rgba(86, 222, 255, 0.13)';
  ctx.fill();
  ctx.font = '700 13px CrashBold';
  ctx.fillStyle = statusColor;
  ctx.textAlign = 'center';
  ctx.fillText(statusLabel, 842, 59);
  ctx.textAlign = 'left';

  ctx.font = '700 86px CrashBold';
  ctx.fillStyle = crashed ? '#ff6f86' : cashed ? '#8aefbc' : '#f0fbff';
  ctx.textAlign = 'center';
  ctx.shadowColor = crashed ? 'rgba(255, 66, 106, 0.44)' : 'rgba(70, 215, 255, 0.35)';
  ctx.shadowBlur = 24;
  ctx.fillText(formatMultiplier(current), WIDTH / 2, 145);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';

  roundRect(ctx, CHART.left - 20, CHART.top - 22, CHART.width + 40, CHART.height + 44, 22);
  ctx.fillStyle = 'rgba(2, 10, 25, 0.42)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(126, 166, 219, 0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawGrid(ctx);

  const baseY = CHART.top + CHART.height;
  const fillGradient = ctx.createLinearGradient(0, CHART.top, 0, baseY);
  fillGradient.addColorStop(0, crashed ? 'rgba(255, 77, 116, 0.34)' : 'rgba(72, 222, 255, 0.34)');
  fillGradient.addColorStop(1, 'rgba(40, 105, 184, 0.02)');
  ctx.beginPath();
  ctx.moveTo(CHART.left, baseY);
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const curveMultiplier = 1 + (current - 1) * t ** 1.35;
    const curvePoint = chartPoint(curveMultiplier, maxMultiplier, Math.max(0.02, progress * t));
    if (i === 0) ctx.lineTo(curvePoint.x, curvePoint.y);
    else ctx.lineTo(curvePoint.x, curvePoint.y);
  }
  ctx.lineTo(point.x, baseY);
  ctx.closePath();
  ctx.fillStyle = fillGradient;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const curveMultiplier = 1 + (current - 1) * t ** 1.35;
    const curvePoint = chartPoint(curveMultiplier, maxMultiplier, Math.max(0.02, progress * t));
    if (i === 0) ctx.moveTo(curvePoint.x, curvePoint.y);
    else ctx.lineTo(curvePoint.x, curvePoint.y);
  }
  ctx.strokeStyle = crashed ? '#ff587b' : '#56e5ff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = crashed ? '#ff4f75' : '#40dfff';
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (crashed) {
    drawCrashBurst(ctx, point.x, point.y);
  } else {
    drawRocket(ctx, point.x, point.y, false);
  }

  ctx.font = '400 13px CrashRegular';
  ctx.fillStyle = '#7895bd';
  ctx.fillText('1,00x', CHART.left, baseY + 25);
  ctx.textAlign = 'right';
  ctx.fillText(formatMultiplier(maxMultiplier), CHART.left + CHART.width, baseY + 25);
  ctx.textAlign = 'left';

  const footerY = 475;
  ctx.font = '400 13px CrashRegular';
  ctx.fillStyle = '#7895bd';
  ctx.fillText('APOSTA', 58, footerY);
  ctx.fillText('RETORNO', 252, footerY);
  ctx.font = '700 20px CrashBold';
  ctx.fillStyle = '#e8f5ff';
  ctx.fillText(formatCoins(bet), 58, footerY + 27);
  ctx.fillStyle = crashed ? '#ff8095' : '#83efbd';
  ctx.fillText(formatCoins(payout), 252, footerY + 27);

  ctx.font = '400 14px CrashRegular';
  ctx.fillStyle = '#8ca9d0';
  ctx.textAlign = 'right';
  ctx.fillText(
    active ? 'Saque enquanto a curva estiver subindo' : crashed ? `Ponto de quebra: ${formatMultiplier(crashAt)}` : 'Rodada encerrada',
    902,
    footerY + 18,
  );
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}