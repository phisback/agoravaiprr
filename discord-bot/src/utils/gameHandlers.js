import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../database/client.js';
import { getEmoji } from './emojiManager.js';
import { generateDarkMinesGrid } from './darkMinesGrid.js';
import { generateBlackjackCard } from './economyCards.js';
import { generateCrashCard } from './crashCard.js';
import { generatePenaltyCard } from './penaltyCard.js';
import { spendCoins, totalCoins } from './economyFunds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '../../public/games');

const COIN = () => getEmoji('futecoins');

// ─── In-memory game states ────────────────────────────────────────────────────
export const blackjackGames = new Map();
export const minesGames     = new Map();
export const crashGames     = new Map();
export const penaltyGames   = new Map();

export function isBlackjackActive(userId) {
  return blackjackGames.has(userId);
}

export function isEconomyGameActive(userId) {
  return blackjackGames.has(userId) || minesGames.has(userId) || crashGames.has(userId) || penaltyGames.has(userId);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
async function getEco(userId, guildId) {
  return prisma.economy.upsert({
    where:  { userId_guildId: { userId, guildId } },
    create: { userId, guildId },
    update: {},
  });
}
async function deductBet(userId, guildId, bet) {
  const result = await spendCoins(prisma, { userId, guildId, amount: bet });
  if (!result.ok) throw new Error('Saldo insuficiente para essa aposta.');
}
async function addWin(userId, guildId, amount) {
  await prisma.economy.update({
    where: { userId_guildId: { userId, guildId } },
    data:  { balance: { increment: amount } },
  });
}

function pickCrashPoint() {
  const houseEdge = 0.92;
  const roll = Math.max(Math.random(), 0.0001);
  return Math.min(1000, Math.max(1.01, Math.floor((houseEdge / roll) * 100) / 100));
}

const CRASH_WARMUP_MS = 8_000;
const CRASH_WARMUP_MULTIPLIER = 1.005;
const CRASH_GROWTH_TIME_MS = 22_000;

function crashMultiplier(state) {
  const elapsed = Math.max(0, Date.now() - state.startedAt);
  const multiplier = elapsed <= CRASH_WARMUP_MS
    ? 1 + ((CRASH_WARMUP_MULTIPLIER - 1) * elapsed) / CRASH_WARMUP_MS
    : CRASH_WARMUP_MULTIPLIER * Math.exp((elapsed - CRASH_WARMUP_MS) / CRASH_GROWTH_TIME_MS);
  return Math.max(1, Math.min(state.crashAt, Math.floor(multiplier * 10_000) / 10_000));
}

function clearCrashTimer(state) {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString('pt-BR');
}

function memberInfo(interaction) {
  return {
    name:   interaction.member?.displayName ?? interaction.user?.username ?? interaction.author?.username ?? 'Jogador',
    avatar: interaction.member?.displayAvatarURL({ size: 64 })
      ?? interaction.user?.displayAvatarURL({ size: 64 })
      ?? interaction.author?.displayAvatarURL({ size: 64 })
      ?? null,
  };
}

// ─── V2 payload ───────────────────────────────────────────────────────────────

function v2Payload(container, files, ...extras) {
  const payload = { components: [container, ...extras], flags: MessageFlags.IsComponentsV2 };
  if (files && files.length > 0) payload.files = files;
  return payload;
}

// ─── Blackjack canvas image (dynamic — unique filename evita cache do Discord) ─

async function buildBJAttachment(state, hideDealer) {
  const pTotal  = handTotal(state.player);
  const dTotal  = handTotal(state.dealer);
  const payout  = state.payout ?? (state.won ? state.bet * 2 : state.tie ? state.bet : 0);

  const buf = await generateBlackjackCard({
    playerCards: state.player,
    dealerCards:  state.dealer,
    pTotal, dTotal,
    won:    state.won,
    tie:    state.tie,
    bust:   state.bust,
    bet:    state.bet,
    payout,
    hideDealer,
    status: state.status,
    result: state.result,
  });

  // Filename único por update — impede Discord de exibir a imagem cacheada
  const fname = `bj_${state.userId}_${Date.now()}.png`;
  return new AttachmentBuilder(buf, { name: fname });
}

// ══════════════════════════════════════════════════════════════════════════════
// BLACKJACK
// ══════════════════════════════════════════════════════════════════════════════

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const NATURAL_BLACKJACK_PAYOUT_MULTIPLIER = 2.25;

function newDeck()  { return SUITS.flatMap(s => RANKS.map(r => ({ rank: r, suit: s }))); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}
function handTotal(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c.rank), 0);
  let aces  = cards.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function isSoftHand(cards) {
  const rawTotal = cards.reduce((s, c) => s + cardValue(c.rank), 0);
  return cards.some(c => c.rank === 'A') && rawTotal <= 21;
}
function fmtCard(c) { return `\`${c.rank}${c.suit}\``; }
function fmtHand(cards) { return cards.map(fmtCard).join(' '); }

