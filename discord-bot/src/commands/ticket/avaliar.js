import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import prisma from '../../database/client.js';
import {
  buildStaffRatingPanel,
} from '../../utils/staffRating.js';

async function sendRatingPanel(target, memberId, guildId) {
  const ticket = await prisma.ticket.findUnique({ where: { channelId: target.id } });

  if (!ticket || ticket.guildId !== guildId) {
    return { error: 'Este canal não é um ticket.' };
  }
  if (ticket.userId !== memberId) {
    return { error: 'Apenas o membro que abriu este ticket pode avaliá-lo.' };
  }
  if (!['open', 'closing'].includes(ticket.status)) {
    return { error: 'Este ticket já foi fechado e não pode receber uma avaliação.' };
  }
  if (!ticket.claimedBy) {
    return { error: 'Ainda não há um atendente assumindo este ticket.' };
  }

  const existing = await prisma.staffRating.findUnique({
    where: { ticketId_reviewerId: { ticketId: ticket.id, reviewerId: memberId } },
  });
  if (existing) {
    return { error: 'Você já avaliou este ticket.' };
  }

  const staff = await target.guild.members.fetch(ticket.claimedBy).catch(() => null);
  const staffName = staff?.displayName ?? staff?.user?.username ?? 'o atendente';
  const panel = buildStaffRatingPanel(ticket, staffName);
  await target.send({ ...panel, flags: MessageFlags.IsComponentsV2 });
  return { ok: true };
}

export default {
  data: new SlashCommandBuilder()
    .setName('avaliar')
    .setDescription('Avalia o atendimento deste ticket'),
  name: 'avaliar',

  async execute(interaction) {
    const result = await sendRatingPanel(interaction.channel, interaction.user.id, interaction.guildId);
    if (result.error) {
      return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    }
    return interaction.reply({ content: '✅ Painel de avaliação enviado neste ticket.', ephemeral: true });
  },

  async executePrefix(message) {
    const result = await sendRatingPanel(message.channel, message.author.id, message.guildId);
    if (result.error) {
      await message.reply(`❌ ${result.error}`).catch(() => {});
    }
  },
};