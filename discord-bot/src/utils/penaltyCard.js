import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FONTS_DIR = join(__dirname, '../../fonts');

GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Regular.ttf')), 'PenaltyRegular');
GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Bold.ttf')), 'PenaltyBold');

const WIDTH = 960;
const HEIGHT = 600;
const GOAL = { left: 142, top: 188, width: 676, height: 254 };
const COLORS = {
  cyan: '#61e7ff',
  green: '#79edb1',
  red: '#ff728b',
  gold: '#ffd16b',
  text: '#eff8ff',
  muted: '#8aa4c6',
};

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

function formatCoins(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatMultiplier(value) {
  return `${Number(value || 1).toFixed(2).replace('.', ',')}x`;
}

function targetPosition(direction) {
  if (!direction) return { x: GOAL.left + GOAL.width / 2, y: 486 };
  if (direction === 'left') return { x: GOAL.left + 116, y: GOAL.top + 68 };
  if (direction === 'right') return { x: GOAL.left + GOAL.width - 116, y: GOAL.top + 68 };
  return { x: GOAL.left + GOAL.width / 2, y: GOAL.top + 116 };
}

function drawBackground(ctx, status) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#061327');
  background.addColorStop(0.55, '#102b4d');
  background.addColorStop(1, status === 'saved' ? '#2a132c' : '#08152b');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const stadiumGlow = ctx.createRadialGradient(470, 270, 20, 470, 270, 470);
  stadiumGlow.addColorStop(0, status === 'saved' ? 'rgba(255, 79, 120, 0.20)' : 'rgba(67, 220, 255, 0.17)');
  stadiumGlow.addColorStop(1, 'rgba(3, 10, 24, 0)');
  ctx.fillStyle = stadiumGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let i = 0; i < 12; i += 1) ctx.fillRect(0, 98 + i * 35, WIDTH, 1);
}

