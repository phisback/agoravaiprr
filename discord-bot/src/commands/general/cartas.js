import {
  SlashCommandBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from 'discord.js';
import { fileURLToPath } from 'node:url';
import prisma from '../../database/client.js';
import { spendCoins, totalCoins } from '../../utils/economyFunds.js';
import {
  CARD_DEFS,
  CARD_PACKS,
  CARD_MAX_COPIES,
  getCardPack,
  cardSellValue,
  cardFragmentValue,
  cardCraftCost,
  rarityData,
  getCard,
  pickPackCards,
} from '../../utils/cardData.js';
import { generateCardSheet, generatePokedexSheet, loadPackBanner } from '../../utils/cardVisuals.js';
import {
  buildDailyMissionText,
  claimDailyMissions,
  getCardWallet,
  incrementCardProgress,
  recordCardTransaction,
} from '../../utils/cardProgress.js';
import { buildTradePayload, createCardTrade } from '../../utils/cardTrading.js';

function packCount(value) {
  return Math.min(Math.max(Number(value) || 1, 1), 10);
}

const packSessions = new Map();
const dexSessions = new Map();
const activeDexSessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;
const DEX_PAGE_SIZE = 8;
const SELL_PAGE_SIZE = 25;
const SHOWCASE_PAGE_SIZE = 9;
const SHOWCASE_COLUMNS = 3;
const PACK_COOLDOWN_MS = 5 * 60 * 1000;
const CARD_PICKER_PAGE_SIZE = 25;
const cardPickerSessions = new Map();
const FUT_TEST_CARDS = Object.freeze([
  {
    name: 'Paulo Dybala • 96 CF',
    path: fileURLToPath(new URL('../../assets/cards/fut-test-01.jpg', import.meta.url)),
    filename: 'fut-carta-1.jpg',
    type: 'imagem',
  },
  {
    name: 'Marcus Rashford • 95 MI',
    path: fileURLToPath(new URL('../../assets/cards/fut-test-02.jpg', import.meta.url)),
    filename: 'fut-carta-2.jpg',
    type: 'imagem',
  },
  {
    name: 'Carta FUT de teste #1',
    path: fileURLToPath(new URL('../../assets/cards/fut-test-01.gif', import.meta.url)),
    filename: 'fut-carta-3.gif',
    type: 'GIF',
  },
  {
    name: 'Carta FUT de teste #2',
    path: fileURLToPath(new URL('../../assets/cards/fut-test-02.gif', import.meta.url)),
    filename: 'fut-carta-4.gif',
    type: 'GIF',
  },
]);
const futPackSessions = new Map();

function createCardPickerSession({ userId, guildId, mode, targetId = null }) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  cardPickerSessions.set(token, {
    token,
    userId,
    guildId,
    mode,
    targetId,
    offeredCardKey: null,
    page: 0,
    expiresAt: Date.now() + SESSION_TTL,
  });
  return token;
}

function getCardPickerSession(token, userId, guildId) {
  const session = cardPickerSessions.get(token);
  if (
    !session
    || session.expiresAt < Date.now()
    || session.userId !== userId
    || session.guildId !== guildId
  ) {
    if (session?.expiresAt < Date.now()) cardPickerSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

async function getCardQuantities(userId) {
  const rows = await prisma.cardCollection.findMany({
    where: { userId, quantity: { gt: 0 } },
  });
  return new Map(rows.map(row => [row.cardKey, row.quantity]));
}

function cardPickerOption(card, quantity, suffix = '') {
  const data = rarityData(card.rarity);
  return {
    label: card.name.slice(0, 100),
    description: `${data.label} • ${quantity}x${suffix}`.slice(0, 100),
    value: card.key,
  };
}

async function buildCardPickerPayload(session) {
  const ownQuantities = await getCardQuantities(session.userId);
  let availableQuantities = ownQuantities;
  let cards = CARD_DEFS;
  let title = 'Escolha uma carta';
  let description = '';

  if (session.mode === 'craft') {
    title = 'Escolha a carta para craftar';
    description = 'Selecione pelo nome. O menu mostra sua quantidade e o custo em fragmentos.';
    cards = CARD_DEFS;
  } else if (session.mode === 'trade-offer') {
    title = 'Escolha a carta que você oferece';
    description = 'Só aparecem cartas com pelo menos 2 cópias, porque a última cópia fica protegida.';
    cards = CARD_DEFS.filter(card => (ownQuantities.get(card.key) ?? 0) >= 2);
  } else if (session.mode === 'trade-request') {
    availableQuantities = await getCardQuantities(session.targetId);
    const offered = getCard(session.offeredCardKey);
    title = 'Escolha a carta que você quer receber';
    description = `Mostrando cartas de <@${session.targetId}> da mesma raridade de **${offered?.name ?? 'sua oferta'}**.`;
    cards = CARD_DEFS.filter(card => (
      card.key !== session.offeredCardKey
      && card.rarity === offered?.rarity
      && (targetQuantities.get(card.key) ?? 0) >= 2
    ));
  }

  const totalPages = Math.max(1, Math.ceil(cards.length / CARD_PICKER_PAGE_SIZE));
  const safePage = Math.min(Math.max(session.page, 0), totalPages - 1);
  session.page = safePage;
  const pageCards = cards.slice(
    safePage * CARD_PICKER_PAGE_SIZE,
    (safePage + 1) * CARD_PICKER_PAGE_SIZE,
  );
  const options = pageCards.map(card => {
    const quantity = availableQuantities.get(card.key) ?? 0;
    const suffix = session.mode === 'craft'
      ? ` • craft: ${cardCraftCost(card)} fragmentos`
      : '';
    return cardPickerOption(card, quantity ?? 0, suffix);
  });

  const components = [];
  if (options.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`card_picker_select:${session.token}`)
          .setPlaceholder(title)
          .addOptions(options),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`card_picker_page:${session.token}:${safePage - 1}`)
        .setLabel('Página anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`card_picker_page:${session.token}:${safePage + 1}`)
        .setLabel('Próxima página')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId(`card_picker_cancel:${session.token}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return {
    content: [
      `## ${title}`,
      description,
      options.length
        ? `Página **${safePage + 1}/${totalPages}** · ${cards.length} carta(s) disponível(is).`
        : 'Nenhuma carta elegível está disponível neste momento.',
    ].join('\n\n'),
    components,
  };
}

function createPackSession({ userId, guildId, count, packKey = 'pokemon' }) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  packSessions.set(token, {
    token,
    userId,
    guildId,
    count,
    packKey,
    cards: null,
    index: 0,
    expiresAt: Date.now() + SESSION_TTL,
  });
  return token;
}

