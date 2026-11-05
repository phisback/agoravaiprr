import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import prisma from '../../database/client.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remover-banner')
    .setDescription('🗑️ [Admin] Remove um banner personalizado da loja')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  name: 'remover-banner',

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const banners = await prisma.customBanner.findMany({
      where: { guildId: interaction.guildId, active: true },
      orderBy: { name: 'asc' },
      select: { key: true, name: true, price: true },
    });

    if (!banners.length) {
      return interaction.editReply({ content: '❌ Não há banners personalizados na loja deste servidor.' });
    }

    const options = banners.slice(0, 25).map(b =>
      new StringSelectMenuOptionBuilder()
        .setLabel(b.name.slice(0, 100))
        .setValue(b.key)
        .setDescription(`${b.price.toLocaleString('pt-BR')} coins`.slice(0, 100))
        .setEmoji('🖼️')
    );

    const sel = new StringSelectMenuBuilder()
      .setCustomId('remover_banner_sel')
      .setPlaceholder('🗑️ Selecione o banner para remover')
      .addOptions(options);

    const lines = banners
      .slice(0, 25)
      .map(b => `> 🖼️ **${b.name}** — \`${b.price.toLocaleString('pt-BR')} coins\``)
      .join('\n')
      .slice(0, 3900);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Remover Banner da Loja')
      .setDescription(`**Selecione qual banner deseja remover:**\n\n${lines}`)
      .setFooter({ text: 'Savage Bot · Admin da Loja' });

    return interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(sel)],
    });
  },

  async executePrefix(message) {
    return message.reply({ content: '⚠️ Use o comando slash `/remover-banner` para remover banners.' });
  },
};
