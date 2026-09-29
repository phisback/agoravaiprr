import prisma from '../database/client.js';
import { totalCoins } from './economyFunds.js';

export const CARD_DAILY_REQUIREMENTS = Object.freeze({
  opened: 1,
  discovered: 2,
  sold: 1,
});

const DAILY_REWARD_COINS = 5000;
const DAILY_REWARD_FRAGMENTS = 20;
const DAILY_REWARD_TICKETS = 1;

function currentDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export async function getCardWallet(db = prisma, userId) {
  const dayKey = currentDayKey();
  const wallet = await db.cardWallet.upsert({
    where: { userId },
    create: { userId, dailyKey: dayKey },
    update: {},
  });
  if (wallet.dailyKey === dayKey) return wallet;
  return db.cardWallet.update({
    where: { userId },
    data: {
      dailyKey: dayKey,
      dailyOpened: 0,
      dailyDiscovered: 0,
      dailySold: 0,
      dailyTrades: 0,
      dailyClaimed: false,
    },
  });
}

export async function incrementCardProgress(db, userId, values = {}) {
  await getCardWallet(db, userId);
  return db.cardWallet.update({
    where: { userId },
    data: {
      dailyOpened: { increment: values.opened ?? 0 },
      dailyDiscovered: { increment: values.discovered ?? 0 },
      dailySold: { increment: values.sold ?? 0 },
      dailyTrades: { increment: values.trades ?? 0 },
    },
  });
}

export async function recordCardTransaction(db, {
  userId,
  guildId,
  type,
  cardKey = null,
  quantity = 0,
  fragments = 0,
  coins = 0,
  metadata = null,
}) {
  if (!userId || !guildId || !type) return null;
  return db.cardTransaction.create({
    data: {
      userId,
      guildId,
      type,
      cardKey,
      quantity,
      fragments,
      coins,
      metadata: metadata == null ? null : JSON.stringify(metadata),
    },
  });
}

export function dailyMissionStatus(wallet) {
  return {
    opened: Math.min(wallet.dailyOpened, CARD_DAILY_REQUIREMENTS.opened),
    discovered: Math.min(wallet.dailyDiscovered, CARD_DAILY_REQUIREMENTS.discovered),
    sold: Math.min(wallet.dailySold, CARD_DAILY_REQUIREMENTS.sold),
    complete: wallet.dailyOpened >= CARD_DAILY_REQUIREMENTS.opened
      && wallet.dailyDiscovered >= CARD_DAILY_REQUIREMENTS.discovered
      && wallet.dailySold >= CARD_DAILY_REQUIREMENTS.sold,
  };
}

export function buildDailyMissionText(wallet) {
  const status = dailyMissionStatus(wallet);
  const claimedText = wallet.dailyClaimed
    ? '✅ Recompensa de hoje já foi resgatada.'
    : status.complete
      ? '🎁 Todas completas. Use `/cartas missoes resgatar:true` para receber a recompensa.'
      : 'Complete as três tarefas para liberar a recompensa.';
  return [
    '## Missões diárias de cartas',
    `📦 Abrir um pack: **${status.opened}/${CARD_DAILY_REQUIREMENTS.opened}**`,
    `✨ Descobrir cartas novas: **${status.discovered}/${CARD_DAILY_REQUIREMENTS.discovered}**`,
    `💰 Vender uma carta: **${status.sold}/${CARD_DAILY_REQUIREMENTS.sold}**`,
    '',
    claimedText,
    `Recompensa: **${DAILY_REWARD_COINS.toLocaleString('pt-BR')} coins** + **${DAILY_REWARD_FRAGMENTS} fragmentos** + **${DAILY_REWARD_TICKETS} ticket**.`,
    `Saldo de fragmentos: **${wallet.fragments}** · Tickets: **${wallet.tickets}**`,
  ].join('\n');
}

export async function claimDailyMissions(userId, guildId) {
  if (!guildId) return { ok: false, reason: 'As missões só podem ser resgatadas dentro de um servidor.' };
  return prisma.$transaction(async tx => {
    const wallet = await getCardWallet(tx, userId);
    const status = dailyMissionStatus(wallet);
    if (wallet.dailyClaimed) return { ok: false, reason: 'Você já resgatou as missões de hoje.' };
    if (!status.complete) return { ok: false, reason: 'Complete todas as missões antes de resgatar a recompensa.' };

    await tx.economy.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId, balance: DAILY_REWARD_COINS },
      update: { balance: { increment: DAILY_REWARD_COINS } },
    });
    const updated = await tx.cardWallet.update({
      where: { userId },
      data: {
        fragments: { increment: DAILY_REWARD_FRAGMENTS },
        tickets: { increment: DAILY_REWARD_TICKETS },
        dailyClaimed: true,
      },
    });
    await recordCardTransaction(tx, {
      userId,
      guildId,
      type: 'daily_mission',
      fragments: DAILY_REWARD_FRAGMENTS,
      coins: DAILY_REWARD_COINS,
      metadata: { tickets: DAILY_REWARD_TICKETS },
    });
    return {
      ok: true,
      coins: DAILY_REWARD_COINS,
      fragments: DAILY_REWARD_FRAGMENTS,
      tickets: DAILY_REWARD_TICKETS,
      wallet: updated,
    };
  });
}

export async function getCardMissionPayload(userId) {
  const wallet = await getCardWallet(prisma, userId);
  return {
    wallet,
    text: buildDailyMissionText(wallet),
    balance: totalCoins,
  };
}