function getPackSession(token) {
  const session = packSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    packSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

function createFutPackSession({ userId, guildId }) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  futPackSessions.set(token, {
    userId,
    guildId,
    index: 0,
    expiresAt: Date.now() + SESSION_TTL,
  });
  return token;
}

function getFutPackSession(token) {
  const session = futPackSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    futPackSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

function buildFutPackCoverPayload(token) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Abrir FUT\n\n` +
        `Pacote teste gratuito com **4 cartas de futebol**: 2 cartas e 2 GIFs.\n` +
        `Tudo será revelado um por vez, exatamente como enviado.`,
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fut_pack_open:${token}`)
      .setLabel('Abrir FUT')
      .setStyle(ButtonStyle.Primary),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

function buildFutCardPayload(session) {
  const card = FUT_TEST_CARDS[session.index];
  const isLast = session.index >= FUT_TEST_CARDS.length - 1;
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${card.filename}`),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Carta FUT ${session.index + 1} de ${FUT_TEST_CARDS.length}\n\n` +
        `**${card.name}**\n` +
        `${card.type === 'GIF' ? 'GIF original' : 'Imagem original'} do pacote de teste.`,
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(isLast ? `fut_pack_finish:${session.token}` : `fut_pack_next:${session.token}`)
      .setLabel(isLast ? 'Ver pacote completo' : 'Próxima carta')
      .setStyle(ButtonStyle.Primary),
  );
  return {
    components: [container, row],
    files: [new AttachmentBuilder(card.path, { name: card.filename })],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildFutPackFinishedPayload() {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        ...FUT_TEST_CARDS.map(card =>
          new MediaGalleryItemBuilder().setURL(`attachment://${card.filename}`),
        ),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Abrir FUT concluído\n\n` +
        `Você revelou as **${FUT_TEST_CARDS.length} cartas** do pacote teste.`,
      ),
    );
  return {
    components: [container],
    files: FUT_TEST_CARDS.map(card => new AttachmentBuilder(card.path, { name: card.filename })),
    flags: MessageFlags.IsComponentsV2,
  };
}

function createDexSession({ userId, guildId, page = 0 }) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const session = {
    token,
    userId,
    guildId,
    page,
    expiresAt: Date.now() + SESSION_TTL,
  };
  dexSessions.set(token, session);
  activeDexSessions.set(`${guildId}:${userId}`, token);
  return token;
}

function getDexSession(token, userId = null, guildId = null) {
  let session = dexSessions.get(token);
  if (!session && userId && guildId) {
    const activeToken = activeDexSessions.get(`${guildId}:${userId}`);
    session = activeToken ? dexSessions.get(activeToken) : null;
  }
  if (!session || session.expiresAt < Date.now()) {
    if (token) dexSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

async function buildPackShopPayload(session) {
  const pack = getCardPack(session.packKey);
  const banner = await loadPackBanner();
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://pokemon-pack-shop-banner.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Loja de packs\n\n` +
        `Escolha um pacote para abrir. O pack selecionado é **${pack.name}**.\n` +
        `${pack.description}\n\n` +
        `**${pack.size} cartas** por **${pack.price.toLocaleString('pt-BR')} coins**` +
        `${session.count > 1 ? ` · ${session.count} packs = **${(pack.price * session.count).toLocaleString('pt-BR')} coins**` : ''}`,
      ),
    );
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pokemon_shop_select:${session.token}`)
      .setPlaceholder('Escolha o tipo de pack')
      .addOptions(Object.values(CARD_PACKS).map(option => ({
        label: option.name,
        description: option.available
          ? `${option.size} cartas · ${option.price.toLocaleString('pt-BR')} coins`
          : 'Em breve...',
        value: option.key,
        default: option.available && option.key === pack.key,
      }))),
  );
  const quantityRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pokemon_shop_quantity:${session.token}`)
      .setPlaceholder('Quantidade de pacotes')
      .addOptions(Array.from({ length: 10 }, (_, index) => ({
        label: `${index + 1} ${index === 0 ? 'pacote' : 'pacotes'}`,
        value: String(index + 1),
        default: session.count === index + 1,
      }))),
  );
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_shop_open:${session.token}`)
      .setLabel(session.count === 1 ? `Abrir ${pack.name}` : `Abrir ${session.count}x ${pack.name}`)
      .setStyle(ButtonStyle.Primary),
  );
  return {
    components: [container, selectRow, quantityRow, buttonRow],
    files: [new AttachmentBuilder(banner, { name: 'pokemon-pack-shop-banner.png' })],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildCardRevealPayload(session) {
  const card = session.cards[session.index];
  const pack = getCardPack(session.packKey);
  const isLast = session.index >= session.cards.length - 1;
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://carta-revelada.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${pack.name} · carta ${session.index + 1} de ${session.cards.length}\n\n` +
        `**${card.name}** — ${rarityData(card.rarity).label}`,
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(isLast ? `pokemon_pack_finish:${session.token}` : `pokemon_pack_next:${session.token}`)
      .setLabel(isLast ? 'Ver pack completo' : 'Passar carta')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pokemon_pack_all:${session.token}`)
      .setLabel('Abrir tudo')
      .setStyle(ButtonStyle.Success),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

function buildPackShopBackRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_shop_back:${token}`)
      .setLabel('Voltar à loja')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildPackShopBackSection(token) {
  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Volte à loja para escolher outro pacote.'),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(`pokemon_shop_back:${token}`)
        .setLabel('Voltar à loja')
        .setStyle(ButtonStyle.Secondary),
    );
}

function buildPackFinishedPayload(session) {
  const pack = getCardPack(session.packKey);
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://cartas-pokemon.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${pack.name} completo\n\n` +
        session.cards.map((card, i) => `${i + 1}. **${card.name}** — ${rarityData(card.rarity).label}`).join('\n') +
        `\n\n${session.duplicates
          ? `♻️ ${session.duplicates} duplicata(s) adicionada(s) à coleção.`
          : '✨ Todas as cartas são novas!'}` +
        `${session.fragments ? `\n🧩 Cartas excedentes convertidas em **${session.fragments} fragmentos**.` : ''}`,
      ),
    )
    .addSectionComponents(buildPackShopBackSection(session.token));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function getEco(userId, guildId, db = prisma) {
  return db.economy.upsert({
    where: { userId_guildId: { userId, guildId } },
    create: { userId, guildId },
    update: {},
  });
}

