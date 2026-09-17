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
    // Depois que a economia possui guildId, cada ID representa um servidor
    // válido. Nunca trate os demais servidores como "legados" com base em um
    // GUILD_ID configurado: esse valor pode estar antigo ou apontar para outro
    // servidor, e a mesclagem automática destruiria a separação dos dados.
    console.log('[ECONOMY] Economia por servidor já está pronta; IDs preservados.');
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