#!/bin/sh
# Only one `next build` at a time: parallel builds share apps/web/.next and need ~2 GB each.
LOCK="$(dirname "$0")/../var/next-build.lock"
mkdir -p "$(dirname "$LOCK")"
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
trap 'rmdir "$LOCK"' EXIT INT TERM
pnpm --filter @nmp/web build
