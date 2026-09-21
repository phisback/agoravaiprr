import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STAFF_RATING_IMAGE_PATH = path.join(__dirname, '../../assets/staff-rating-star.webp');
export const STAFF_RATING_IMAGE_NAME = 'staff-rating-star.webp';

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function starsText(value) {
  const amount = Math.max(0, Math.min(5, Number(value) || 0));
  return `${'⭐'.repeat(amount)}${'☆'.repeat(5 - amount)}`;
}

export function buildStaffRatingPanel(ticket, staffName = 'atendente') {
  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text([
            '## Avalie o atendimento',
            '',
            `Como foi o atendimento de **${staffName}**?`,
            'Sua opinião ajuda a equipe a reconhecer bons atendimentos e melhorar sempre.',
          ].join('\n')),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${STAFF_RATING_IMAGE_NAME}`)),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text([
      '**Sua nota**',
      `${starsText(0)}`,
      '',
      '-# Escolha uma opção de 1 a 5 abaixo para avaliar o atendimento.',
    ].join('\n')));

  const row = new ActionRowBuilder().addComponents(
    ...[1, 2, 3, 4, 5].map(stars => new ButtonBuilder()
      .setCustomId(`staff_rating:${ticket.id}:${stars}`)
      .setLabel(String(stars))
      .setStyle(ButtonStyle.Secondary)),
  );

  return {
    components: [container, row],
  };
}

export function buildStaffRatingResult({
  reviewerId,
  staffId,
  stars,
  total,
  average,
  reason,
}) {
  const reasonText = reason?.trim() || 'Nenhum motivo informado.';
  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text([
            '## Avaliação registrada',
            '',
            'Obrigado por compartilhar sua experiência com a equipe.',
            'Sua avaliação foi salva com sucesso.',
          ].join('\n')),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${STAFF_RATING_IMAGE_NAME}`)),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text([
      '**Resumo da avaliação**',
      `**Avaliado por:** <@${reviewerId}>`,
      `**Staff:** <@${staffId}>`,
      `**Média do staff:** ${starsText(Math.round(Number(average)))} \`${Number(average).toFixed(1)} / 5\``,
      `**Avaliações recebidas:** ${total}`,
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(text([
      `**Sua nota:** ${starsText(stars)}`,
      `**Comentário:**\n> ${reasonText.replace(/\n/g, '\n> ')}`,
    ].join('\n')));

  return {
    components: [container],
    files: [
      new AttachmentBuilder(STAFF_RATING_IMAGE_PATH, { name: STAFF_RATING_IMAGE_NAME }),
    ],
  };
}