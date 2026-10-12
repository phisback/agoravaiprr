import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const MODAL_PREFIX = 'falar_modal';
const MESSAGE_INPUT_ID = 'falar_texto';

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('falar')
    .setDescription('Envia uma mensagem de texto pelo bot neste canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  name: 'falar',

  async execute(interaction) {
    if (!interaction.guild || !interaction.channel?.send) {
      return interaction.reply({
        content: '❌ Use este comando em um canal de texto de um servidor.',
        ephemeral: true,
      });
    }

    if (!isAdministrator(interaction)) {
      return interaction.reply({
        content: '❌ Apenas administradores podem usar este comando.',
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}:${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`)
      .setTitle('Enviar mensagem pelo bot')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(MESSAGE_INPUT_ID)
            .setLabel('Mensagem (texto simples, sem embed)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Escreva a mensagem que o bot enviará neste canal')
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );

    return interaction.showModal(modal);
  },
};

export async function handleFalarModal(interaction) {
  const [prefix, guildId, channelId, userId] = interaction.customId.split(':');

  if (
    prefix !== MODAL_PREFIX
    || guildId !== interaction.guildId
    || userId !== interaction.user.id
  ) {
    return interaction.reply({
      content: '❌ Este formulário não pertence a você ou já não é válido.',
      ephemeral: true,
    });
  }

  if (!isAdministrator(interaction)) {
    return interaction.reply({
      content: '❌ Apenas administradores podem enviar mensagens pelo bot.',
      ephemeral: true,
    });
  }

  const message = interaction.fields.getTextInputValue(MESSAGE_INPUT_ID).trim();
  if (!message) {
    return interaction.reply({
      content: '❌ Escreva uma mensagem antes de enviar.',
      ephemeral: true,
    });
  }

  const channel = interaction.guild?.channels.cache.get(channelId)
    ?? await interaction.guild?.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return interaction.reply({
      content: '❌ Não consegui encontrar o canal onde o comando foi iniciado.',
      ephemeral: true,
    });
  }

  try {
    await channel.send({ content: message });
    return interaction.reply({
      content: `✅ Mensagem enviada em <#${channel.id}> pelo bot, sem embed.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('[FALAR] Falha ao enviar mensagem:', error?.message ?? error);
    return interaction.reply({
      content: '❌ Não consegui enviar a mensagem. Verifique se o bot pode enviar mensagens nesse canal.',
      ephemeral: true,
    });
  }
}
