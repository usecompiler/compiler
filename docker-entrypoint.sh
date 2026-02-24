#!/bin/sh
npx drizzle-kit migrate
npx tsx scripts/data-migrations.ts
exec "$@"
