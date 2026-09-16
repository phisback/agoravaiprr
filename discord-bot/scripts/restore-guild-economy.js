import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const migrationTable = 'Economy_guild_restore';
const backupTable = 'Economy_global_backup';

async function resolveGuildId() {
  const configuredGuildId = process.env.GUILD_ID?.trim();
  if (configuredGuildId) return configuredGuildId;

  if (!process.env.DISCORD_TOKEN) {
    throw new Error(
      'GUILD_ID não está configurado e DISCORD_TOKEN não está disponível para descobrir o servidor.',
    );
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(process.env.DISCORD_TOKEN);
    const guilds = [...client.guilds.cache.values()];
    if (guilds.length !== 1) {
      throw new Error(
        `Foram encontrados ${guilds.length} servidores. Configure GUILD_ID para escolher o servidor da economia.`,
      );
    }
    return guilds[0].id;
  } finally {
    client.destroy();
  }
}

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Economy'
  `;

  if (!columns.length) {
    console.log('[ECONOMY] A tabela Economy ainda não existe; o Prisma irá criá-la.');
    return;
  }

  if (columns.some(column => column.column_name === 'guildId')) {
    const guildId = await resolveGuildId();
    const guildRows = await prisma.$queryRaw`
      SELECT "guildId", COUNT(*)::int AS "rowCount"
      FROM "Economy"
      GROUP BY "guildId"
    `;
    const legacyGuilds = guildRows
      .filter(row => row.guildId !== guildId)
      .map(row => row.guildId);

    if (!legacyGuilds.length) {
      console.log('[ECONOMY] Economia por servidor já está pronta.');
      return;
    }

    for (const legacyGuildId of legacyGuilds) {
      await prisma.$transaction(async tx => {
        // Move dados restaurados de um servidor antigo para o servidor atual.
        // Em caso de usuário duplicado, soma valores acumuláveis e mantém o
        // maior progresso, sem apagar o registro que já existe no servidor atual.
        // O ID original pode já estar ocupado no banco novo; nesse caso, use
        // um ID derivado único e deixe a chave composta fazer a mesclagem.
        await tx.$executeRaw`
          INSERT INTO "Economy" (
            "id", "userId", "guildId", "balance", "bank", "messageCount",
            "callMinutes", "xp", "level", "lastDaily", "lastWeekly",
            "lastMonthly", "lastWork", "lastRob", "dailyStreak", "workLevel",
            "workXp", "lastPetPlay", "lastPetFeed", "lastPetPet"
          )
          SELECT
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM "Economy" AS occupied
                WHERE occupied."id" = legacy."id"
              )
              THEN CONCAT(
                'legacy-',
                legacy."id",
                '-',
                md5(CONCAT(legacy."id", ':', legacy."guildId", ':', legacy."userId"))
              )
              ELSE legacy."id"
            END,
            legacy."userId", ${guildId}, legacy."balance",
            legacy."bank", legacy."messageCount", legacy."callMinutes",
            legacy."xp", legacy."level", legacy."lastDaily", legacy."lastWeekly",
            legacy."lastMonthly", legacy."lastWork", legacy."lastRob",
            legacy."dailyStreak", legacy."workLevel", legacy."workXp",
            legacy."lastPetPlay", legacy."lastPetFeed", legacy."lastPetPet"
          FROM "Economy" AS legacy
          WHERE legacy."guildId" = ${legacyGuildId}
          ON CONFLICT ("userId", "guildId") DO UPDATE SET
            "balance" = "Economy"."balance" + EXCLUDED."balance",
            "bank" = "Economy"."bank" + EXCLUDED."bank",
            "messageCount" = "Economy"."messageCount" + EXCLUDED."messageCount",
            "callMinutes" = "Economy"."callMinutes" + EXCLUDED."callMinutes",
            "xp" = GREATEST("Economy"."xp", EXCLUDED."xp"),
            "level" = GREATEST("Economy"."level", EXCLUDED."level"),
            "lastDaily" = COALESCE(GREATEST("Economy"."lastDaily", EXCLUDED."lastDaily"), "Economy"."lastDaily", EXCLUDED."lastDaily"),
            "lastWeekly" = COALESCE(GREATEST("Economy"."lastWeekly", EXCLUDED."lastWeekly"), "Economy"."lastWeekly", EXCLUDED."lastWeekly"),
            "lastMonthly" = COALESCE(GREATEST("Economy"."lastMonthly", EXCLUDED."lastMonthly"), "Economy"."lastMonthly", EXCLUDED."lastMonthly"),
            "lastWork" = COALESCE(GREATEST("Economy"."lastWork", EXCLUDED."lastWork"), "Economy"."lastWork", EXCLUDED."lastWork"),
            "lastRob" = COALESCE(GREATEST("Economy"."lastRob", EXCLUDED."lastRob"), "Economy"."lastRob", EXCLUDED."lastRob"),
            "dailyStreak" = GREATEST("Economy"."dailyStreak", EXCLUDED."dailyStreak"),
            "workLevel" = GREATEST("Economy"."workLevel", EXCLUDED."workLevel"),
            "workXp" = GREATEST("Economy"."workXp", EXCLUDED."workXp"),
            "lastPetPlay" = COALESCE(GREATEST("Economy"."lastPetPlay", EXCLUDED."lastPetPlay"), "Economy"."lastPetPlay", EXCLUDED."lastPetPlay"),
            "lastPetFeed" = COALESCE(GREATEST("Economy"."lastPetFeed", EXCLUDED."lastPetFeed"), "Economy"."lastPetFeed", EXCLUDED."lastPetFeed"),
            "lastPetPet" = COALESCE(GREATEST("Economy"."lastPetPet", EXCLUDED."lastPetPet"), "Economy"."lastPetPet", EXCLUDED."lastPetPet")
        `;
        await tx.$executeRaw`
          DELETE FROM "Economy"
          WHERE "guildId" = ${legacyGuildId}
        `;
      });
      console.log(`[ECONOMY] Dados do servidor legado ${legacyGuildId} mesclados em ${guildId}.`);
    }
    return;
  }

  const guildId = await resolveGuildId();

  await prisma.$transaction(async tx => {
    // A tabela auxiliar e a troca acontecem na mesma transação. Se o processo
    // cair, o PostgreSQL desfaz tudo e a tabela global original permanece.
    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${backupTable}" AS TABLE "Economy"
    `);
    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${migrationTable}"`);
    await tx.$executeRawUnsafe(`
      CREATE TABLE "${migrationTable}" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "guildId" TEXT NOT NULL,
        "balance" INTEGER NOT NULL DEFAULT 0,
        "bank" INTEGER NOT NULL DEFAULT 0,
        "messageCount" INTEGER NOT NULL DEFAULT 0,
        "callMinutes" INTEGER NOT NULL DEFAULT 0,
        "xp" INTEGER NOT NULL DEFAULT 0,
        "level" INTEGER NOT NULL DEFAULT 1,
        "lastDaily" TIMESTAMP(3),
        "lastWork" TIMESTAMP(3),
        "dailyStreak" INTEGER NOT NULL DEFAULT 0,
        "lastPetPlay" TIMESTAMP(3),
        "lastPetFeed" TIMESTAMP(3),
        "lastPetPet" TIMESTAMP(3),
        CONSTRAINT "Economy_guild_restore_userId_guildId_key" UNIQUE ("userId", "guildId")
      )
    `);

    // A economia global pode conter mais de uma linha por usuário após as
    // tentativas anteriores de migração. Consolidar aqui evita a violação da
    // chave composta e mantém os valores acumulados.
    await tx.$executeRaw`
      INSERT INTO "Economy_guild_restore" (
        "id", "userId", "guildId", "balance", "bank", "messageCount",
        "callMinutes", "xp", "level", "lastDaily", "lastWork", "dailyStreak",
        "lastPetPlay", "lastPetFeed", "lastPetPet"
      )
      SELECT
        MIN("id"),
        "userId",
        ${guildId},
        COALESCE(SUM("balance"), 0)::int,
        COALESCE(SUM("bank"), 0)::int,
        COALESCE(SUM("messageCount"), 0)::int,
        COALESCE(SUM("callMinutes"), 0)::int,
        COALESCE(MAX("xp"), 0)::int,
        COALESCE(MAX("level"), 1)::int,
        MAX("lastDaily"),
        MAX("lastWork"),
        COALESCE(MAX("dailyStreak"), 0)::int,
        MAX("lastPetPlay"),
        MAX("lastPetFeed"),
        MAX("lastPetPet")
      FROM "Economy"
      GROUP BY "userId"
    `;

    await tx.$executeRawUnsafe('DROP TABLE "Economy"');
    await tx.$executeRawUnsafe(`ALTER TABLE "${migrationTable}" RENAME TO "Economy"`);
  });

  console.log(`[ECONOMY] ${guildId}: economia restaurada por servidor com consolidação segura.`);
}

main()
  .catch(error => {
    console.error('[ECONOMY] Falha ao restaurar economia por servidor:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());