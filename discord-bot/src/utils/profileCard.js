import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { resolveBanner, getRingColors, drawAvatarRing } from './shopData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const FONTS_DIR  = join(__dirname, '../../fonts');

GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Regular.ttf')), 'BotFont');
GlobalFonts.register(readFileSync(join(FONTS_DIR, 'Roboto-Bold.ttf')),    'BotFont');

const FONT = 'BotFont';
const W = 800, H = 600;
const DEFAULT_CARD_BG_1 = '#202124';
const DEFAULT_CARD_BG_2 = '#2b2d30';
const DEFAULT_PANEL_COLOR = '#1c1e21';

// ─── Badges ───────────────────────────────────────────────────────────────────
export const BADGE_DEFS = [
  { key: 'vip',           defaultEmoji: '💎', name: 'VIP',           description: 'Saldo total ≥ 50.000',  color: 'rgba(88,166,255,0.85)'  },
  { key: 'rico',          defaultEmoji: '💰', name: 'Rico',          description: 'Saldo total ≥ 10.000',  color: 'rgba(253,224,71,0.85)'  },
  { key: 'poupador',      defaultEmoji: '🪙', name: 'Poupador',      description: 'Saldo total ≥ 5.000',   color: 'rgba(200,180,60,0.80)'  },
  { key: 'colecionador',  defaultEmoji: '🏆', name: 'Colecionador',  description: '10+ itens comprados',   color: 'rgba(157,78,221,0.85)'  },
  { key: 'comprador',     defaultEmoji: '🛍️', name: 'Comprador',     description: '5+ itens comprados',    color: 'rgba(130,60,200,0.80)'  },
  { key: 'mascote',       defaultEmoji: '🐾', name: 'Mascote',       description: 'Pet ativo equipado',    color: 'rgba(87,242,135,0.80)'  },
  { key: 'estiloso',      defaultEmoji: '🎨', name: 'Estiloso',      description: 'Banner equipado',       color: 'rgba(255,107,107,0.80)' },
  { key: 'personalizado', defaultEmoji: '💠', name: 'Personalizado', description: 'Argola personalizada',  color: 'rgba(100,200,220,0.80)' },
];

export function computeEarnedBadgeKeys({ balance, bank, purchases, activePet, activeBanner, activeRing }) {
  const keys  = [];
  const total = (balance ?? 0) + (bank ?? 0);
  if      (total >= 50000) keys.push('vip');
  else if (total >= 10000) keys.push('rico');
  else if (total >= 5000)  keys.push('poupador');
  if      (purchases >= 10) keys.push('colecionador');
  else if (purchases >= 5)  keys.push('comprador');
  if (activePet)                           keys.push('mascote');
  if (activeBanner)                        keys.push('estiloso');
  if (activeRing && activeRing !== 'roxo') keys.push('personalizado');
  return keys;
}

export function computeLevel(xp) {
  // A cada nível a meta cresce um pouco; isso mantém a progressão visível
  // sem deixar que usuários ativos subam dezenas de níveis em poucos dias.
  const totalXp = Math.max(0, Number(xp) || 0);
  let level = 1;
  let spent = 0;
  let needed = 300;
  while (totalXp >= spent + needed) {
    spent += needed;
    level += 1;
    needed = 300 + (level - 1) * 100;
  }
  return { level, current: totalXp - spent, needed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);          ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);          ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fmtCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// Retorna true se a cor for escura (luminância < 128)
// Suporta: hex (#000, #000000, #00000088), rgb(...), rgba(...), named (black/white)
function isColorDark(color) {
  if (!color) return false;
  try {
    const s = String(color).trim().toLowerCase();
    // Named colors
    if (s === 'black' || s === 'transparent') return true;
    if (s === 'white') return false;
    let r, g, b;
    // rgb() / rgba()
    const rgbM = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbM) {
      [r, g, b] = [Number(rgbM[1]), Number(rgbM[2]), Number(rgbM[3])];
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    }
    // Hex
    const hex = s.replace(/^#/, '');
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else { return false; }
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  } catch { return false; }
}

// ── Cache de imagens (evita re-fetch para frames de GIF animado) ─────────────
const _imgCache = new Map(); // url → Image
const _IMG_CACHE_MAX = 120;

