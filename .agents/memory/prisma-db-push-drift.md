---
name: Prisma database drift
description: Safe handling of additive schema changes when the development database has an unrelated legacy table.
---

The development database contains legacy tables outside the current Prisma schema. A normal `prisma db push` can detect them as data-loss operations even when the requested change is additive.

**Why:** Accepting Prisma's data-loss prompt could delete populated legacy data unrelated to the feature being built.

**How to apply:** For additive models, inspect the warning and use an explicit `CREATE TABLE IF NOT EXISTS` plus `CREATE INDEX IF NOT EXISTS` path when appropriate. Do not use `--accept-data-loss` unless the user explicitly approves the deletion.