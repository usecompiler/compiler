#!/bin/sh
set -e
npx drizzle-kit migrate
exec "$@"