async function buildDexPayload({ userId, guildId, token, page }) {
  const rows = await prisma.cardCollection.findMany({ where: { userId } });
  const owned = new Map(rows.map(row => [row.cardKey, row.quantity]));
  const wallet = await getCardWallet(prisma, userId);
  const totalPages = Math.max(1, Math.ceil(CARD_DEFS.length / DEX_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageCards = CARD_DEFS.slice(safePage * DEX_PAGE_SIZE, (safePage + 1) * DEX_PAGE_SIZE);
  const image = await generatePokedexSheet(pageCards, new Set(owned.keys()), { columns: 4 });
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://pokedex-pokemon.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Pokédex Pokémon\n` +
        `**${owned.size}/${CARD_DEFS.length}** cartas descobertas • Página **${safePage + 1}/${totalPages}**\n` +
        `Cartas bloqueadas aparecem esmaecidas. Use o menu abaixo para abrir uma carta.\n` +
        `🧩 Fragmentos: **${wallet.fragments}** · 🎟️ Tickets: **${wallet.tickets}**`,
      ),
    );
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pokemon_dex_card:${token}`)
      .setPlaceholder('Escolha uma carta para ver e vender')
      .addOptions(pageCards.map(card => ({
        label: card.name.slice(0, 100),
        description: `${rarityData(card.rarity).label}${owned.has(card.key) ? ` • possui ${owned.get(card.key)}x` : ' • não descoberta'}`,
        value: card.key,
      }))),
  );
  const navigationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_dex_page:${token}:${safePage - 1}`)
      .setLabel('Página anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId(`pokemon_dex_page:${token}:${safePage + 1}`)
      .setLabel('Próxima página')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`pokemon_vitrine:${token}:0`)
      .setLabel('Vitrine')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pokemon_sell:${token}:0`)
      .setLabel('Vender cartas')
      .setStyle(ButtonStyle.Success),
  );
  return {
    content: null,
    files: [new AttachmentBuilder(image, { name: 'pokedex-pokemon.png' })],
    components: [container, selectRow, navigationRow],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function buildSellPayload({ userId, guildId, token, page = 0 }) {
  const ownedCards = await getOwnedCards(userId);
  const totalPages = Math.max(1, Math.ceil(ownedCards.length / SELL_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageCards = ownedCards.slice(safePage * SELL_PAGE_SIZE, (safePage + 1) * SELL_PAGE_SIZE);
  const totalCopies = ownedCards.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = ownedCards.reduce(
    (sum, item) => sum + cardSellValue(item.card) * item.quantity,
    0,
  );
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Vender cartas\n\n` +
      (ownedCards.length
        ? `Selecione uma carta que você possui. Página **${safePage + 1}/${totalPages}**.\n` +
          `Você possui **${totalCopies}** carta(s) em **${ownedCards.length}** tipo(s), valendo até **${totalValue.toLocaleString('pt-BR')} coins**.`
        : 'Você ainda não possui cartas para vender.'),
    ),
  );
  const components = [container];
  if (pageCards.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pokemon_sell_card:${token}`)
        .setPlaceholder('Escolha uma carta para vender')
        .addOptions(pageCards.map(({ card, quantity }) => ({
          label: card.name.slice(0, 100),
          description: `${quantity}x • ${cardSellValue(card).toLocaleString('pt-BR')} coins por unidade`,
          value: card.key,
        }))),
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_sell_page:${token}:${safePage - 1}`)
      .setLabel('Página anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId(`pokemon_sell_page:${token}:${safePage + 1}`)
      .setLabel('Próxima página')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`pokemon_sell_all:${token}:${safePage}`)
      .setLabel('Vender todas as cartas')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!ownedCards.length),
    new ButtonBuilder()
      .setCustomId(`pokemon_collection_back:${token}`)
      .setLabel('Voltar à coleção')
      .setStyle(ButtonStyle.Secondary),
  ));
  return { content: null, components, flags: MessageFlags.IsComponentsV2 };
}

async function getOwnedCards(userId) {
  const rows = await prisma.cardCollection.findMany({
    where: { userId, quantity: { gt: 0 } },
    orderBy: { cardKey: 'asc' },
  });
  return rows
    .map(row => ({ card: getCard(row.cardKey), quantity: row.quantity }))
    .filter(item => item.card);
}