function drawStadiumAtmosphere(ctx, status) {
  ctx.save();
  const lightColor = status === 'saved' ? 'rgba(255, 92, 123, 0.16)' : 'rgba(91, 224, 255, 0.16)';
  const lights = [
    { x: 76, y: 120 },
    { x: 884, y: 120 },
    { x: 250, y: 108 },
    { x: 710, y: 108 },
  ];

  for (const light of lights) {
    const beam = ctx.createLinearGradient(light.x, light.y, WIDTH / 2, 440);
    beam.addColorStop(0, lightColor);
    beam.addColorStop(1, 'rgba(52, 198, 220, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(light.x - 13, light.y);
    ctx.lineTo(light.x + 13, light.y);
    ctx.lineTo(WIDTH / 2 + 110, 440);
    ctx.lineTo(WIDTH / 2 - 110, 440);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d9f7ff';
    ctx.shadowColor = '#6eeaff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 34; i += 1) {
      const x = 24 + i * 28 + (row % 2) * 8;
      const y = 122 + row * 18;
      ctx.fillStyle = `rgba(${row === 2 ? 93 : 167}, ${row === 2 ? 195 : 214}, 229, ${0.16 + row * 0.04})`;
      ctx.beginPath();
      ctx.arc(x, y, row === 0 ? 2.3 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawHeader(ctx, round, goals, status) {
  ctx.font = '700 18px PenaltyBold';
  ctx.fillStyle = '#9bb8d8';
  ctx.fillText('SAVAGE', 52, 46);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('PÊNALTIS', 137, 46);

  ctx.font = '400 13px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('DISPUTA DE CINCO COBRANÇAS', 52, 68);

  roundRect(ctx, 727, 25, 181, 55, 18);
  ctx.fillStyle = 'rgba(4, 13, 31, 0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130, 185, 231, 0.18)';
  ctx.stroke();
  ctx.font = '700 24px PenaltyBold';
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.fillText(`${goals} / 5`, 772, 59);
  ctx.font = '400 12px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('GOLS', 856, 58);
  ctx.textAlign = 'left';

  const dotStart = 337;
  for (let i = 0; i < 5; i += 1) {
    const x = dotStart + i * 58;
    ctx.beginPath();
    ctx.arc(x, 57, 8, 0, Math.PI * 2);
    ctx.fillStyle = i < goals ? COLORS.green : i === round && status === 'choosing' ? COLORS.cyan : 'rgba(151, 184, 216, 0.22)';
    ctx.fill();
    if (i < 4) {
      ctx.fillStyle = i < goals - 1 ? COLORS.green : 'rgba(151, 184, 216, 0.18)';
      ctx.fillRect(x + 10, 55, 38, 4);
    }
  }
}

function drawPitch(ctx) {
  const pitch = ctx.createLinearGradient(0, GOAL.top, 0, 485);
  pitch.addColorStop(0, 'rgba(36, 123, 102, 0.16)');
  pitch.addColorStop(1, 'rgba(15, 73, 66, 0.44)');
  ctx.fillStyle = pitch;
  ctx.fillRect(84, 174, 792, 311);

  ctx.strokeStyle = 'rgba(116, 232, 195, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(84, 485);
  ctx.lineTo(876, 485);
  ctx.moveTo(194, 485);
  ctx.lineTo(230, 366);
  ctx.lineTo(730, 366);
  ctx.lineTo(766, 485);
  ctx.stroke();
}

function drawTargetZones(ctx, status) {
  if (status !== 'choosing') return;
  const zones = [
    { key: 'left', x: GOAL.left + 14, width: GOAL.width / 3 - 10, label: 'CANTO' },
    { key: 'center', x: GOAL.left + GOAL.width / 3 + 2, width: GOAL.width / 3 - 4, label: 'MEIO' },
    { key: 'right', x: GOAL.left + (GOAL.width / 3) * 2 + 8, width: GOAL.width / 3 - 10, label: 'CANTO' },
  ];

  ctx.save();
  for (const [index, zone] of zones.entries()) {
    ctx.fillStyle = index === 1 ? 'rgba(255, 209, 107, 0.055)' : 'rgba(97, 231, 255, 0.055)';
    ctx.fillRect(zone.x, GOAL.top + 12, zone.width, GOAL.height - 24);
    ctx.strokeStyle = index === 1 ? 'rgba(255, 209, 107, 0.20)' : 'rgba(97, 231, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 8]);
    ctx.strokeRect(zone.x, GOAL.top + 12, zone.width, GOAL.height - 24);
    ctx.setLineDash([]);
    ctx.font = '700 11px PenaltyBold';
    ctx.fillStyle = index === 1 ? 'rgba(255, 209, 107, 0.72)' : 'rgba(146, 231, 249, 0.62)';
    ctx.textAlign = 'center';
    ctx.fillText(zone.label, zone.x + zone.width / 2, GOAL.top + 34);
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawGoal(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(4, 13, 26, 0.48)';
  ctx.fillRect(GOAL.left + 14, GOAL.top + 18, GOAL.width - 28, GOAL.height);

  ctx.strokeStyle = 'rgba(225, 246, 255, 0.28)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i += 1) {
    const x = GOAL.left + (GOAL.width / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, GOAL.top + 10);
    ctx.lineTo(x, GOAL.top + GOAL.height - 10);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const y = GOAL.top + (GOAL.height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(GOAL.left + 8, y);
    ctx.lineTo(GOAL.left + GOAL.width - 8, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#f1fbff';
  ctx.shadowColor = 'rgba(117, 227, 255, 0.85)';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(GOAL.left, GOAL.top + GOAL.height);
  ctx.lineTo(GOAL.left, GOAL.top);
  ctx.lineTo(GOAL.left + GOAL.width, GOAL.top);
  ctx.lineTo(GOAL.left + GOAL.width, GOAL.top + GOAL.height);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawKeeper(ctx, direction, saved) {
  const position = direction === 'left'
    ? GOAL.left + 138
    : direction === 'right'
      ? GOAL.left + GOAL.width - 138
      : GOAL.left + GOAL.width / 2;
  const jump = saved ? -12 : 0;

  ctx.save();
  ctx.translate(position, GOAL.top + 185 + jump);
  if (direction === 'left') ctx.scale(-1, 1);

  ctx.shadowColor = saved ? 'rgba(255, 97, 126, 0.78)' : 'rgba(96, 228, 255, 0.42)';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = saved ? '#ff718a' : '#73e5ff';
  ctx.fillStyle = saved ? '#be405c' : '#257ba7';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -78);
  ctx.stroke();
  ctx.fillRect(-28, -66, 56, 62);
  ctx.beginPath();
  ctx.arc(0, -95, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-14, -50);
  ctx.lineTo(-74, -95);
  ctx.moveTo(14, -50);
  ctx.lineTo(74, -95);
  ctx.moveTo(-14, -8);
  ctx.lineTo(-36, 50);
  ctx.moveTo(14, -8);
  ctx.lineTo(36, 50);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.arc(-76, -96, 10, 0, Math.PI * 2);
  ctx.arc(76, -96, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShotTrail(ctx, direction, status) {
  if (!direction || status === 'choosing') return;
  const target = targetPosition(direction);
  const start = { x: GOAL.left + GOAL.width / 2, y: 486 };
  const gradient = ctx.createLinearGradient(start.x, start.y, target.x, target.y);
  gradient.addColorStop(0, 'rgba(255, 217, 109, 0.10)');
  gradient.addColorStop(1, status === 'saved' ? 'rgba(255, 98, 127, 0.90)' : 'rgba(123, 244, 185, 0.94)');

  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.setLineDash([9, 11]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo((start.x + target.x) / 2, target.y + 90, target.x, target.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawImpact(ctx, direction, status) {
  if (!direction || status === 'choosing') return;
  const target = targetPosition(direction);
  const goal = status === 'goal' || status === 'cashed' || status === 'won';
  const color = goal ? '#7cf0b5' : '#ff6d89';

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    const inner = 22;
    const outer = 34 + (i % 2) * 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ctx, direction, status) {
  const target = direction ? targetPosition(direction) : { x: GOAL.left + GOAL.width / 2, y: 486 };
  const x = target.x;
  const y = target.y;

  ctx.save();
  ctx.shadowColor = status === 'saved' ? 'rgba(255, 80, 120, 0.9)' : 'rgba(255, 219, 116, 0.95)';
  ctx.shadowBlur = status === 'choosing' ? 16 : 26;
  ctx.fillStyle = '#fff9e9';
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = status === 'saved' ? '#ff637e' : '#4ba9c5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 5);
  ctx.lineTo(x + 4, y - 10);
  ctx.lineTo(x + 9, y);
  ctx.lineTo(x + 2, y + 9);
  ctx.lineTo(x - 8, y + 5);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawResult(ctx, status, shot, keeperDirection) {
  if (status === 'choosing') return;
  const goal = status === 'goal' || status === 'cashed' || status === 'won';
  const label = goal ? 'GOL!' : 'DEFESA!';
  const color = goal ? COLORS.green : COLORS.red;
  const detail = goal
    ? `O goleiro foi para ${keeperDirection === 'left' ? 'a esquerda' : keeperDirection === 'right' ? 'a direita' : 'o meio'}`
    : `O goleiro acertou ${shot === 'left' ? 'a esquerda' : shot === 'right' ? 'a direita' : 'o meio'}`;

  ctx.font = '700 30px PenaltyBold';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(label, WIDTH / 2, 505);
  ctx.shadowBlur = 0;
  ctx.font = '400 14px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(detail, WIDTH / 2, 529);
  ctx.textAlign = 'left';
}

export function generatePenaltyCard({
  round = 0,
  goals = 0,
  status = 'choosing',
  shot = null,
  keeperDirection = 'center',
  bet = 0,
  payout = 0,
  multiplier = 1,
}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, status);
  drawStadiumAtmosphere(ctx, status);
  drawHeader(ctx, round, goals, status);
  drawPitch(ctx);
  drawTargetZones(ctx, status);
  drawGoal(ctx);
  drawShotTrail(ctx, shot, status);
  drawKeeper(ctx, keeperDirection, status === 'saved');
  drawImpact(ctx, shot, status);
  drawBall(ctx, shot, status);
  drawResult(ctx, status, shot, keeperDirection);

  ctx.font = '700 72px PenaltyBold';
  ctx.fillStyle = status === 'saved' ? COLORS.red : status === 'goal' || status === 'won' ? COLORS.green : COLORS.text;
  ctx.textAlign = 'center';
  ctx.shadowColor = status === 'saved' ? 'rgba(255, 83, 120, 0.44)' : 'rgba(83, 218, 255, 0.30)';
  ctx.shadowBlur = 22;
  ctx.fillText(formatMultiplier(multiplier), WIDTH / 2, 148);
  ctx.shadowBlur = 0;
  ctx.font = '400 13px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(status === 'choosing' ? 'ESCOLHA O CANTO DA COBRANÇA' : status === 'saved' ? 'A DISPUTA TERMINOU' : 'MULTIPLICADOR ATUAL', WIDTH / 2, 170);
  ctx.textAlign = 'left';

  ctx.font = '400 13px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('APOSTA', 54, 572);
  ctx.fillText('RETORNO SE SACAR', 238, 572);
  ctx.font = '700 20px PenaltyBold';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(formatCoins(bet), 54, 594);
  ctx.fillStyle = status === 'saved' ? COLORS.red : COLORS.green;
  ctx.fillText(formatCoins(payout), 238, 594);

  ctx.font = '400 13px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'right';
  ctx.fillText(
    status === 'choosing'
      ? `Cobrança ${Math.min(round + 1, 5)} de 5`
      : status === 'saved'
        ? 'Aposta perdida'
        : status === 'won'
          ? 'Sequência completa'
          : 'Você decide quando parar',
    906,
    585,
  );
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}