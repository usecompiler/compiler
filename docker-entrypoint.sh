#!/bin/sh
set -e
npx drizzle-kit migrate
npx tsx scripts/data-migrations.ts
exec "$@"