async function buildSellAllConfirmationPayload({ userId, token, page = 0 }) {
  const ownedCards = await getOwnedCards(userId);
  const totalCopies = ownedCards.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = ownedCards.reduce(
    (sum, item) => sum + cardSellValue(item.card) * item.quantity,
    0,
  );
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ownedCards.length
        ? `## Vender todas as cartas?\n\n` +
          `Esta ação vai vender **${totalCopies}** carta(s) de **${ownedCards.length}** tipo(s) ` +
          `por aproximadamente **${totalValue.toLocaleString('pt-BR')} coins**.\n\n` +
          `A coleção será esvaziada. Confirme somente se deseja continuar.`
        : '## Nenhuma carta para vender\n\nVocê ainda não possui cartas na coleção.',
    ),
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_sell_all_confirm:${token}`)
      .setLabel('Confirmar venda')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!ownedCards.length),
    new ButtonBuilder()
      .setCustomId(`pokemon_sell_all_cancel:${token}:${page}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary),
  );
  return { content: null, components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

async function buildShowcasePayload({ token, page = 0 }) {
  const totalPages = Math.max(1, Math.ceil(CARD_DEFS.length / SHOWCASE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageCards = CARD_DEFS.slice(
    safePage * SHOWCASE_PAGE_SIZE,
    (safePage + 1) * SHOWCASE_PAGE_SIZE,
  );
  const firstCardNumber = safePage * SHOWCASE_PAGE_SIZE + 1;
  const lastCardNumber = firstCardNumber + pageCards.length - 1;
  const image = await generateCardSheet(pageCards, {
    columns: SHOWCASE_COLUMNS,
    cardWidth: 220,
    gap: 18,
  });
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://carta-vitrine.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Vitrine Pokémon\n` +
        `Cartas **${firstCardNumber}–${lastCardNumber} de ${CARD_DEFS.length}** · ` +
        `fileira **${safePage + 1}/${totalPages}**\n\n` +
        `A vitrine agora exibe **3 cartas por fileira**.`,
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pokemon_vitrine_page:${token}:${safePage - 1}`)
      .setLabel('Carta anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId(`pokemon_vitrine_page:${token}:${safePage + 1}`)
      .setLabel('Próxima fileira')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`pokemon_collection_back:${token}`)
      .setLabel('Voltar à coleção')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: null,
    files: [new AttachmentBuilder(image, { name: 'carta-vitrine.png' })],
    components: [container, row],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function sellCards(userId, guildId, cardKey, requestedQuantity = 1) {
  if (!guildId) return { ok: false, reason: 'A venda de cartas só funciona dentro de um servidor.' };
  const card = getCard(cardKey);
  if (!card) return { ok: false, reason: 'Carta não encontrada.' };
  const quantity = requestedQuantity === 'all'
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Math.floor(Number(requestedQuantity) || 1));
  return prisma.$transaction(async tx => {
    const owned = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId, cardKey } },
    });
    if (!owned) return { ok: false, reason: 'Você não possui essa carta.' };
    const sold = Math.min(owned.quantity, quantity);
    const value = cardSellValue(card) * sold;
    if (sold >= owned.quantity) {
      await tx.cardCollection.delete({ where: { userId_cardKey: { userId, cardKey } } });
    } else {
      await tx.cardCollection.update({
        where: { userId_cardKey: { userId, cardKey } },
        data: { quantity: { decrement: sold } },
      });
    }
    await tx.economy.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId, balance: value },
      update: { balance: { increment: value } },
    });
    await incrementCardProgress(tx, userId, { sold: 1 });
    await recordCardTransaction(tx, {
      userId,
      guildId,
      type: 'sell',
      cardKey,
      quantity: sold,
      coins: value,
    });
    return { ok: true, sold, value, card };
  });
}

async function sellAllCards(userId, guildId) {
  if (!guildId) return { ok: false, reason: 'A venda de cartas só funciona dentro de um servidor.' };
  return prisma.$transaction(async tx => {
    const rows = await tx.cardCollection.findMany({
      where: { userId, quantity: { gt: 0 } },
    });
    const ownedCards = rows
      .map(row => ({ card: getCard(row.cardKey), quantity: row.quantity }))
      .filter(item => item.card);
    if (!ownedCards.length) return { ok: false, reason: 'Você não possui cartas para vender.' };

    const value = ownedCards.reduce(
      (sum, item) => sum + cardSellValue(item.card) * item.quantity,
      0,
    );
    const sold = ownedCards.reduce((sum, item) => sum + item.quantity, 0);
    await tx.cardCollection.deleteMany({
      where: {
        userId,
        cardKey: { in: ownedCards.map(item => item.card.key) },
      },
    });
    await tx.economy.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId, balance: value },
      update: { balance: { increment: value } },
    });
    await incrementCardProgress(tx, userId, { sold: 1 });
    await recordCardTransaction(tx, {
      userId,
      guildId,
      type: 'sell_all',
      quantity: sold,
      coins: value,
      metadata: { cardTypes: ownedCards.length },
    });
    return { ok: true, sold, types: ownedCards.length, value };
  });
}

async function craftCard(userId, guildId, cardKey) {
  if (!guildId) return { ok: false, reason: 'O craft só funciona dentro de um servidor.' };
  const card = getCard(cardKey);
  if (!card) return { ok: false, reason: 'Carta não encontrada.' };
  const cost = cardCraftCost(card);
  return prisma.$transaction(async tx => {
    const wallet = await getCardWallet(tx, userId);
    const owned = await tx.cardCollection.findUnique({
      where: { userId_cardKey: { userId, cardKey: card.key } },
    });
    if ((owned?.quantity ?? 0) >= CARD_MAX_COPIES) {
      return { ok: false, reason: `Você já atingiu o limite de ${CARD_MAX_COPIES} cópias dessa carta.` };
    }
    if (wallet.fragments < cost) {
      return {
        ok: false,
        reason: `Você precisa de **${cost} fragmentos**, mas possui **${wallet.fragments}**.`,
      };
    }
    await tx.cardWallet.update({
      where: { userId },
      data: { fragments: { decrement: cost } },
    });
    await tx.cardCollection.upsert({
      where: { userId_cardKey: { userId, cardKey: card.key } },
      create: { userId, cardKey: card.key, quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    await recordCardTransaction(tx, {
      userId,
      guildId,
      type: 'craft',
      cardKey: card.key,
      quantity: 1,
      fragments: -cost,
    });
    return { ok: true, card, cost, wallet: { ...wallet, fragments: wallet.fragments - cost } };
  });
}

function buildCardWalletPayload(wallet, title = 'Carteira de cartas') {
  return {
    content: [
      `## ${title}`,
      '',
      `🧩 Fragmentos: **${wallet.fragments}**`,
      `🎟️ Tickets: **${wallet.tickets}**`,
      '',
      'Use `/cartas craft` para escolher uma carta no menu e criar uma cópia. Cada carta aceita até '
      + `**${CARD_MAX_COPIES} cópias**.`,
    ].join('\n'),
  };
}

async function updateCollectionAfterAck(interaction, payloadFactory) {
  await interaction.deferUpdate();
  return interaction.editReply(await payloadFactory());
}

async function buildCardDetailPayload({
  userId,
  guildId,
  card,
  backCustomId = 'pokemon_collection_open',
  backLabel = 'Voltar à coleção',
  sessionToken = null,
}) {
  const owned = await prisma.cardCollection.findUnique({
    where: { userId_cardKey: { userId, cardKey: card.key } },
  });
  const image = await generateCardSheet([card]);
  const quantity = owned?.quantity ?? 0;
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://carta.png'),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${card.name}\n` +
        `${rarityData(card.rarity).label} • Você possui **${quantity}**\n` +
        `Venda cada unidade por **${cardSellValue(card).toLocaleString('pt-BR')} coins**.\n` +
        `Craft: **${cardCraftCost(card)} fragmentos** · máximo **${CARD_MAX_COPIES} cópias**.`,
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(sessionToken
        ? `pokemon_card_sell:${sessionToken}:${card.key}:1`
        : `pokemon_card_sell:${card.key}:1`)
      .setLabel(`Vender 1 • ${cardSellValue(card).toLocaleString('pt-BR')} coins`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(quantity < 1),
    new ButtonBuilder()
      .setCustomId(sessionToken
        ? `pokemon_card_sell:${sessionToken}:${card.key}:all`
        : `pokemon_card_sell:${card.key}:all`)
      .setLabel('Vender todas')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(quantity < 1),
    new ButtonBuilder()
      .setCustomId(backCustomId)
      .setLabel(backLabel)
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: null,
    files: [new AttachmentBuilder(image, { name: 'carta.png' })],
    components: [container, row],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function openPacks(userId, guildId, count, packKey) {
  const pack = getCardPack(packKey);
  if (!pack || !pack.available) return { ok: false, reason: 'Este pack não está disponível.' };
  const total = pack.price * count;
  const cards = Array.from({ length: count }, () => pickPackCards(pack.key)).flat();
  return prisma.$transaction(async tx => {
    const now = new Date();
    const cooldown = await tx.cardPackCooldown.findUnique({
      where: { userId_guildId: { userId, guildId } },
    });
    if (cooldown?.nextOpenAt > now) {
      return {
        ok: false,
        reason: `Aguarde mais ${Math.ceil((cooldown.nextOpenAt.getTime() - now.getTime()) / 1000)} segundo(s) para abrir outro pack.`,
        cooldownUntil: cooldown.nextOpenAt,
        total,
        balance: totalCoins(await getEco(userId, guildId, tx)),
      };
    }
    const eco = await getEco(userId, guildId, tx);
    if (totalCoins(eco) < total) return { ok: false, balance: totalCoins(eco), total };
    const spent = await spendCoins(tx, { userId, guildId, amount: total });
    if (!spent.ok) return { ok: false, balance: spent.available ?? totalCoins(eco), total };

    let duplicates = 0;
    let fragments = 0;
    let discovered = 0;
    for (const card of cards) {
      const current = await tx.cardCollection.findUnique({
        where: { userId_cardKey: { userId, cardKey: card.key } },
      });
      if (!current) {
        discovered += 1;
        await tx.cardCollection.create({ data: { userId, cardKey: card.key, quantity: 1 } });
      } else if (current.quantity < CARD_MAX_COPIES) {
        duplicates += 1;
        await tx.cardCollection.update({
          where: { userId_cardKey: { userId, cardKey: card.key } },
          data: { quantity: { increment: 1 } },
        });
      } else {
        duplicates += 1;
        fragments += cardFragmentValue(card);
        await tx.cardWallet.upsert({
          where: { userId },
          create: { userId, fragments: cardFragmentValue(card) },
          update: { fragments: { increment: cardFragmentValue(card) } },
        });
      }
    }
    await tx.cardPackCooldown.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: {
        userId,
        guildId,
        nextOpenAt: new Date(now.getTime() + PACK_COOLDOWN_MS),
      },
      update: { nextOpenAt: new Date(now.getTime() + PACK_COOLDOWN_MS) },
    });
    await incrementCardProgress(tx, userId, { opened: count, discovered });
    await recordCardTransaction(tx, {
      userId,
      guildId,
      type: 'pack_open',
      quantity: cards.length,
      fragments,
      coins: -total,
      metadata: { packKey, packCount: count, discovered, duplicates },
    });
    const updatedEco = await getEco(userId, guildId, tx);
    return { ok: true, cards, duplicates, fragments, balance: totalCoins(updatedEco) };
  });
}

export async function handleCardPackInteraction(interaction) {
  const [action, token] = interaction.customId.split(':');
  const session = getPackSession(token);
  if (!session) {
    return interaction.reply({ content: 'Este pack expirou. Use `s cartas abrir` para começar outro.', ephemeral: true });
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Este pack pertence a outra pessoa.', ephemeral: true });
  }

  if (action === 'pokemon_shop_select') {
    const selectedPack = getCardPack(interaction.values?.[0]);
    if (!selectedPack) return interaction.reply({ content: 'Pack não encontrado.', ephemeral: true });
    if (!selectedPack.available) {
      return interaction.reply({ content: `**${selectedPack.name}** estará disponível em breve.`, ephemeral: true });
    }
    session.packKey = selectedPack.key;
    return interaction.update(await buildPackShopPayload(session));
  }

  if (action === 'pokemon_shop_quantity') {
    const count = Number(interaction.values?.[0]);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      return interaction.reply({ content: 'Escolha uma quantidade entre 1 e 10 pacotes.', ephemeral: true });
    }
    session.count = count;
    return interaction.update(await buildPackShopPayload(session));
  }

  if (action === 'pokemon_shop_back') {
    session.cards = null;
    session.index = 0;
    session.duplicates = 0;
    session.fragments = 0;
    return interaction.update(await buildPackShopPayload(session));
  }

  if (action === 'pokemon_shop_open' || action === 'pokemon_pack_open') {
    const pack = getCardPack(session.packKey);
    if (!pack?.available) {
      return interaction.reply({ content: `**${pack?.name ?? 'Este pack'}** estará disponível em breve.`, ephemeral: true });
    }
    if (session.opening || session.cards) {
      return interaction.reply({ content: 'Este pacote já está sendo aberto ou já foi aberto.', ephemeral: true });
    }
    session.opening = true;
    let result;
    try {
      await interaction.deferUpdate();
      result = await openPacks(session.userId, session.guildId, packCount(session.count), session.packKey);
    } finally {
      session.opening = false;
    }
    if (!result.ok) {
      return interaction.editReply({
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `## Não foi possível abrir o pack\n\n${result.reason ?? `Você precisa de **${result.total.toLocaleString('pt-BR')} coins**, mas possui **${result.balance.toLocaleString('pt-BR')} coins**.`}`,
            ),
          ),
          buildPackShopBackRow(session.token),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    session.cards = result.cards;
    session.index = 0;
    session.duplicates = result.duplicates;
    session.fragments = result.fragments;
    const cardImage = await generateCardSheet([session.cards[0]]);
    return interaction.editReply({
      ...buildCardRevealPayload({ ...session, token }),
      files: [new AttachmentBuilder(cardImage, { name: 'carta-revelada.png' })],
    });
  }

  if (action === 'pokemon_pack_next') {
    if (!session.cards) return interaction.reply({ content: 'Abra o pack primeiro.', ephemeral: true });
    session.index += 1;
    const cardImage = await generateCardSheet([session.cards[session.index]]);
    return interaction.update({
      ...buildCardRevealPayload({ ...session, token }),
      files: [new AttachmentBuilder(cardImage, { name: 'carta-revelada.png' })],
    });
  }

  if (action === 'pokemon_pack_finish') {
    if (!session.cards) return interaction.reply({ content: 'Abra o pack primeiro.', ephemeral: true });
    const image = await generateCardSheet(session.cards, { columns: Math.min(5, session.cards.length), cardWidth: 220, gap: 16 });
    return interaction.update({
      ...buildPackFinishedPayload(session),
      files: [new AttachmentBuilder(image, { name: 'cartas-pokemon.png' })],
    });
  }

  if (action === 'pokemon_pack_all') {
    if (!session.cards) return interaction.reply({ content: 'Abra o pack primeiro.', ephemeral: true });
    const image = await generateCardSheet(session.cards, { columns: Math.min(5, session.cards.length), cardWidth: 220, gap: 16 });
    return interaction.update({
      ...buildPackFinishedPayload(session),
      files: [new AttachmentBuilder(image, { name: 'cartas-pokemon.png' })],
    });
  }
}

export async function handleFutPackInteraction(interaction) {
  const [action, token] = interaction.customId.split(':');
  const session = getFutPackSession(token);
  if (!session) {
    return interaction.reply({
      content: 'Este pacote FUT expirou. Use `/cartas abrir-fut` para começar outro.',
      ephemeral: true,
    });
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Este pacote pertence a outra pessoa.', ephemeral: true });
  }

  if (action === 'fut_pack_open') {
    session.index = 0;
    return interaction.update(buildFutCardPayload({ ...session, token }));
  }

  if (action === 'fut_pack_next') {
    if (session.index >= FUT_TEST_CARDS.length - 1) {
      return interaction.reply({ content: 'Você já revelou todas as cartas deste pacote.', ephemeral: true });
    }
    session.index += 1;
    return interaction.update(buildFutCardPayload({ ...session, token }));
  }

  if (action === 'fut_pack_finish') {
    futPackSessions.delete(token);
    return interaction.update(buildFutPackFinishedPayload());
  }
}

export async function handleCardCollectionInteraction(interaction) {
  const [action, token, value, quantity] = interaction.customId.split(':');
  if (action === 'pokemon_dex_card') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta Pokédex expirou. Use `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta Pokédex pertence a outra pessoa.', ephemeral: true });
    const card = getCard(interaction.values[0]);
    if (!card) return interaction.reply({ content: 'Carta não encontrada.', ephemeral: true });
    return updateCollectionAfterAck(interaction, () => buildCardDetailPayload({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      card,
      backCustomId: `pokemon_collection_back:${session.token}`,
    }));
  }
  if (action === 'pokemon_dex_page') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta Pokédex expirou. Use `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta Pokédex pertence a outra pessoa.', ephemeral: true });
    session.page = Number(value) || 0;
    return updateCollectionAfterAck(interaction, () => buildDexPayload(session));
  }

  if (action === 'pokemon_vitrine') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta vitrine expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta vitrine pertence a outra pessoa.', ephemeral: true });
    session.collectionPage = session.page;
    session.page = 0;
    return updateCollectionAfterAck(
      interaction,
      () => buildShowcasePayload({ token: session.token, page: 0 }),
    );
  }

  if (action === 'pokemon_sell') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    session.collectionPage = session.page;
    session.page = 0;
    return updateCollectionAfterAck(interaction, () => buildSellPayload({
      userId: session.userId,
      guildId: session.guildId,
      token: session.token,
      page: 0,
    }));
  }

  if (action === 'pokemon_collection_back') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta coleção expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta coleção pertence a outra pessoa.', ephemeral: true });
    session.page = session.collectionPage ?? 0;
    return updateCollectionAfterAck(interaction, () => buildDexPayload(session));
  }

  if (action === 'pokemon_collection_open') {
    const newToken = createDexSession({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      page: 0,
    });
    return updateCollectionAfterAck(interaction, () => buildDexPayload({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      token: newToken,
      page: 0,
    }));
  }

  if (action === 'pokemon_sell_page') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    session.page = Number(value) || 0;
    return updateCollectionAfterAck(interaction, () => buildSellPayload({
      userId: session.userId,
      guildId: session.guildId,
      token: session.token,
      page: session.page,
    }));
  }

  if (action === 'pokemon_sell_all') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    return updateCollectionAfterAck(interaction, () => buildSellAllConfirmationPayload({
      userId: session.userId,
      token: session.token,
      page: Number(value) || session.page,
    }));
  }

  if (action === 'pokemon_sell_all_cancel') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    session.page = Number(value) || 0;
    return updateCollectionAfterAck(interaction, () => buildSellPayload({
      userId: session.userId,
      guildId: session.guildId,
      token: session.token,
      page: session.page,
    }));
  }

  if (action === 'pokemon_sell_all_confirm') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    await interaction.deferUpdate();
    const result = await sellAllCards(interaction.user.id, interaction.guildId);
    if (!result.ok) return interaction.followUp({ content: result.reason, ephemeral: true });
    await interaction.editReply(await buildSellPayload({
      userId: session.userId,
      guildId: session.guildId,
      token: session.token,
      page: 0,
    }));
    return interaction.followUp({
      content: `Você vendeu **${result.sold}** carta(s) de **${result.types}** tipo(s) por **${result.value.toLocaleString('pt-BR')} coins**.`,
      ephemeral: true,
    });
  }

  if (action === 'pokemon_sell_card') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta área expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta área pertence a outra pessoa.', ephemeral: true });
    const card = getCard(interaction.values[0]);
    if (!card) return interaction.reply({ content: 'Carta não encontrada.', ephemeral: true });
    return updateCollectionAfterAck(interaction, () => buildCardDetailPayload({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      card,
      backCustomId: `pokemon_sell_page:${session.token}:${session.page}`,
      backLabel: 'Voltar à venda',
      sessionToken: session.token,
    }));
  }

  if (action === 'pokemon_vitrine_page') {
    const session = getDexSession(token, interaction.user.id, interaction.guildId);
    if (!session) return interaction.reply({ content: 'Esta vitrine expirou. Abra `/cartas colecao` novamente.', ephemeral: true });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: 'Esta vitrine pertence a outra pessoa.', ephemeral: true });
    session.page = Number(value) || 0;
    return updateCollectionAfterAck(
      interaction,
      () => buildShowcasePayload({ token: session.token, page: session.page }),
    );
  }

  if (action === 'pokemon_card_sell') {
    const hasSessionToken = quantity !== undefined;
    const sessionToken = hasSessionToken ? token : null;
    const cardKey = hasSessionToken ? value : token;
    const sellQuantity = hasSessionToken ? quantity : value;
    const session = sessionToken
      ? getDexSession(sessionToken, interaction.user.id, interaction.guildId)
      : null;
    const card = getCard(cardKey);
    if (!card) return interaction.reply({ content: 'Carta não encontrada.', ephemeral: true });
    if (interaction.guildId == null) return interaction.reply({ content: 'A venda de cartas só funciona dentro de um servidor.', ephemeral: true });
    await interaction.deferUpdate();
    const result = await sellCards(interaction.user.id, interaction.guildId, card.key, sellQuantity);
    if (!result.ok) return interaction.followUp({ content: result.reason, ephemeral: true });
    await interaction.editReply(await buildCardDetailPayload({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      card,
      backCustomId: session
        ? `pokemon_sell_page:${session.token}:${session.page}`
        : 'pokemon_collection_open',
      backLabel: session ? 'Voltar à venda' : 'Voltar à coleção',
      sessionToken: session?.token ?? null,
    }));
    return interaction.followUp({
      content: `Você vendeu **${result.sold}x ${card.name}** por **${result.value.toLocaleString('pt-BR')} coins**.`,
      ephemeral: true,
    });
  }
}

