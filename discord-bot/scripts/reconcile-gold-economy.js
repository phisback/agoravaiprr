import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Valores usados antes do balanceamento. Eles representam o valor que cada
// cópia extra podia ter injetado na economia através do bug de duplicatas.
const LEGACY_GOLD_VALUES = Object.freeze({
  'gold-mega-greninja-ex': 72000,
  'gold-mega-gardevoir-ex': 68000,
  'gold-mega-darkrai-ex': 65000,
  'gold-mega-charizard-x-ex': 90000,
  'gold-mega-dragonite-ex': 78000,
  'gold-mega-charizard-y-ex': 75000,
  'gold-mewtwo-gx': 85000,
  'gold-mega-zygarde-ex': 63000,
  'gold-pikachu-japanese': 82000,
  'gold-mega-lucario-japanese-ex': 70000,
  'gold-pikachu-ex-japanese': 60000,
  'gold-mega-dragonite-thai-ex': 55000,
});

const GOLD_CARD_KEYS = Object.freeze(Object.keys(LEGACY_GOLD_VALUES));

function addUserRecovery(recoveries, row) {
  const extraCopies = Math.max(0, row.quantity - 1);
  if (!extraCopies) return;
  const current = recoveries.get(row.userId) ?? { copies: 0, amount: 0 };
  current.copies += extraCopies;
  current.amount += extraCopies * LEGACY_GOLD_VALUES[row.cardKey];
  recoveries.set(row.userId, current);
}

async function reconcileGoldEconomy() {
  const duplicateRows = await prisma.cardCollection.findMany({
    where: {
      cardKey: { in: GOLD_CARD_KEYS },
      quantity: { gt: 1 },
    },
    select: { userId: true, cardKey: true, quantity: true },
  });

  if (!duplicateRows.length) {
    console.log('[GOLD] Nenhuma duplicata Gold antiga encontrada.');
    return;
  }

  const recoveries = new Map();
  duplicateRows.forEach(row => addUserRecovery(recoveries, row));
  const result = {
    users: recoveries.size,
    duplicateCopiesRemoved: 0,
    coinsRecovered: 0,
    coinsNotRecovered: 0,
  };

  await prisma.$transaction(async tx => {
    for (const row of duplicateRows) {
      result.duplicateCopiesRemoved += row.quantity - 1;
      await tx.cardCollection.update({
        where: { userId_cardKey: { userId: row.userId, cardKey: row.cardKey } },
        data: { quantity: 1 },
      });
    }

    for (const [userId, recovery] of recoveries) {
      let remaining = recovery.amount;
      const economies = await tx.economy.findMany({
        where: { userId },
        orderBy: [{ balance: 'desc' }, { bank: 'desc' }],
        select: { id: true, balance: true, bank: true },
      });

      for (const economy of economies) {
        if (remaining <= 0) break;
        const fromBalance = Math.min(economy.balance, remaining);
        const fromBank = Math.min(economy.bank, remaining - fromBalance);
        const deduction = fromBalance + fromBank;
        if (!deduction) continue;

        await tx.economy.update({
          where: { id: economy.id },
          data: {
            balance: { decrement: fromBalance },
            bank: { decrement: fromBank },
          },
        });
        remaining -= deduction;
        result.coinsRecovered += deduction;
      }
      result.coinsNotRecovered += remaining;
    }
  });

  console.log(
    `[GOLD] Limpeza concluída: ${result.users} usuário(s), ` +
    `${result.duplicateCopiesRemoved} cópia(s) extra(s) removida(s), ` +
    `${result.coinsRecovered} coins recuperadas, ` +
    `${result.coinsNotRecovered} coins não recuperadas por falta de saldo disponível.`,
  );
}

reconcileGoldEconomy()
  .catch(error => {
    console.error('[GOLD] Falha na limpeza econômica:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());