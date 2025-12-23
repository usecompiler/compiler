#!/bin/sh
npx drizzle-kit migrate
exec "$@"
