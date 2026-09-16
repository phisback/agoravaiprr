Backup created from the bot PostgreSQL database.
Created: 2026-09-16
Recommended restore file: bot-database.dump
Alternative restore file: bot-database.sql.gz

Recommended restore command:
pg_restore --no-owner --no-acl --clean --if-exists --dbname="$DATABASE_URL" bot-database.dump

Alternative restore command:
gunzip -c bot-database.sql.gz | psql "$DATABASE_URL"

Important: keep this backup private. It contains bot progress, hashed bank passwords, and quest tokens stored by the bot. Never commit it to a public repository.
