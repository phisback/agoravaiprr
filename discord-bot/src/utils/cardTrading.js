import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../database/client.js';
import { CARD_MAX_COPIES, getCard, rarityData } from './cardData.js';
import { incrementCardProgress, recordCardTransaction } from './cardProgress.js';

const TRADE_TTL_MS = 10 * 60 * 1000;

function cardLabel(key) {
  const card = getCard(key);
  return card ? `${card.name} (${rarityData(card.rarity).label})` : key;
}

async function decrementCard(tx, userId, cardKey) {
  const row = await tx.cardCollection.findUnique({
    where: { userId_cardKey: { userId, cardKey } },
  });
  if (!row || row.quantity < 1) return false;
  if (row.quantity === 1) {
    await tx.cardCollection.delete({ where: { id: row.id } });
  } else {
    await tx.cardCollection.update({
      where: { id: row.id },
      data: { quantity: { decrement: 1 } },
    });
  }
  return true;
}

async function incrementCard(tx, userId, cardKey) {
  await tx.cardCollection.upsert({
    where: { userId_cardKey: { userId, cardKey } },
    create: { userId, cardKey, quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
}

export async function createCardTrade({
  guildId,
  fromUserId,
  toUserId,
  offeredCardKey,
  requestedCardKey,
}) {
  if (!guildId) return { ok: false, reason: 'As trocas só funcionam dentro de um servidor.' };
  if (!toUserId || toUserId === fromUserId) return { ok: false, reason: 'Escolha outro membro para a troca.' };
  const offered = getCard(offeredCardKey);
  const requested = getCard(requestedCardKey);
  if (!offered || !requested) return { ok: false, reason: 'Uma das cartas informadas não existe.' };
  if (offered.key === requested.key) return { ok: false, reason: 'Escolha cartas diferentes.' };
  if (offered.rarity !== requested.rarity) {
    return { ok: false, reason: 'A troca precisa usar cartas da mesma raridade.' };
  }

  const owned = await prisma.cardCollection.findUnique({
    where: { userId_cardKey: { userId: fromUserId, cardKey: offered.key } },
  });
  if (!owned || owned.quantity < 2) {
    return { ok: false, reason: 'Você precisa ter pelo menos 2 cópias da carta oferecida. A última cópia fica protegida.' };
  }

  const trade = await prisma.cardTrade.create({
    data: {
      guildId,
      fromUserId,
      toUserId,
      offeredCardKey: offered.key,
      requestedCardKey: requested.key,
      expiresAt: new Date(Date.now() + TRADE_TTL_MS),
    },
  });
  return { ok: true, trade, offered, requested };
}

export function buildTradePayload(trade, offered = getCard(trade.offeredCardKey), requested = getCard(trade.requestedCardKey)) {
  return {
    content: [
      '## 🔄 Proposta de troca de cartas',
      `<@${trade.fromUserId}> quer trocar **${cardLabel(offered.key)}**`,
      `por **${cardLabel(requested.key)}** de <@${trade.toUserId}>.`,
      '',
      'A proposta expira em 10 minutos. A última cópia de uma carta não pode ser oferecida.',
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`card_trade_accept:${trade.id}`)
          .setLabel('Aceitar troca')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`card_trade_reject:${trade.id}`)
          .setLabel('Recusar')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

export async function handleCardTradeInteraction(interaction) {
  const [action, tradeId] = interaction.customId.split(':');
  if (!tradeId) return interaction.reply({ content: 'Proposta inválida.', ephemeral: true });
  if (action === 'card_trade_reject') {
    await interaction.deferUpdate();
    const trade = await prisma.cardTrade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.status !== 'PENDING') {
      return interaction.editReply({ content: 'Esta proposta já foi encerrada.', components: [] });
    }
    if (![trade.fromUserId, trade.toUserId].includes(interaction.user.id)) {
      return interaction.followUp({ content: 'Você não participa desta troca.', ephemeral: true });
    }
    await prisma.cardTrade.update({ where: { id: trade.id }, data: { status: 'REJECTED' } });
    return interaction.editReply({ content: 'Troca recusada ou cancelada.', components: [] });
  }

  if (action !== 'card_trade_accept') return false;
  await interaction.deferUpdate();
  if (interaction.user.id === undefined) return interaction.editReply({ content: 'Usuário inválido.', components: [] });

  const result = await prisma.$transaction(async tx => {
    const trade = await tx.cardTrade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.status !== 'PENDING') return { ok: false, reason: 'Esta proposta já foi encerrada.' };
    if (trade.expiresAt <= new Date()) {
      await tx.cardTrade.update({ where: { id: trade.id }, data: { status: 'EXPIRED' } });
      return { ok: false, reason: 'Esta proposta expirou.' };
    }
    if (interaction.user.id !== trade.toUserId) return { ok: false, reason: 'Somente a pessoa convidada pode aceitar esta troca.' };
    if (interaction.guildId !== trade.guildId) return { ok: false, reason: 'Esta troca pertence a outro servidor.' };

    const offered = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId: trade.fromUserId, cardKey: trade.offeredCardKey } },
    });
    const requested = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId: trade.toUserId, cardKey: trade.requestedCardKey } },
    });
    if (!offered || offered.quantity < 2) return { ok: false, reason: 'Quem ofereceu a carta não possui mais 2 cópias disponíveis.' };
    if (!requested || requested.quantity < 2) {
      return { ok: false, reason: 'A última cópia da carta solicitada fica protegida e não pode ser trocada.' };
    }
    const receiverOffered = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId: trade.toUserId, cardKey: trade.offeredCardKey } },
    });
    const senderRequested = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId: trade.fromUserId, cardKey: trade.requestedCardKey } },
    });
    if ((receiverOffered?.quantity ?? 0) >= CARD_MAX_COPIES) {
      return { ok: false, reason: `A troca não pode deixar você com mais de ${CARD_MAX_COPIES} cópias da carta recebida.` };
    }
    if ((senderRequested?.quantity ?? 0) >= CARD_MAX_COPIES) {
      return { ok: false, reason: `A troca não pode deixar quem propôs com mais de ${CARD_MAX_COPIES} cópias da carta recebida.` };
    }

    await decrementCard(tx, trade.fromUserId, trade.offeredCardKey);
    await decrementCard(tx, trade.toUserId, trade.requestedCardKey);
    await incrementCard(tx, trade.toUserId, trade.offeredCardKey);
    await incrementCard(tx, trade.fromUserId, trade.requestedCardKey);
    await tx.cardTrade.update({ where: { id: trade.id }, data: { status: 'ACCEPTED' } });
    await incrementCardProgress(tx, trade.fromUserId, { trades: 1 });
    await incrementCardProgress(tx, trade.toUserId, { trades: 1 });
    await recordCardTransaction(tx, {
      userId: trade.fromUserId,
      guildId: trade.guildId,
      type: 'trade_sent',
      cardKey: trade.offeredCardKey,
      quantity: 1,
      metadata: { tradeId: trade.id, receivedCardKey: trade.requestedCardKey, partnerId: trade.toUserId },
    });
    await recordCardTransaction(tx, {
      userId: trade.toUserId,
      guildId: trade.guildId,
      type: 'trade_received',
      cardKey: trade.offeredCardKey,
      quantity: 1,
      metadata: { tradeId: trade.id, sentCardKey: trade.requestedCardKey, partnerId: trade.fromUserId },
    });
    return { ok: true, trade };
  });

  return interaction.editReply({
    content: result.ok
      ? '✅ Troca concluída com sucesso.'
      : `❌ ${result.reason}`,
    components: [],
  });
}