async function loadUrl(url, timeoutMs = 7000) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const img = await loadImage(Buffer.from(await r.arrayBuffer()));
    if (_imgCache.size >= _IMG_CACHE_MAX) {
      // Remove o mais antigo
      _imgCache.delete(_imgCache.keys().next().value);
    }
    _imgCache.set(url, img);
    return img;
  } finally { clearTimeout(timer); }
}

function parseCustomEmoji(e) {
  const m = e?.match(/<a?:\w+:(\d{10,20})>/);
  return m ? `https://cdn.discordapp.com/emojis/${m[1]}.png` : null;
}

// Tenta múltiplos CDNs para máxima confiabilidade
async function loadEmojiImg(emoji) {
  if (!emoji) return null;
  const cu = parseCustomEmoji(emoji);
  if (cu) try { return await loadUrl(cu, 5000); } catch {}
  const cp = [...emoji].map(c => c.codePointAt(0).toString(16)).filter(c => c !== 'fe0f').join('-');
  const cdns = [
    `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${cp}.png`,
    `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cp}.png`,
  ];
  for (const url of cdns) {
    try { return await loadUrl(url, 5000); } catch {}
  }
  return null;
}

function tokenizeBio(text) {
  const re = /<a?:\w+:\d{10,20}>|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?)*/gu;
  const tokens = []; let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    tokens.push({ type: 'emoji', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

async function drawBioWithEmojis(ctx, text, x, y, maxW, lineH, emojiSz) {
  const tokens = tokenizeBio(text);
  const cache  = new Map();
  await Promise.all(tokens.filter(t => t.type === 'emoji').map(async t => {
    const img = await loadEmojiImg(t.value).catch(() => null);
    if (img) cache.set(t.value, img);
  }));
  const SW = ctx.measureText(' ').width;
  const items = [];
  for (const tok of tokens) {
    if (tok.type === 'emoji') { items.push({ kind: 'emoji', value: tok.value, width: emojiSz + 2 }); continue; }
    for (const p of tok.value.split(/(\s+)/)) {
      if (!p) continue;
      items.push(/^\s+$/.test(p)
        ? { kind: 'space', value: p, width: SW * p.length }
        : { kind: 'word',  value: p, width: ctx.measureText(p).width });
    }
  }
  const lines = []; let cur = [], curW = 0;
  for (const item of items) {
    if (item.kind === 'space') { cur.push(item); curW += item.width; continue; }
    if (curW + item.width > maxW && cur.length) {
      while (cur.length && cur.at(-1).kind === 'space') cur.pop();
      lines.push(cur); cur = []; curW = 0;
    }
    cur.push(item); curW += item.width;
  }
  if (cur.length) { while (cur.length && cur.at(-1).kind === 'space') cur.pop(); lines.push(cur); }
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of lines) {
    const lineW = line.reduce((total, item) => total + item.width, 0);
    let cx = x + Math.max(0, (maxW - lineW) / 2);
    for (const item of line) {
      if (item.kind === 'emoji') {
        const img = cache.get(item.value);
        if (img) ctx.drawImage(img, cx, y - emojiSz + 3, emojiSz, emojiSz);
        else ctx.fillText(item.value, cx, y);
        cx += item.width;
      } else if (item.kind === 'space') { cx += item.width; }
      else { ctx.fillText(item.value, cx, y); cx += item.width; }
    }
    y += lineH;
  }
  ctx.restore();
  return y;
}

// ─── Ícone circular: fundo gradiente + emoji por cima ──────────────────────────

function drawIconBg(ctx, x, y, sz, c1, c2) {
  const g = ctx.createLinearGradient(x, y, x + sz, y + sz);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x + sz / 2, y + sz / 2, sz / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#171717';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawEmptySlotIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * size * 0.48;
    const y = cy + Math.sin(angle) * size * 0.48;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  const top = { x: cx, y: cy - size * 0.22 };
  const left = { x: cx - size * 0.22, y: cy - size * 0.09 };
  const right = { x: cx + size * 0.22, y: cy - size * 0.09 };
  const front = { x: cx, y: cy + size * 0.03 };
  const leftBottom = { x: cx - size * 0.22, y: cy + size * 0.16 };
  const rightBottom = { x: cx + size * 0.22, y: cy + size * 0.16 };
  const bottom = { x: cx, y: cy + size * 0.29 };
  ctx.beginPath();
  ctx.moveTo(top.x, top.y); ctx.lineTo(left.x, left.y); ctx.lineTo(front.x, front.y);
  ctx.lineTo(right.x, right.y); ctx.lineTo(top.x, top.y);
  ctx.moveTo(left.x, left.y); ctx.lineTo(leftBottom.x, leftBottom.y);
  ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(front.x, front.y);
  ctx.moveTo(right.x, right.y); ctx.lineTo(rightBottom.x, rightBottom.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.stroke();
  ctx.restore();
}

// Ícones canvas de fallback (usados se o emoji não carregar)
function fallbackCoin(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2;
  for (let i = 2; i >= 0; i--) {
    const off = i * sz * 0.06;
    ctx.fillStyle = i === 0 ? '#FFD700' : `rgba(255,200,50,${0.6 + i * 0.15})`;
    ctx.beginPath(); ctx.ellipse(cx, cy - off, sz * 0.28, sz * 0.10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(180,130,0,0.4)'; ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `bold ${Math.floor(sz * 0.32)}px BotFont`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', cx, cy + sz * 0.06);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function fallbackStar(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2, R = sz * 0.30, r2 = R * 0.42;
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rl = i % 2 === 0 ? R : r2;
    i === 0 ? ctx.moveTo(cx + rl * Math.cos(a), cy + rl * Math.sin(a))
            : ctx.lineTo(cx + rl * Math.cos(a), cy + rl * Math.sin(a));
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(220,160,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
}

function fallbackBlueStar(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2, R = sz * 0.32, r2 = R * 0.42;
  ctx.fillStyle = '#ffe46b';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? R : r2;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function fallbackGlobe(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2, r = sz * 0.34;
  const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 1, cx, cy, r * 1.5);
  ocean.addColorStop(0, '#9cecff');
  ocean.addColorStop(0.45, '#1597e5');
  ocean.addColorStop(1, '#0753a5');
  ctx.fillStyle = ocean;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#45bd65';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.9, cy - r * 0.2);
  ctx.lineTo(cx - r * 0.45, cy - r * 0.55);
  ctx.lineTo(cx - r * 0.05, cy - r * 0.42);
  ctx.lineTo(cx + r * 0.05, cy - r * 0.12);
  ctx.lineTo(cx - r * 0.28, cy + r * 0.06);
  ctx.lineTo(cx - r * 0.42, cy + r * 0.48);
  ctx.lineTo(cx - r * 0.75, cy + r * 0.36);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.18, cy - r * 0.72);
  ctx.lineTo(cx + r * 0.75, cy - r * 0.42);
  ctx.lineTo(cx + r * 0.86, cy - r * 0.03);
  ctx.lineTo(cx + r * 0.52, cy + r * 0.12);
  ctx.lineTo(cx + r * 0.47, cy + r * 0.58);
  ctx.lineTo(cx + r * 0.14, cy + r * 0.35);
  ctx.lineTo(cx + r * 0.31, cy + r * 0.02);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.78)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

function fallbackHeart(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2, r = sz * 0.31;
  const heart = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  heart.addColorStop(0, '#ff8bb0');
  heart.addColorStop(1, '#e52363');
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.55, cy - r * 0.05, cx - r * 0.9, cy - r * 1.1, cx, cy - r * 0.42);
  ctx.bezierCurveTo(cx + r * 0.9, cy - r * 1.1, cx + r * 1.55, cy - r * 0.05, cx, cy + r * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function fallbackMedal(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2;
  // Ribbon
  ctx.fillStyle = '#FF6B6B';
  ctx.beginPath();
  ctx.moveTo(cx - sz * 0.10, cy - sz * 0.30);
  ctx.lineTo(cx + sz * 0.10, cy - sz * 0.30);
  ctx.lineTo(cx + sz * 0.06, cy - sz * 0.04);
  ctx.lineTo(cx, cy - sz * 0.10);
  ctx.lineTo(cx - sz * 0.06, cy - sz * 0.04);
  ctx.closePath(); ctx.fill();
  // Gold circle
  const grad = ctx.createRadialGradient(cx, cy + sz * 0.08, 0, cx, cy + sz * 0.08, sz * 0.20);
  grad.addColorStop(0, '#FFD700'); grad.addColorStop(1, '#F59E0B');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy + sz * 0.08, sz * 0.20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.floor(sz * 0.22)}px BotFont`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', cx, cy + sz * 0.08);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function fallbackThumb(ctx, x, y, sz) {
  const cx = x + sz / 2, cy = y + sz / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, cx - sz * 0.06, cy - sz * 0.04, sz * 0.24, sz * 0.26, sz * 0.05); ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - sz * 0.17, sz * 0.14, Math.PI * 0.75, Math.PI * 1.75);
  ctx.lineTo(cx - sz * 0.08, cy - sz * 0.04); ctx.lineTo(cx - sz * 0.06, cy - sz * 0.04);
  ctx.closePath(); ctx.fill();
  roundRect(ctx, cx - sz * 0.24, cy + sz * 0.02, sz * 0.18, sz * 0.24, sz * 0.04); ctx.fill();
  // Stars
  ctx.fillStyle = '#FFD700';
  for (let i = 0; i < 3; i++) {
    const sx = cx - sz * 0.15 + i * sz * 0.14, sy = cy - sz * 0.32;
    ctx.font = `${Math.floor(sz * 0.18)}px BotFont`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', sx, sy);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// Config de cada stat: emoji para tentar carregar + cores do bg + fallback canvas
const STAT_ICON_CONFIGS = [
  { emoji: '🌍', c1: '#20cbd1', c2: '#149846', fallback: fallbackGlobe  }, // Nível
  { emoji: '⭐', c1: '#9a4be8', c2: '#5c25ba', fallback: fallbackStar   }, // XP
  { emoji: '🌟', c1: '#ffb84c', c2: '#e27720', fallback: fallbackMedal  }, // Reps
  { emoji: '💲', c1: '#ffd267', c2: '#e3a526', fallback: fallbackCoin   }, // Coins
  { emoji: '💗', c1: '#ff9dba', c2: '#ee4b72', fallback: fallbackHeart  }, // Casado
  { emoji: '🌟', c1: '#2786ef', c2: '#0c3caa', fallback: fallbackBlueStar }, // Amigo
];

// ─── Gerador principal ────────────────────────────────────────────────────────

export async function generateProfileCard({
  username, avatarUrl, balance, bank, activeBanner, purchases,
  activeRing, ringBorderColor = null, activePet, guildBadgeEmojis = {}, guildId = null,
  marriedToName = null, bestFriendName = null, bio = null,
  cardBg1 = null, cardBg2 = null, cardPanelColor = null,
  xp = 0, reps = 0,
  // Parâmetros internos para geração de GIF animado:
  _bannerImage = null,   // Image já carregada — pula o loadUrl do banner
  _resolvedBanner = null, // Banner já resolvido — evita nova consulta/download
  _returnCanvas = false, // se true, retorna o canvas em vez de PNG buffer
}) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  const banner = _bannerImage ? null : (_resolvedBanner ?? await resolveBanner(activeBanner, guildId));
  const { c1: rc1, c2: rc2 } = getRingColors(activeRing ?? null);
  const { level, current: xpCurrent, needed: xpNeeded } = computeLevel(xp);
  const earnedKeys = computeEarnedBadgeKeys({
    balance, bank, purchases, activePet, activeBanner, activeRing,
  });

  const darkCard = isColorDark(cardBg1 ?? DEFAULT_CARD_BG_1);
  const darkPanel = isColorDark(cardPanelColor ?? DEFAULT_PANEL_COLOR);
  const statIconImgs = await Promise.all(
    STAT_ICON_CONFIGS.map(ic => loadEmojiImg(ic.emoji).catch(() => null)),
  );
  const badgeIconImgs = await Promise.all(
    earnedKeys.map(key => {
      const badge = BADGE_DEFS.find(b => b.key === key);
      const emoji = guildBadgeEmojis[key] ?? badge?.defaultEmoji ?? '🏅';
      return loadEmojiImg(emoji).catch(() => null);
    }),
  );

  // ── Fundo padrão grafite; as cores configuradas pelo usuário têm prioridade ─
  if (cardBg1 && cardBg2) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, cardBg1); g.addColorStop(1, cardBg2);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, cardBg1 ?? DEFAULT_CARD_BG_1);
    g.addColorStop(1, cardBg1 ?? DEFAULT_CARD_BG_2);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  roundRect(ctx, 14, 14, W - 28, H - 28, 25);
  ctx.strokeStyle = darkCard ? 'rgba(255,255,255,0.72)' : 'rgba(35,35,35,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // ── Banner largo; o padrão ganha textura escura e banners equipados ficam intactos ─
  const BANNER_X = 18, BANNER_Y = 18, BANNER_W = W - 36, BANNER_H = 128;
  const drawBannerImage = (img) => {
    const scale = Math.max(BANNER_W / img.width, BANNER_H / img.height);
    const sw = img.width * scale, sh = img.height * scale;
    ctx.save();
    roundRect(ctx, BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 24);
    ctx.clip();
    ctx.drawImage(img, BANNER_X + (BANNER_W - sw) / 2, BANNER_Y + (BANNER_H - sh) / 2, sw, sh);
    ctx.restore();
  };
  const drawBannerGradient = (colors) => {
    const [bg1, bg2] = colors;
    const g = ctx.createLinearGradient(BANNER_X, BANNER_Y, BANNER_X + BANNER_W, BANNER_Y + BANNER_H);
    g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    ctx.save();
    roundRect(ctx, BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 24);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(BANNER_X, BANNER_Y, BANNER_W, BANNER_H);
    ctx.restore();
  };
  const drawDefaultBannerTexture = () => {
    drawBannerGradient(['#151719', '#303235']);
    ctx.save();
    roundRect(ctx, BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 24);
    ctx.clip();
    const streaks = [
      [-30, 112, 78, 54, 145, 17, 205, -10, 26, 'rgba(255,255,255,0.09)'],
      [83, 149, 155, 103, 204, 35, 272, 6, 15, 'rgba(255,255,255,0.08)'],
      [265, 152, 321, 92, 363, 50, 425, 4, 22, 'rgba(255,255,255,0.07)'],
      [457, 155, 514, 109, 535, 49, 598, 0, 20, 'rgba(255,255,255,0.08)'],
      [631, 143, 672, 104, 720, 60, 810, 6, 24, 'rgba(255,255,255,0.09)'],
      [45, 57, 94, 28, 123, -2, 153, -24, 9, 'rgba(255,255,255,0.06)'],
      [541, 95, 573, 52, 610, 32, 636, -16, 10, 'rgba(255,255,255,0.06)'],
    ];
    for (const [x1, y1, c1x, c1y, c2x, c2y, x2, y2, width, color] of streaks) {
      ctx.beginPath();
      ctx.moveTo(BANNER_X + x1, BANNER_Y + y1);
      ctx.bezierCurveTo(BANNER_X + c1x, BANNER_Y + c1y, BANNER_X + c2x, BANNER_Y + c2y, BANNER_X + x2, BANNER_Y + y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    const glow = ctx.createLinearGradient(BANNER_X, BANNER_Y, BANNER_X + BANNER_W, BANNER_Y + BANNER_H);
    glow.addColorStop(0, 'rgba(255,255,255,0.05)');
    glow.addColorStop(0.5, 'rgba(0,0,0,0)');
    glow.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = glow;
    ctx.fillRect(BANNER_X, BANNER_Y, BANNER_W, BANNER_H);
    ctx.restore();
  };

  if (_bannerImage) {
    drawBannerImage(_bannerImage);
  } else if (banner) {
    try {
      drawBannerImage(await loadUrl(banner.imageUrl));
    } catch {
      drawBannerGradient(banner.gradient ?? ['#292b2e', '#17181a']);
    }
  } else {
    drawDefaultBannerTexture();
  }

  ctx.save();
  roundRect(ctx, BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 24);
  ctx.strokeStyle = 'rgba(255,255,255,0.68)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // ── Avatar à esquerda, sobrepondo o banner ─────────────────────────────────
  const AV_CX = 155, AV_CY = 163, AV_R = 78;
  ctx.fillStyle = ringBorderColor ?? '#e8e8e8';
  ctx.beginPath();
  ctx.arc(AV_CX, AV_CY, AV_R + 10, 0, Math.PI * 2);
  ctx.fill();
  if (activeRing) await drawAvatarRing(ctx, AV_CX, AV_CY, AV_R + 4, activeRing);

  ctx.save();
  ctx.beginPath();
  ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
  ctx.clip();
  try {
    ctx.drawImage(await loadUrl(avatarUrl), AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
  } catch {
    ctx.fillStyle = '#282a2d';
    ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
  }
  ctx.restore();

  // Pet pequeno sobre a foto, como um item equipado.
  if (activePet) {
    const px = AV_CX + AV_R * 0.68, py = AV_CY + AV_R * 0.68;
    ctx.fillStyle = darkPanel ? '#242629' : '#ffffff';
    ctx.beginPath(); ctx.arc(px, py, 19, 0, Math.PI * 2); ctx.fill();
    const pg = ctx.createLinearGradient(px - 20, py - 20, px + 20, py + 20);
    pg.addColorStop(0, rc1); pg.addColorStop(1, rc2);
    ctx.strokeStyle = pg; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px, py, 17, 0, Math.PI * 2); ctx.stroke();
    const pi = await loadEmojiImg(activePet);
    if (pi) ctx.drawImage(pi, px - 12, py - 12, 24, 24);
  }

  // ── Nome e bio em cápsulas ──────────────────────────────────────────────────
  let nameFontSize = 38;
  ctx.font = `bold ${nameFontSize}px ${FONT}`;
  while (ctx.measureText(username).width > 330 && nameFontSize > 23) {
    nameFontSize -= 1;
    ctx.font = `bold ${nameFontSize}px ${FONT}`;
  }
  ctx.fillStyle = darkCard ? '#ffffff' : '#111111';
  ctx.fillText(username, 252, 187);

  const badgeW = 177, badgeX = W - badgeW - 24;
  ctx.fillStyle = darkCard ? 'rgba(255,255,255,0.14)' : 'rgba(20,20,20,0.1)';
  roundRect(ctx, badgeX, 157, badgeW, 38, 19); ctx.fill();
  for (let i = 0; i < earnedKeys.length; i++) {
    const badge = BADGE_DEFS.find(b => b.key === earnedKeys[i]);
    const bx = badgeX + 5 + i * 21;
    const by = 164;
    if (bx + 18 > badgeX + badgeW - 3) break;
    ctx.fillStyle = badge?.color ?? 'rgba(150,150,150,0.75)';
    ctx.beginPath();
    ctx.arc(bx + 9, by + 9, 9, 0, Math.PI * 2);
    ctx.fill();
    const badgeImg = badgeIconImgs[i];
    if (badgeImg) {
      ctx.drawImage(badgeImg, bx + 2, by + 2, 14, 14);
    } else {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        guildBadgeEmojis[earnedKeys[i]] ?? badge?.defaultEmoji ?? '🏅',
        bx + 9,
        by + 9,
      );
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const bioText = bio ?? 'Use k!sobremim <msg> para alterar!';
  roundRect(ctx, 248, 204, 527, 43, 20);
  ctx.fillStyle = darkPanel ? 'rgba(255,255,255,0.12)' : 'rgba(20,20,20,0.1)';
  ctx.fill();
  ctx.strokeStyle = darkPanel ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = darkCard ? '#eeeeef' : '#222222';
  ctx.font = `18px ${FONT}`;
  await drawBioWithEmojis(ctx, bioText, 258, 232, 505, 22, 18);

  // ── Slots de itens à esquerda ──────────────────────────────────────────────
  const slotData = [
    { label: 'SLOT VAZIO', emoji: null },
    { label: activePet ? 'PET EQUIPADO' : 'SLOT VAZIO', emoji: activePet ?? null },
    { label: 'SLOT VAZIO', emoji: null },
  ];
  const slotIconImgs = await Promise.all(
    slotData.map(slot => loadEmojiImg(slot.emoji).catch(() => null)),
  );

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = cardPanelColor ?? '#202225';
  roundRect(ctx, 20, 267, 250, 300, 20); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = darkPanel ? 'rgba(255,255,255,0.18)' : 'rgba(30,30,30,0.3)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, 20, 267, 250, 300, 20); ctx.stroke();
  for (let i = 0; i < slotData.length; i++) {
    const sx = 31, sy = 280 + i * 91, sw = 228, sh = 79;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = cardPanelColor ?? '#292b2e';
    roundRect(ctx, sx, sy, sw, sh, 15); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = darkPanel ? 'rgba(255,255,255,0.22)' : 'rgba(30,30,30,0.35)';
    ctx.lineWidth = 1.1;
    roundRect(ctx, sx, sy, sw, sh, 15); ctx.stroke();

    const icon = slotIconImgs[i];
    if (icon) {
      ctx.drawImage(icon, sx + 17, sy + 23, 32, 32);
    } else {
      drawEmptySlotIcon(ctx, sx + 40, sy + 39, 48, darkPanel ? '#e1e2e4' : '#333333');
    }
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = darkPanel ? '#e5e6e8' : '#202124';
    ctx.textAlign = 'left';
    ctx.fillText(slotData[i].label, sx + 63, sy + 45);
    ctx.strokeStyle = darkPanel ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,20,0.72)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sx + sw - 19, sy + 32);
    ctx.lineTo(sx + sw - 13, sy + 39);
    ctx.lineTo(sx + sw - 19, sy + 46);
    ctx.stroke();
  }
  ctx.textAlign = 'left';

  // ── Seis cápsulas de estatísticas no grid da referência ─────────────────────
  const statsData = [
    { text: `Level: ${level}` },
    { text: `XP ${xpCurrent}/${xpNeeded}` },
    { text: `Reputação: ${reps}` },
    { text: fmtCompact(balance ?? 0) },
    { text: marriedToName ?? 'Nenhum' },
    { text: bestFriendName ?? 'Nenhum' },
  ];
  const PILL_W = 245, PILL_H = 82, GAP_X = 10, GAP_Y = 10;
  const ISZ = 68;

  for (let i = 0; i < statsData.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const cX = 280 + col * (PILL_W + GAP_X);
    const cY = 274 + row * (PILL_H + GAP_Y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = cardPanelColor ?? DEFAULT_PANEL_COLOR;
    roundRect(ctx, cX, cY, PILL_W, PILL_H, 17); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = darkPanel ? 'rgba(255,255,255,0.25)' : 'rgba(25,25,25,0.34)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, cX, cY, PILL_W, PILL_H, 17); ctx.stroke();

    const icCfg = STAT_ICON_CONFIGS[i];
    const iX = cX + 10, iY = cY + 7;
    drawIconBg(ctx, iX, iY, ISZ, icCfg.c1, icCfg.c2);
    const emojiImg = statIconImgs[i];
    if (emojiImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(iX + ISZ / 2, iY + ISZ / 2, ISZ / 2 - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(emojiImg, iX + 7, iY + 7, ISZ - 14, ISZ - 14);
      ctx.restore();
    } else {
      ctx.save(); icCfg.fallback(ctx, iX, iY, ISZ); ctx.restore();
    }

    const maxW = PILL_W - ISZ - 28;
    let statText = statsData[i].text;
    ctx.font = `bold 20px ${FONT}`;
    while (statText.length > 1 && ctx.measureText(statText).width > maxW) {
      statText = statText.slice(0, -1);
    }
    ctx.fillStyle = darkPanel ? '#f4f4f5' : '#111111';
    ctx.textAlign = 'left';
    ctx.fillText(statText, iX + ISZ + 8, cY + 39);

    if (i === 1) {
      const barX = iX + ISZ + 8;
      const barY = cY + 55;
      const barW = maxW;
      const barH = 8;
      const progress = Math.min(1, Math.max(0, xpNeeded ? xpCurrent / xpNeeded : 0));
      ctx.fillStyle = darkPanel ? 'rgba(255,255,255,0.27)' : 'rgba(40,40,40,0.18)';
      roundRect(ctx, barX, barY, barW, barH, barH / 2); ctx.fill();
      if (progress > 0) {
        const xpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        xpGrad.addColorStop(0, '#bd42ef');
        xpGrad.addColorStop(1, '#8425d8');
        ctx.fillStyle = xpGrad;
        roundRect(ctx, barX, barY, Math.max(barH, barW * progress), barH, barH / 2); ctx.fill();
      }
    }
  }

  ctx.textAlign = 'left';
  if (_returnCanvas) return canvas;
  return canvas.toBuffer('image/png');
}
