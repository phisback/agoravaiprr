import prisma from '../database/client.js';
import { spendCoins, totalCoins } from './economyFunds.js';

export const COMMAND_FINE_USER_ID = '1062078439433175090';
export const COMMAND_FINE_AMOUNT = 120_000_000;

function fineWhere() {
  return { userId: COMMAND_FINE_USER_ID };
}

export function isCommandFineTarget(userId) {
  return userId === COMMAND_FINE_USER_ID;
}

export async function ensureCommandFine() {
  return prisma.commandFine.upsert({
    where: fineWhere(),
    create: { userId: COMMAND_FINE_USER_ID, amount: COMMAND_FINE_AMOUNT },
    update: {},
  });
}

export async function getCommandFine(userId) {
  if (!isCommandFineTarget(userId)) return null;
  return ensureCommandFine();
}

export function isCommandFinePending(fine) {
  return Number(fine?.amount ?? 0) > 0;
}

export function commandFineMessage(fine) {
  const amount = Number(fine?.amount ?? COMMAND_FINE_AMOUNT);
  return (
    `🚔 Seus comandos estão bloqueados por uma multa pendente de **${amount.toLocaleString('pt-BR')} coins**.\n` +
    'Use **S pagar** para quitar a multa usando seu saldo deste servidor.'
  );
}

export async function payCommandFine(userId, guildId) {
  if (!isCommandFineTarget(userId)) return { status: 'not-required' };
  if (!guildId) return { status: 'guild-required' };

  return prisma.$transaction(async tx => {
    const fine = await tx.commandFine.upsert({
      where: fineWhere(),
      create: { userId: COMMAND_FINE_USER_ID, amount: COMMAND_FINE_AMOUNT },
      update: {},
    });
    const amount = Number(fine.amount ?? 0);
    if (amount <= 0) return { status: 'already-paid' };

    const economy = await tx.economy.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId },
      update: {},
    });
    const balance = totalCoins(economy);
    if (balance < amount) return { status: 'insufficient', amount, balance };

    const spent = await spendCoins(tx, { userId, guildId, amount });
    if (!spent.ok) return { status: 'insufficient', amount, balance };

    await tx.commandFine.update({
      where: fineWhere(),
      data: { amount: 0, paidAt: new Date() },
    });
    return { status: 'paid', amount };
  });
}