async function buildBJContainer(state, hideDealer = false) {
  const attachment = await buildBJAttachment(state, hideDealer);
  const fname      = attachment.name;

  const container = new ContainerBuilder();
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${fname}`),
    ),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(buildBJStatusText(state, hideDealer)),
  );

  return { container, files: [attachment] };
}

function buildBJStatusText(state, hideDealer) {
  const pTotal = handTotal(state.player);
  const dTotal = handTotal(state.dealer);
  const payout = state.payout ?? (state.won ? state.bet * 2 : state.tie ? state.bet : 0);

  if (state.status === 'playing') {
    const upCard = state.dealer[0];
    return (
      `## Blackjack • sua vez\n` +
      `Sua mão está em **${pTotal}** e o dealer mostra **${upCard.rank}${upCard.suit}**.\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Movimentos: **${state.moves ?? 0}**\n` +
      `${state.insuranceTaken ? `Seguro ativo: **${fmtNum(state.insurance)} coins**\n` : ''}` +
      `${upCard.rank === 'A' && !state.insuranceTaken ? 'O dealer mostra um Ás: você pode contratar seguro antes de jogar.\n' : ''}` +
      `${hideDealer ? 'Escolha uma ação para continuar a mão.' : ''}`
    );
  }

  const title = state.result === 'blackjack'
    ? '## BLACKJACK! Você venceu'
    : state.result === 'win'
      ? '## VITÓRIA! Você venceu'
      : state.result === 'tie'
        ? '## EMPATE'
        : state.result === 'bust'
          ? '## DERROTA — você estourou'
          : state.result === 'dealer_blackjack'
            ? '## DERROTA — blackjack do dealer'
            : '## DERROTA';

  return (
    `${title}\n` +
    `Sua mão: **${pTotal}** • Mão do dealer: **${dTotal}**\n` +
    `Retorno: **${fmtNum(payout)} coins** • Aposta: **${fmtNum(state.bet)} coins**`
  );
}

function buildBJComponents(state) {
  if (state.status !== 'playing') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_hit_${state.userId}`)
        .setLabel('Pedir Carta')
        .setEmoji('🎴')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`bj_stand_${state.userId}`)
        .setLabel('Parar')
        .setEmoji('👋')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bj_double_${state.userId}`)
        .setLabel('Dobrar')
        .setEmoji('💰')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(state.player.length !== 2),
      ...(state.player.length === 2 && state.dealer[0]?.rank === 'A' && !state.insuranceTaken
        ? [
            new ButtonBuilder()
              .setCustomId(`bj_insurance_${state.userId}`)
              .setLabel('Seguro')
              .setEmoji('🛡️')
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),
      new ButtonBuilder()
        .setCustomId(`bj_hint_${state.userId}`)
        .setLabel('Dica')
        .setEmoji('💡')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function finalizeBJ(state, interaction) {
  // Regra H17: o dealer compra em 17 suave, aumentando a vantagem da casa.
  while (
    handTotal(state.dealer) < 17
    || (handTotal(state.dealer) === 17 && isSoftHand(state.dealer))
  ) {
    state.dealer.push(state.deck.pop());
  }

  const pTotal = handTotal(state.player);
  const dTotal = handTotal(state.dealer);
  const won    = dTotal > 21 || pTotal > dTotal;
  const tie    = !won && pTotal === dTotal;

  state.status = 'done';
  state.won = won;
  state.tie = tie;

  const payout = won ? state.bet * 2 : tie ? state.bet : 0;
  state.payout = payout;
  state.result = won ? 'win' : tie ? 'tie' : 'loss';
  if (payout > 0) await addWin(state.userId, state.guildId, payout);
  blackjackGames.delete(state.userId);

  const { container, files } = await buildBJContainer(state);
  return interaction.editReply(v2Payload(container, files));
}

export async function startBlackjack(ctx, bet, sendFn) {
  const userId  = ctx.user?.id ?? ctx.author?.id;
  const guildId = ctx.guildId;

  if (blackjackGames.has(userId))
    return sendFn({ content: '❌ Você já tem um jogo de blackjack em andamento!' });

  const eco = await getEco(userId, guildId);
  const available = totalCoins(eco);
  if (bet > available)
    return sendFn({ content: `❌ Saldo insuficiente. Você tem **${fmtNum(available)} ${COIN()}** disponíveis entre carteira e banco.` });

  await deductBet(userId, guildId, bet);

  const deck   = shuffle(newDeck());
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];

  const state = {
    userId,
    guildId,
    bet,
    player,
    dealer,
    deck,
    status: 'playing',
    won: false,
    tie: false,
    bust: false,
    result: null,
    payout: 0,
    moves: 0,
    insurance: 0,
    insuranceTaken: false,
  };
  blackjackGames.set(userId, state);

  try {
    // Natural blackjack check
    if (handTotal(player) === 21) {
      const dTotal = handTotal(dealer);
      const won = dTotal !== 21;
      state.status = 'done';
      state.won = won;
      state.tie = !won;
      state.result = won ? 'blackjack' : 'tie';
      const payout = won ? Math.floor(bet * NATURAL_BLACKJACK_PAYOUT_MULTIPLIER) : bet;
      state.payout = payout;
      if (payout > 0) await addWin(userId, guildId, payout);
      blackjackGames.delete(userId);
      const { container, files } = await buildBJContainer(state);
      return sendFn(v2Payload(container, files));
    }

    // Auto-timeout 2 min
    setTimeout(async () => {
      const s = blackjackGames.get(userId);
      if (s?.status === 'playing') {
        blackjackGames.delete(userId);
        await addWin(userId, guildId, (s.bet ?? bet) + (s.insurance ?? 0)).catch(() => {});
      }
    }, 120_000);

    const { container, files } = await buildBJContainer(state, true);
    return sendFn(v2Payload(container, files, ...buildBJComponents(state)));
  } catch (error) {
    // A render/API failure must not leave the member locked out or lose the bet.
    if (blackjackGames.get(userId) === state) blackjackGames.delete(userId);
    await addWin(userId, guildId, bet).catch(() => {});
    throw error;
  }
}