export async function handleCardPickerInteraction(interaction) {
  const [action, token, rawPage] = interaction.customId.split(':');
  const session = getCardPickerSession(token, interaction.user.id, interaction.guildId);
  if (!session) {
    return interaction.reply({
      content: 'Este seletor expirou. Abra o comando novamente para escolher uma carta.',
      ephemeral: true,
    });
  }

  if (action === 'card_picker_cancel') {
    cardPickerSessions.delete(token);
    return interaction.update({ content: 'Seleção cancelada.', components: [] });
  }

  if (action === 'card_picker_page') {
    session.page = Number(rawPage) || 0;
    return interaction.update(await buildCardPickerPayload(session));
  }

  if (action !== 'card_picker_select') return false;
  const selectedCard = getCard(interaction.values?.[0]);
  if (!selectedCard) {
    return interaction.reply({ content: 'Carta não encontrada. Abra o seletor novamente.', ephemeral: true });
  }

  if (session.mode === 'craft') {
    await interaction.deferUpdate();
    const result = await craftCard(interaction.user.id, interaction.guildId, selectedCard.key);
    cardPickerSessions.delete(token);
    return interaction.editReply({
      content: result.ok
        ? `✅ Você criou **1x ${selectedCard.name}** por **${result.cost} fragmentos**.`
        : `❌ ${result.reason}`,
      components: [],
    });
  }

  if (session.mode === 'trade-offer') {
    session.offeredCardKey = selectedCard.key;
    session.mode = 'trade-request';
    session.page = 0;
    return interaction.update(await buildCardPickerPayload(session));
  }

  if (session.mode === 'trade-request') {
    const result = await createCardTrade({
      guildId: interaction.guildId,
      fromUserId: interaction.user.id,
      toUserId: session.targetId,
      offeredCardKey: session.offeredCardKey,
      requestedCardKey: selectedCard.key,
    });
    cardPickerSessions.delete(token);
    if (!result.ok) {
      return interaction.update({
        content: `❌ ${result.reason}`,
        components: [],
      });
    }
    return interaction.update(buildTradePayload(result.trade, result.offered, result.requested));
  }

  return interaction.reply({ content: 'Seletor inválido.', ephemeral: true });
}

