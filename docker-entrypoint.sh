#!/bin/sh
npx drizzle-kit migrate
npm run prefetch
exec "$@"
