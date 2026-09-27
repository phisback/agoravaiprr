import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FONTS_DIR = join(__dirname, '../../fonts');
const TEMPLATE_PATH = join(__dirname, '../../assets/penalty-card-template.png');

GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Regular.ttf')), 'PenaltyRegular');
GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Bold.ttf')), 'PenaltyBold');

const DESIGN_W = 1024;
const DESIGN_H = 576;
const GOAL = { left: 230, top: 199, width: 602, height: 274 };
const COLORS = {
  cyan: '#61e7ff',
  green: '#79edb1',
  red: '#ff728b',
  gold: '#ffd16b',
  text: '#eff8ff',
  muted: '#8aa4c6',
};
let templatePromise;

function getTemplate() {
  templatePromise ??= loadImage(TEMPLATE_PATH);
  return templatePromise;
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

function formatCoins(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatMultiplier(value) {
  return `${Number(value || 1).toFixed(2).replace('.', ',')}x`;
}

function cover(ctx, x, y, width, height, color = '#061426') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function drawProgress(ctx, round, goals, status) {
  cover(ctx, 365, 18, 300, 50, '#061426');
  for (let i = 0; i < 5; i += 1) {
    const x = 389 + i * 58;
    const active = i < goals;
    const current = status === 'choosing' && i === round;
    ctx.strokeStyle = active ? '#72ffba' : current ? '#61e7ff' : 'rgba(151,184,216,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, 46, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = active ? '#39f89d' : current ? '#61e7ff' : '#172c4c';
    ctx.beginPath();
    ctx.arc(x, 46, 8, 0, Math.PI * 2);
    ctx.fill();
    if (i < 4) {
      ctx.strokeStyle = i < goals - 1 ? '#39f89d' : 'rgba(151,184,216,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 14, 46);
      ctx.lineTo(x + 44, 46);
      ctx.stroke();
    }
  }
}

function drawGoal(ctx) {
  ctx.fillStyle = 'rgba(3, 16, 30, 0.76)';
  ctx.fillRect(GOAL.left, GOAL.top, GOAL.width, GOAL.height);
  ctx.strokeStyle = 'rgba(225, 246, 255, 0.30)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i += 1) {
    const x = GOAL.left + (GOAL.width / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, GOAL.top);
    ctx.lineTo(x, GOAL.top + GOAL.height);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const y = GOAL.top + (GOAL.height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(GOAL.left, y);
    ctx.lineTo(GOAL.left + GOAL.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#e8fbff';
  ctx.shadowColor = '#58ddff';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  ctx.strokeRect(GOAL.left, GOAL.top, GOAL.width, GOAL.height);
  ctx.shadowBlur = 0;
}

function targetPosition(direction) {
  if (direction === 'left') return { x: GOAL.left + 120, y: GOAL.top + 72 };
  if (direction === 'right') return { x: GOAL.left + GOAL.width - 120, y: GOAL.top + 72 };
  return { x: GOAL.left + GOAL.width / 2, y: GOAL.top + 76 };
}

function drawKeeper(ctx, direction, saved) {
  const target = targetPosition(direction);
  const x = target.x;
  const y = GOAL.top + 178;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = saved ? '#ff718a' : '#73e5ff';
  ctx.fillStyle = saved ? '#be405c' : '#257ba7';
  ctx.shadowColor = saved ? '#ff617d' : '#5de5ff';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, -72); ctx.stroke();
  ctx.fillRect(-25, -60, 50, 58);
  ctx.beginPath(); ctx.arc(0, -88, 18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-13, -46); ctx.lineTo(-68, -87);
  ctx.moveTo(13, -46); ctx.lineTo(68, -87);
  ctx.moveTo(-13, -7); ctx.lineTo(-34, 45);
  ctx.moveTo(13, -7); ctx.lineTo(34, 45);
  ctx.stroke();
  ctx.restore();
}

function drawBall(ctx, direction, status) {
  const target = direction ? targetPosition(direction) : { x: GOAL.left + GOAL.width / 2, y: 485 };
  const start = { x: GOAL.left + GOAL.width / 2, y: 493 };
  if (direction && status !== 'choosing') {
    ctx.strokeStyle = status === 'saved' ? '#ff6685' : '#79f8bf';
    ctx.lineWidth = 4;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo((start.x + target.x) / 2, target.y + 92, target.x, target.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = '#fffbea';
  ctx.shadowColor = status === 'saved' ? '#ff587f' : '#a5ffd5';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(target.x, target.y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = status === 'saved' ? '#ff637e' : '#4ba9c5';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawResultPanel(ctx, status, shot, keeperDirection) {
  if (status === 'choosing') return;
  const goal = status === 'goal' || status === 'cashed' || status === 'won';
  const color = goal ? COLORS.green : COLORS.red;
  ctx.fillStyle = 'rgba(3, 12, 25, 0.94)';
  ctx.beginPath();
  ctx.moveTo(310, 390); ctx.lineTo(714, 390); ctx.lineTo(750, 449);
  ctx.lineTo(714, 486); ctx.lineTo(310, 486); ctx.lineTo(274, 449); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 42px PenaltyBold';
  ctx.textAlign = 'center';
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillText(status === 'saved' ? 'DEFESA!' : status === 'won' ? 'VITÓRIA!' : goal ? 'GOL!' : 'DEFESA!', 512, 440);
  ctx.shadowBlur = 0;
  ctx.font = '400 14px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    status === 'saved'
      ? `O goleiro acertou ${keeperDirection === 'left' ? 'a esquerda' : keeperDirection === 'right' ? 'a direita' : 'o meio'}`
      : `Cobrança no canto ${shot === 'left' ? 'esquerdo' : shot === 'right' ? 'direito' : 'central'}`,
    512,
    468,
  );
  ctx.textAlign = 'left';
}

export async function generatePenaltyCard({
  round = 0,
  goals = 0,
  status = 'choosing',
  shot = null,
  keeperDirection = 'center',
  bet = 0,
  payout = 0,
  multiplier = 1,
}) {
  const template = await getTemplate();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, template.width, template.height);
  ctx.save();
  ctx.scale(template.width / DESIGN_W, template.height / DESIGN_H);

  const saved = status === 'saved';
  const won = status === 'won';
  const active = status === 'choosing' || status === 'goal';
  const accent = saved ? COLORS.red : COLORS.green;

  drawProgress(ctx, round, goals, status);
  cover(ctx, 805, 26, 145, 68, '#061426');
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 25px PenaltyBold';
  ctx.fillText(`${goals} / 5`, 821, 58);
  ctx.font = '400 12px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('GOLS', 889, 57);

  cover(ctx, 356, 86, 312, 109, '#061426');
  ctx.fillStyle = saved ? COLORS.red : won ? COLORS.gold : COLORS.green;
  ctx.font = '700 58px PenaltyBold';
  ctx.textAlign = 'center';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 14;
  ctx.fillText(formatMultiplier(multiplier), 512, 134);
  ctx.shadowBlur = 0;
  ctx.font = '400 12px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    status === 'choosing' ? 'ESCOLHA O CANTO DA COBRANÇA' : saved ? 'A DISPUTA TERMINOU' : 'MULTIPLICADOR ATUAL',
    512,
    177,
  );
  ctx.textAlign = 'left';

  cover(ctx, 214, 190, 620, 300, '#061528');
  drawGoal(ctx);
  drawKeeper(ctx, keeperDirection, saved);
  drawBall(ctx, shot, status);
  drawResultPanel(ctx, status, shot, keeperDirection);

  cover(ctx, 100, 484, 108, 73, '#061426');
  cover(ctx, 288, 484, 174, 73, '#061426');
  ctx.font = '400 12px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('APOSTA', 108, 502);
  ctx.fillText('RETORNO SE SACAR', 296, 502);
  ctx.font = '700 22px PenaltyBold';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(formatCoins(bet), 108, 532);
  ctx.fillStyle = saved ? COLORS.red : COLORS.green;
  ctx.fillText(formatCoins(payout), 296, 532);

  cover(ctx, 820, 495, 204, 58, '#061426');
  ctx.font = '400 13px PenaltyRegular';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'right';
  ctx.fillText(
    status === 'choosing'
      ? `Cobrança ${Math.min(round + 1, 5)} de 5`
      : saved
        ? 'Aposta perdida'
        : won
          ? 'Sequência completa'
          : active
            ? 'Você decide quando parar'
            : 'Rodada encerrada',
    965,
    532,
  );
  ctx.textAlign = 'left';
  ctx.restore();
  return canvas.toBuffer('image/png');
}