function buildCraftPickerPayload({ userId, guildId }) {
  const token = createCardPickerSession({ userId, guildId, mode: 'craft' });
  return buildCardPickerPayload(cardPickerSessions.get(token));
}

function buildTradePickerPayload({ userId, guildId, targetId }) {
  const token = createCardPickerSession({
    userId,
    guildId,
    mode: 'trade-offer',
    targetId,
  });
  return buildCardPickerPayload(cardPickerSessions.get(token));
}

export default {
  data: new SlashCommandBuilder()
    .setName('cartas')
    .setDescription('Colecione cartas originais de anime e fantasia')
    .addSubcommand(sub => sub
      .setName('abrir')
      .setDescription('Abra a loja e escolha o tipo de pack')
      .addIntegerOption(option => option
        .setName('pacotes')
        .setDescription('Quantidade de pacotes (máximo 10)')
        .setMinValue(1)
        .setMaxValue(10)))
    .addSubcommand(sub => sub
      .setName('abrir-fut')
      .setDescription('Abra o pacote teste FUT com 4 cartas'))
    .addSubcommand(sub => sub
      .setName('colecao')
      .setDescription('Veja suas cartas e seu progresso'))
    .addSubcommand(sub => sub
      .setName('pokedex')
      .setDescription('Veja as cartas descobertas e as que ainda faltam'))
    .addSubcommand(sub => sub
      .setName('ver')
      .setDescription('Veja os detalhes de uma carta')
      .addStringOption(option => option
        .setName('carta')
        .setDescription('Carta que deseja consultar')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('vender')
      .setDescription('Venda uma carta por coins')
      .addStringOption(option => option
        .setName('carta')
        .setDescription('Chave da carta')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('quantidade')
        .setDescription('Quantidade para vender')
        .setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('craft')
      .setDescription('Escolha uma carta para criar usando fragmentos'))
    .addSubcommand(sub => sub
      .setName('fragmentos')
      .setDescription('Veja sua carteira de fragmentos e tickets'))
    .addSubcommand(sub => sub
      .setName('missoes')
      .setDescription('Veja ou resgate as missões diárias')
      .addBooleanOption(option => option
        .setName('resgatar')
        .setDescription('Resgatar a recompensa se todas estiverem completas')))
    .addSubcommand(sub => sub
      .setName('trocar')
      .setDescription('Proponha uma troca segura de cartas')
      .addUserOption(option => option
        .setName('membro')
        .setDescription('Membro que receberá a proposta')
        .setRequired(true))),
  name: 'cartas',
  aliases: ['carta', 'cards'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: sub === 'craft' });

    if (sub === 'colecao') {
      const token = createDexSession({ userId: interaction.user.id, guildId: interaction.guildId });
      return interaction.editReply(await buildDexPayload({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        token,
        page: 0,
      }));
    }

    if (sub === 'pokedex') {
      const token = createDexSession({ userId: interaction.user.id, guildId: interaction.guildId });
      return interaction.editReply(await buildDexPayload({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        token,
        page: 0,
      }));
    }

    if (sub === 'abrir-fut') {
      const token = createFutPackSession({ userId: interaction.user.id, guildId: interaction.guildId });
      return interaction.editReply(buildFutPackCoverPayload(token));
    }

    if (sub === 'ver') {
      const card = getCard(interaction.options.getString('carta'));
      if (!card) return interaction.editReply({ content: 'Carta não encontrada. Use a chave da carta, como `pikachu-thunder-wave`.' });
      return interaction.editReply(await buildCardDetailPayload({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        card,
      }));
    }

    if (sub === 'vender') {
      const card = getCard(interaction.options.getString('carta'));
      if (!card) return interaction.editReply({ content: 'Carta não encontrada. Use a chave da carta, como `pikachu-thunder-wave`.' });
      const result = await sellCards(
        interaction.user.id,
        interaction.guildId,
        card.key,
        interaction.options.getInteger('quantidade') ?? 'all',
      );
      if (!result.ok) return interaction.editReply({ content: result.reason });
      return interaction.editReply({
        content: `Você vendeu **${result.sold}x ${card.name}** por **${result.value.toLocaleString('pt-BR')} coins**.`,
      });
    }

    if (sub === 'craft') {
      return interaction.editReply(await buildCraftPickerPayload({
        userId: interaction.user.id,
        guildId: interaction.guildId,
      }));
    }

    if (sub === 'fragmentos') {
      const wallet = await getCardWallet(prisma, interaction.user.id);
      return interaction.editReply(buildCardWalletPayload(wallet));
    }

    if (sub === 'missoes') {
      const shouldClaim = interaction.options.getBoolean('resgatar') ?? false;
      if (shouldClaim) {
        const result = await claimDailyMissions(interaction.user.id, interaction.guildId);
        if (!result.ok) return interaction.editReply({ content: `❌ ${result.reason}` });
        const wallet = await getCardWallet(prisma, interaction.user.id);
        return interaction.editReply({
          content: `✅ Recompensa resgatada: **${result.coins.toLocaleString('pt-BR')} coins**, **${result.fragments} fragmentos** e **${result.tickets} ticket**.\n\n${buildDailyMissionText(wallet)}`,
        });
      }
      const wallet = await getCardWallet(prisma, interaction.user.id);
      return interaction.editReply({ content: buildDailyMissionText(wallet) });
    }

    if (sub === 'trocar') {
      const target = interaction.options.getUser('membro');
      return interaction.editReply(await buildTradePickerPayload({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        targetId: target?.id,
      }));
    }

    const count = packCount(interaction.options.getInteger('pacotes'));
    const token = createPackSession({ userId: interaction.user.id, guildId: interaction.guildId, count });
    return interaction.editReply(await buildPackShopPayload(packSessions.get(token)));
  },

  async executePrefix(message, args) {
    const sub = args[0]?.toLowerCase() ?? 'colecao';
    if (sub === 'colecao' || sub === 'collection') {
      const token = createDexSession({ userId: message.author.id, guildId: message.guildId });
      return message.reply(await buildDexPayload({
        userId: message.author.id,
        guildId: message.guildId,
        token,
        page: 0,
      }));
    }
    if (sub === 'pokedex' || sub === 'dex') {
      const token = createDexSession({ userId: message.author.id, guildId: message.guildId });
      return message.reply(await buildDexPayload({
        userId: message.author.id,
        guildId: message.guildId,
        token,
        page: 0,
      }));
    }
    if (sub === 'abrir-fut' || (sub === 'abrir' && args[1]?.toLowerCase() === 'fut')) {
      const token = createFutPackSession({ userId: message.author.id, guildId: message.guildId });
      return message.reply(buildFutPackCoverPayload(token));
    }
    if (sub === 'abrir' || sub === 'open') {
      const count = packCount(args[1]);
      const token = createPackSession({ userId: message.author.id, guildId: message.guildId, count });
      return message.reply(await buildPackShopPayload(packSessions.get(token)));
    }
    if (sub === 'fragmentos' || sub === 'wallet') {
      return message.reply(buildCardWalletPayload(await getCardWallet(prisma, message.author.id)));
    }
    if (sub === 'missoes' || sub === 'missions') {
      const result = args[1]?.toLowerCase() === 'resgatar'
        ? await claimDailyMissions(message.author.id, message.guildId)
        : null;
      if (result && !result.ok) return message.reply(`❌ ${result.reason}`);
      const wallet = await getCardWallet(prisma, message.author.id);
      return message.reply(result?.ok
        ? `✅ Recompensa resgatada: **${result.coins.toLocaleString('pt-BR')} coins**, **${result.fragments} fragmentos** e **${result.tickets} ticket**.\n\n${buildDailyMissionText(wallet)}`
        : buildDailyMissionText(wallet));
    }
    if (sub === 'craft') {
      if (!args[1]) {
        return message.reply(await buildCraftPickerPayload({
          userId: message.author.id,
          guildId: message.guildId,
        }));
      }
      const card = getCard(args[1]);
      if (!card) return message.reply('Carta não encontrada. Use a chave da carta.');
      const result = await craftCard(message.author.id, message.guildId, card.key);
      return message.reply(result.ok
        ? `✅ Você criou **1x ${card.name}** por **${result.cost} fragmentos**.`
        : `❌ ${result.reason}`);
    }
    if (sub === 'trocar' || sub === 'trade') {
      const targetId = args[1]?.match(/^<@!?(\d+)>$/)?.[1];
      if (!targetId) return message.reply('Mencione o membro com quem deseja trocar, por exemplo: `savage cartas trocar @Pessoa`.');
      if (!args[2] || !args[3]) {
        return message.reply(await buildTradePickerPayload({
          userId: message.author.id,
          guildId: message.guildId,
          targetId,
        }));
      }
      const result = await createCardTrade({
        guildId: message.guildId,
        fromUserId: message.author.id,
        toUserId: targetId,
        offeredCardKey: args[2],
        requestedCardKey: args[3],
      });
      if (!result.ok) return message.reply(`❌ ${result.reason}`);
      return message.reply(buildTradePayload(result.trade, result.offered, result.requested));
    }
    if (sub === 'vender' || sub === 'sell') {
      const card = getCard(args[1]);
      if (!card) return message.reply('Carta não encontrada. Use a chave da carta, como `pikachu-thunder-wave`.');
      const result = await sellCards(message.author.id, message.guildId, card.key, args[2] ?? 'all');
      if (!result.ok) return message.reply(result.reason);
      return message.reply(`Você vendeu **${result.sold}x ${card.name}** por **${result.value.toLocaleString('pt-BR')} coins**.`);
    }
    const card = getCard(args[1]);
    if (!card) return message.reply('Use `savage cartas abrir`, `savage cartas colecao`, `savage cartas ver <chave>` ou `savage cartas vender <chave> [quantidade]`.');
    return message.reply(await buildCardDetailPayload({
      userId: message.author.id,
      guildId: message.guildId,
      card,
    }));
  },
};