export async function handleBJHit(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = blackjackGames.get(targetId);
  if (!state || state.status !== 'playing') return interaction.update({ components: [] });

  await interaction.deferUpdate();
  state.moves = (state.moves ?? 0) + 1;
  state.player.push(state.deck.pop());
  const total = handTotal(state.player);

  if (total > 21) {
    state.status = 'done';
    state.bust = true;
    state.result = 'bust';
    state.payout = 0;
    blackjackGames.delete(targetId);
    const { container, files } = await buildBJContainer(state);
    return interaction.editReply(v2Payload(container, files));
  }
  if (total === 21) return finalizeBJ(state, interaction);

  const { container, files } = await buildBJContainer(state, true);
  return interaction.editReply(v2Payload(container, files, ...buildBJComponents(state)));
}

export async function handleBJStand(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = blackjackGames.get(targetId);
  if (!state) return interaction.update({ components: [] });

  await interaction.deferUpdate();
  state.moves = (state.moves ?? 0) + 1;
  return finalizeBJ(state, interaction);
}

export async function handleBJDouble(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = blackjackGames.get(targetId);
  if (!state || state.status !== 'playing') return interaction.update({ components: [] });
  if (state.player.length !== 2) {
    return interaction.reply({
      content: '💰 Dobrar só fica disponível antes de pedir a primeira carta.',
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();
  const extraBet = state.bet;
  const spent = await spendCoins(prisma, {
    userId: state.userId,
    guildId: state.guildId,
    amount: extraBet,
  });
  if (!spent.ok) {
    return interaction.followUp({
      content: `❌ Você precisa de mais **${fmtNum(extraBet)} coins** disponíveis para dobrar.`,
      ephemeral: true,
    });
  }

  state.bet += extraBet;
  state.moves = (state.moves ?? 0) + 1;
  state.player.push(state.deck.pop());
  const total = handTotal(state.player);
  if (total > 21) {
    state.status = 'done';
    state.bust = true;
    state.result = 'bust';
    state.payout = 0;
    blackjackGames.delete(targetId);
    const { container, files } = await buildBJContainer(state);
    return interaction.editReply(v2Payload(container, files));
  }

  return finalizeBJ(state, interaction);
}

export async function handleBJInsurance(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = blackjackGames.get(targetId);
  if (!state || state.status !== 'playing') {
    return interaction.reply({ content: 'Esta mão já terminou.', ephemeral: true });
  }
  if (state.player.length !== 2 || state.dealer[0]?.rank !== 'A' || state.insuranceTaken) {
    return interaction.reply({
      content: '🛡️ O seguro só pode ser contratado uma vez, enquanto o dealer mostra um Ás.',
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();
  const insurance = Math.ceil(state.bet / 2);
  const spent = await spendCoins(prisma, {
    userId: state.userId,
    guildId: state.guildId,
    amount: insurance,
  });
  if (!spent.ok) {
    return interaction.followUp({
      content: `❌ Você precisa de mais **${fmtNum(insurance)} coins** para contratar o seguro.`,
      ephemeral: true,
    });
  }

  state.insurance = insurance;
  state.insuranceTaken = true;

  if (handTotal(state.dealer) === 21) {
    state.status = 'done';
    state.result = 'dealer_blackjack';
    state.payout = insurance * 3;
    await addWin(state.userId, state.guildId, state.payout);
    blackjackGames.delete(targetId);
    const { container, files } = await buildBJContainer(state);
    return interaction.editReply(v2Payload(container, files));
  }

  const { container, files } = await buildBJContainer(state, true);
  return interaction.editReply(v2Payload(container, files, ...buildBJComponents(state)));
}

export async function handleBJHint(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = blackjackGames.get(targetId);
  if (!state || state.status !== 'playing') {
    return interaction.reply({ content: 'Esta mão já terminou.', ephemeral: true });
  }

  const total = handTotal(state.player);
  const dealerUpValue = cardValue(state.dealer[0].rank);
  let advice;
  if (total <= 11) {
    advice = 'Pedir carta é seguro: você ainda não estoura com uma carta comum.';
  } else if (total >= 17) {
    advice = 'Sua mão já está forte. Parar costuma ser a opção mais segura.';
  } else if (dealerUpValue >= 7) {
    advice = 'O dealer mostra uma carta forte. Pedir carta pode ser necessário para disputar.';
  } else {
    advice = 'O dealer mostra uma carta fraca. Parar pode fazer o dealer estourar.';
  }

  return interaction.reply({
    content: `💡 **Dica do dealer:** você está em **${total}**. ${advice}`,
    ephemeral: true,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CRASH
// ══════════════════════════════════════════════════════════════════════════════

const CRASH_TICK_MS = 1_200;
const CRASH_MIN_CASHOUT_MS = CRASH_WARMUP_MS;
const CRASH_TIMEOUT_MS = 180_000;

function crashPayout(state) {
  return Math.floor(state.bet * (state.multiplier ?? 1));
}

function buildCrashText(state) {
  const multiplier = Number(state.multiplier ?? 1).toFixed(2).replace('.', ',');
  const crashPoint = Number(state.crashAt).toFixed(2).replace('.', ',');

  if (state.status === 'playing') {
    return (
      `## CRASH • ${multiplier}x\n` +
      `A curva está subindo. Saque agora ou assuma o risco de continuar.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Retorno atual: **${fmtNum(crashPayout(state))} coins**`
    );
  }

  if (state.status === 'cashed') {
    return (
      `## CRASH • saque confirmado em ${multiplier}x\n` +
      `Você saiu antes da quebra e garantiu seu retorno.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Retorno: **${fmtNum(state.payout)} coins**`
    );
  }

  return (
    `## CRASH • quebrou em ${crashPoint}x\n` +
    `A curva caiu antes do saque. A aposta desta rodada foi perdida.\n\n` +
    `Aposta: **${fmtNum(state.bet)} coins** • Retorno: **0 coins**`
  );
}

async function buildCrashPayload(state) {
  const image = generateCrashCard({
    multiplier: state.multiplier,
    crashAt: state.crashAt,
    status: state.status,
    bet: state.bet,
    payout: state.payout ?? 0,
    elapsedMs: Date.now() - state.startedAt,
  });
  const filename = `crash_${state.userId}_${state.tick}_${state.status}_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(image, { name: filename });
  const container = new ContainerBuilder()
    .setAccentColor(state.status === 'crashed' ? 0xff5578 : state.status === 'cashed' ? 0x63d99c : 0x38c8e8)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildCrashText(state)));

  return { container, files: [attachment] };
}

function buildCrashComponents(state) {
  if (state.status !== 'playing') return [];
  const cashoutAvailable = Date.now() - state.startedAt >= CRASH_MIN_CASHOUT_MS;
  const remainingSeconds = Math.max(
    1,
    Math.ceil((CRASH_MIN_CASHOUT_MS - (Date.now() - state.startedAt)) / 1_000),
  );
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`crash_cashout_${state.userId}`)
        .setLabel(cashoutAvailable
          ? `Sacar — ${fmtNum(crashPayout(state))}`
          : `Saque disponível em ${remainingSeconds}s`)
        .setEmoji('💰')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!cashoutAvailable),
    ),
  ];
}

async function settleCrash(state, status, multiplier, edit) {
  if (state.status !== 'playing') return;

  state.status = status;
  state.multiplier = multiplier;
  state.payout = status === 'cashed' ? crashPayout(state) : 0;
  clearCrashTimer(state);

  if (state.payout > 0) await addWin(state.userId, state.guildId, state.payout);
  crashGames.delete(state.userId);

  const { container, files } = await buildCrashPayload(state);
  return edit(v2Payload(container, files, ...buildCrashComponents(state)));
}

async function updateCrash(state, edit) {
  if (state.status !== 'playing' || state.updating) return;
  state.updating = true;

  try {
    const multiplier = crashMultiplier(state);
    if (multiplier >= state.crashAt) {
      return await settleCrash(state, 'crashed', state.crashAt, edit);
    }

    state.multiplier = multiplier;
    state.tick += 1;
    const { container, files } = await buildCrashPayload(state);
    return await edit(v2Payload(container, files, ...buildCrashComponents(state)));
  } finally {
    state.updating = false;
  }
}

export async function startCrash(ctx, bet, sendFn) {
  const userId = ctx.user?.id ?? ctx.author?.id;
  const guildId = ctx.guildId;

  if (crashGames.has(userId)) {
    return sendFn({ content: '❌ Você já tem uma rodada de Crash em andamento!' });
  }

  const eco = await getEco(userId, guildId);
  const available = totalCoins(eco);
  if (bet > available) {
    return sendFn({ content: `❌ Saldo insuficiente. Você tem **${fmtNum(available)} ${COIN()}** disponíveis entre carteira e banco.` });
  }

  await deductBet(userId, guildId, bet);

  const state = {
    userId,
    guildId,
    bet,
    crashAt: pickCrashPoint(),
    multiplier: 1,
    payout: 0,
    status: 'playing',
    startedAt: Date.now(),
    tick: 0,
    intervalId: null,
    timeoutId: null,
    updating: false,
  };
  crashGames.set(userId, state);

  try {
    const { container, files } = await buildCrashPayload(state);
    const sentMessage = await sendFn(v2Payload(container, files, ...buildCrashComponents(state)));
    const edit = typeof sentMessage?.edit === 'function'
      ? payload => sentMessage.edit(payload)
      : payload => ctx.editReply(payload);

    state.intervalId = setInterval(() => {
      updateCrash(state, edit).catch(() => {});
    }, CRASH_TICK_MS);
    state.timeoutId = setTimeout(() => {
      settleCrash(state, 'crashed', state.crashAt, edit).catch(() => {});
    }, CRASH_TIMEOUT_MS);

    return sentMessage;
  } catch (error) {
    clearCrashTimer(state);
    crashGames.delete(userId);
    await addWin(userId, guildId, bet).catch(() => {});
    throw error;
  }
}

export async function handleCrashCashout(interaction, targetId) {
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: '❌ Esta não é a sua rodada!', ephemeral: true });
  }

  const state = crashGames.get(targetId);
  if (!state || state.status !== 'playing') {
    return interaction.reply({ content: 'Esta rodada já terminou.', ephemeral: true });
  }

  await interaction.deferUpdate();
  const elapsed = Date.now() - state.startedAt;
  if (elapsed < CRASH_MIN_CASHOUT_MS) {
    const remainingSeconds = Math.max(1, Math.ceil((CRASH_MIN_CASHOUT_MS - elapsed) / 1_000));
    return interaction.followUp({
      content: `⏳ Aguarde mais **${remainingSeconds}s** para sacar. No aquecimento, o retorno cresce apenas alguns centavos.`,
      ephemeral: true,
    });
  }

  const multiplier = crashMultiplier(state);
  if (multiplier >= state.crashAt) {
    return settleCrash(state, 'crashed', state.crashAt, payload => interaction.editReply(payload));
  }

  state.multiplier = multiplier;
  return settleCrash(state, 'cashed', multiplier, payload => interaction.editReply(payload));
}

// ══════════════════════════════════════════════════════════════════════════════
// DISPUTA DE PÊNALTIS
// ══════════════════════════════════════════════════════════════════════════════

const PENALTY_ROUNDS = 5;
const PENALTY_MULTIPLIERS = [1.28, 1.72, 2.35, 3.35, 4.85];
const PENALTY_DIRECTIONS = ['left', 'center', 'right'];
const PENALTY_LABELS = {
  left: 'esquerda',
  center: 'meio',
  right: 'direita',
};

function pickPenaltyDirection() {
  return PENALTY_DIRECTIONS[Math.floor(Math.random() * PENALTY_DIRECTIONS.length)];
}

function penaltyPayout(state) {
  return Math.floor(state.bet * (state.multiplier ?? 1));
}

function penaltyStatusText(state) {
  const payout = fmtNum(state.payout);
  const round = Math.min(state.round + 1, PENALTY_ROUNDS);

  if (state.status === 'choosing') {
    return (
      `## DISPUTA DE PÊNALTIS • cobrança ${round}/${PENALTY_ROUNDS}\n` +
      `Escolha o canto e tente vencer o goleiro. O próximo gol aumenta seu multiplicador.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Saque disponível: **${payout} coins**`
    );
  }

  if (state.status === 'goal') {
    return (
      `## GOL! • ${state.goals}/${PENALTY_ROUNDS} cobranças convertidas\n` +
      `Você marcou no canto ${PENALTY_LABELS[state.lastShot]}. Continue para buscar um multiplicador maior ou saque agora.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Saque disponível: **${payout} coins**`
    );
  }

  if (state.status === 'won') {
    return (
      `## SEQUÊNCIA COMPLETA • ${PENALTY_ROUNDS}/${PENALTY_ROUNDS}\n` +
      `Perfeito! Você converteu todas as cobranças e garantiu o prêmio máximo.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Retorno: **${payout} coins**`
    );
  }

  if (state.status === 'cashed') {
    return (
      `## SAQUE CONFIRMADO • ${state.goals}/${PENALTY_ROUNDS} cobranças\n` +
      `Você encerrou a disputa no momento certo e levou o retorno acumulado.\n\n` +
      `Aposta: **${fmtNum(state.bet)} coins** • Retorno: **${payout} coins**`
    );
  }

  return (
    `## DEFESA! • disputa encerrada\n` +
    `O goleiro acertou o canto e a sequência terminou nesta cobrança.\n\n` +
    `Aposta: **${fmtNum(state.bet)} coins** • Retorno: **0 coins**`
  );
}

async function buildPenaltyPayload(state) {
  state.renderId += 1;
  const image = generatePenaltyCard({
    round: state.round,
    goals: state.goals,
    status: state.status,
    shot: state.lastShot,
    keeperDirection: state.lastKeeperDirection,
    bet: state.bet,
    payout: state.payout,
    multiplier: state.multiplier,
  });
  const filename = `penalty_${state.userId}_${state.renderId}_${state.status}_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(image, { name: filename });
  const container = new ContainerBuilder()
    .setAccentColor(
      state.status === 'saved'
        ? 0xff5d7c
        : state.status === 'cashed' || state.status === 'won'
          ? 0x65d99b
          : 0x38c8e8,
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(penaltyStatusText(state)));

  return { container, files: [attachment] };
}

function buildPenaltyComponents(state) {
  if (state.status === 'choosing') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`penalty_shot_left_${state.userId}`)
          .setLabel('← Esquerda')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`penalty_shot_center_${state.userId}`)
          .setLabel('Centro')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`penalty_shot_right_${state.userId}`)
          .setLabel('Direita →')
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  if (state.status === 'goal') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`penalty_continue_${state.userId}`)
          .setLabel(`Bater o ${state.round + 1}º pênalti`)
          .setEmoji('⚽')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`penalty_cashout_${state.userId}`)
          .setLabel(`Sacar — ${fmtNum(state.payout)}`)
          .setEmoji('💰')
          .setStyle(ButtonStyle.Success),
      ),
    ];
  }

  return [];
}

async function renderPenalty(state, edit) {
  const { container, files } = await buildPenaltyPayload(state);
  return edit(v2Payload(container, files, ...buildPenaltyComponents(state)));
}

export async function startPenalty(ctx, bet, sendFn) {
  const userId = ctx.user?.id ?? ctx.author?.id;
  const guildId = ctx.guildId;

  if (isEconomyGameActive(userId)) {
    return sendFn({ content: '❌ Finalize seu jogo atual antes de iniciar uma disputa de pênaltis.' });
  }

  const eco = await getEco(userId, guildId);
  const available = totalCoins(eco);
  if (bet > available) {
    return sendFn({ content: `❌ Saldo insuficiente. Você tem **${fmtNum(available)} ${COIN()}** disponíveis entre carteira e banco.` });
  }

  await deductBet(userId, guildId, bet);

  const state = {
    userId,
    guildId,
    bet,
    round: 0,
    goals: 0,
    multiplier: 1,
    payout: 0,
    status: 'choosing',
    lastShot: null,
    lastKeeperDirection: 'center',
    keeperDirections: Array.from({ length: PENALTY_ROUNDS }, pickPenaltyDirection),
    renderId: 0,
    resolving: false,
  };
  penaltyGames.set(userId, state);

  try {
    return await renderPenalty(state, payload => sendFn(payload));
  } catch (error) {
    penaltyGames.delete(userId);
    await addWin(userId, guildId, bet).catch(() => {});
    throw error;
  }
}

export async function handlePenaltyShot(interaction, direction, targetId) {
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: '❌ Esta não é a sua disputa!', ephemeral: true });
  }

  const state = penaltyGames.get(targetId);
  if (!state || state.status !== 'choosing') {
    return interaction.reply({ content: 'Escolha uma ação nos botões atuais da disputa.', ephemeral: true });
  }
  if (state.resolving) {
    return interaction.reply({ content: '⏳ Aguarde o resultado desta cobrança.', ephemeral: true });
  }

  state.resolving = true;
  await interaction.deferUpdate();

  try {
    const keeperDirection = state.keeperDirections[state.round];
    state.lastShot = direction;
    state.lastKeeperDirection = keeperDirection;
    state.round += 1;

    if (direction === keeperDirection) {
      state.status = 'saved';
      state.multiplier = 1;
      state.payout = 0;
      penaltyGames.delete(targetId);
      return renderPenalty(state, payload => interaction.editReply(payload));
    }

    state.goals += 1;
    state.multiplier = PENALTY_MULTIPLIERS[state.goals - 1];
    state.payout = penaltyPayout(state);

    if (state.goals === PENALTY_ROUNDS) {
      state.status = 'won';
      await addWin(state.userId, state.guildId, state.payout);
      penaltyGames.delete(targetId);
    } else {
      state.status = 'goal';
    }

    return renderPenalty(state, payload => interaction.editReply(payload));
  } finally {
    state.resolving = false;
  }
}

export async function handlePenaltyContinue(interaction, targetId) {
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: '❌ Esta não é a sua disputa!', ephemeral: true });
  }

  const state = penaltyGames.get(targetId);
  if (!state || state.status !== 'goal') {
    return interaction.reply({ content: 'Você só pode continuar depois de marcar um gol.', ephemeral: true });
  }
  if (state.resolving) {
    return interaction.reply({ content: '⏳ Aguarde a atualização da disputa.', ephemeral: true });
  }

  state.resolving = true;
  await interaction.deferUpdate();
  try {
    state.status = 'choosing';
    state.lastShot = null;
    state.lastKeeperDirection = 'center';
    return renderPenalty(state, payload => interaction.editReply(payload));
  } finally {
    state.resolving = false;
  }
}

export async function handlePenaltyCashout(interaction, targetId) {
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: '❌ Esta não é a sua disputa!', ephemeral: true });
  }

  const state = penaltyGames.get(targetId);
  if (!state || state.status !== 'goal') {
    return interaction.reply({ content: 'O saque só fica disponível depois de um gol.', ephemeral: true });
  }
  if (state.resolving) {
    return interaction.reply({ content: '⏳ Aguarde a atualização da disputa.', ephemeral: true });
  }

  state.resolving = true;
  await interaction.deferUpdate();
  try {
    state.status = 'cashed';
    await addWin(state.userId, state.guildId, state.payout);
    penaltyGames.delete(targetId);
    return renderPenalty(state, payload => interaction.editReply(payload));
  } finally {
    state.resolving = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MINES
// ══════════════════════════════════════════════════════════════════════════════

const GRID = 4;

function calcMult(gems, bombs) {
  if (gems === 0) return 1;
  const total = GRID * GRID;
  const safe  = total - bombs;
  let m = 1;
  for (let i = 0; i < gems; i++) m *= (total - i) / (safe - i);
  return Math.round(m * 0.97 * 100) / 100;
}

async function buildMinesPayload(state) {
  const mult   = calcMult(state.gems, state.bombs);
  const payout = Math.floor(state.bet * mult);

  const accentColor = 0x000000;

  const titleLine = state.status === 'lost'   ? `## ${getEmoji('05_angels')} Fim de jogo!`
    : state.status === 'cashed'               ? `## ${getEmoji('dinheiro_kingbuxx')} Fim de jogo!`
    : `## ${getEmoji('Diamante')} Mines`;

  const gainLine = state.status === 'lost'
    ? `> ${getEmoji('c_flymoney')} **Ganhos:** 0 ${COIN()}`
    : `> ${getEmoji('c_flymoney')} **Ganhos:** ${fmtNum(payout)} ${COIN()}`;

  const statusLine = state.status === 'playing'
    ? `\n> ${getEmoji('p_bom')} **Minas:** ${state.bombs} | ${getEmoji('Diamante')} **Reveladas:** ${state.gems}`
    : '';

  const text = `${titleLine}\n\n> ${getEmoji('f_3bat')} **Aposta:** ${fmtNum(state.bet)} ${COIN()}\n${gainLine}${statusLine}`;

  const container = new ContainerBuilder().setAccentColor(accentColor);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  let files = [];
  try {
    const imgBuf = await generateDarkMinesGrid({
      grid:     state.grid,
      revealed: state.revealed,
      status:   state.status,
    });
    const attachment = new AttachmentBuilder(imgBuf, { name: 'mines.png' });
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://mines.png'),
      ),
    );
    files = [attachment];
  } catch {}

  return { container, files };
}

function buildMinesComponents(state) {
  const rows = [];
  const done = state.status !== 'playing';

  for (let r = 0; r < GRID; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < GRID; c++) {
      const idx        = r * GRID + c;
      const isRevealed = state.revealed[idx];
      const isBomb     = state.grid[idx];

      let emoji    = '⬜';
      let style    = ButtonStyle.Secondary;
      let disabled = done;

      if (isRevealed) {
        emoji    = isBomb ? getEmoji('p_bom') : getEmoji('Diamante');
        style    = isBomb ? ButtonStyle.Danger : ButtonStyle.Success;
        disabled = true;
      } else if (done && isBomb) {
        emoji    = getEmoji('p_bom');
        style    = ButtonStyle.Danger;
        disabled = true;
      } else if (done) {
        disabled = true;
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_cell_${idx}_${state.userId}`)
          .setEmoji(emoji)
          .setStyle(style)
          .setDisabled(disabled),
      );
    }
    rows.push(row);
  }

  if (!done) {
    const canCash = state.gems > 0;
    const mult    = calcMult(state.gems, state.bombs);
    const payout  = Math.floor(state.bet * mult);
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_cashout_${state.userId}`)
          .setLabel(canCash ? `Sacar — ${fmtNum(payout)}` : 'Sacar (revele uma gema primeiro)')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!canCash),
      ),
    );
  }

  return rows;
}

export async function startMines(ctx, bet, bombs, sendFn) {
  const userId  = ctx.user?.id ?? ctx.author?.id;
  const guildId = ctx.guildId;
  const total = GRID * GRID;

  if (minesGames.has(userId))
    return sendFn({ content: '❌ Você já tem um jogo de mines em andamento!' });
  if (bombs < 1 || bombs >= total)
    return sendFn({ content: `❌ Número de bombas inválido (1–${total - 1}).` });

  const eco = await getEco(userId, guildId);
  const available = totalCoins(eco);
  if (bet > available)
    return sendFn({ content: `❌ Saldo insuficiente. Você tem **${fmtNum(available)} ${COIN()}** disponíveis entre carteira e banco.` });

  await deductBet(userId, guildId, bet);

  const bombSet = new Set();
  while (bombSet.size < bombs) bombSet.add(Math.floor(Math.random() * total));
  const grid = Array.from({ length: total }, (_, i) => bombSet.has(i));

  const state = {
    userId, guildId, bet, bombs,
    grid,
    revealed: Array(total).fill(false),
    gems: 0,
    status: 'playing',
  };

  minesGames.set(userId, state);

  // Auto-cashout after 5 min
  setTimeout(async () => {
    const s = minesGames.get(userId);
    if (s?.status === 'playing') {
      minesGames.delete(userId);
      const p = s.gems > 0 ? Math.floor(s.bet * calcMult(s.gems, s.bombs)) : s.bet;
      await addWin(userId, guildId, p).catch(() => {});
    }
  }, 300_000);

  const { container, files } = await buildMinesPayload(state);
  return sendFn(v2Payload(container, files, ...buildMinesComponents(state)));
}

export async function handleMinesCell(interaction, idx, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = minesGames.get(targetId);
  if (!state || state.status !== 'playing') return interaction.update({ components: [] });

  state.revealed[idx] = true;

  if (state.grid[idx]) {
    state.revealed = state.revealed.map(() => true);
    state.status = 'lost';
    minesGames.delete(targetId);
    const { container, files } = await buildMinesPayload(state);
    return interaction.update(v2Payload(container, files, ...buildMinesComponents(state)));
  }

  state.gems++;
  const totalSafe = GRID * GRID - state.bombs;

  if (state.gems >= totalSafe) {
    const payout = Math.floor(state.bet * calcMult(state.gems, state.bombs));
    state.status   = 'cashed';
    state.revealed = state.revealed.map(() => true);
    minesGames.delete(targetId);
    await addWin(targetId, state.guildId, payout);
    const { container, files } = await buildMinesPayload(state);
    return interaction.update(v2Payload(container, files, ...buildMinesComponents(state)));
  }

  const { container, files } = await buildMinesPayload(state);
  return interaction.update(v2Payload(container, files, ...buildMinesComponents(state)));
}

export async function handleMinesCashout(interaction, targetId) {
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Este não é o seu jogo!', ephemeral: true });

  const state = minesGames.get(targetId);
  if (!state || state.status !== 'playing') return interaction.update({ components: [] });
  if (state.gems === 0)
    return interaction.reply({ content: '❌ Revele pelo menos uma gema antes de sacar.', ephemeral: true });

  const payout = Math.floor(state.bet * calcMult(state.gems, state.bombs));
  state.status   = 'cashed';
  state.revealed = state.revealed.map(() => true);
  minesGames.delete(targetId);
  await addWin(targetId, state.guildId, payout);

  const { container, files } = await buildMinesPayload(state);
  return interaction.update(v2Payload(container, files, ...buildMinesComponents(state)));
}
