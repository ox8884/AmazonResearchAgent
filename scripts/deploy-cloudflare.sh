#!/bin/sh
set -eu

IFS= read -r CLOUDFLARE_API_TOKEN
bom=$(printf '\357\273\277')
CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN#"$bom"}
export CLOUDFLARE_API_TOKEN
src="$1"
mkdir -p "$HOME/.cache"
dest=$(mktemp -d "$HOME/.cache/ara-cloudflare-deploy.XXXXXX")
case "$dest" in
  "$HOME"/.cache/ara-cloudflare-deploy.*) ;;
  *) echo "Unsafe temporary build directory." >&2; exit 1 ;;
esac
cleanup() { rm -rf -- "$dest"; }
trap cleanup EXIT HUP INT TERM

cd "$src"
tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.pnpm-store \
  --exclude=.turbo \
  --exclude=.next \
  --exclude=.open-next \
  --exclude=.wrangler \
  --exclude=review-logs \
  --exclude=.env.local \
  -cf - . | tar -xf - -C "$dest"

cd "$dest"
pnpm install --frozen-lockfile
pnpm --filter @ara/web build:cloudflare
pnpm --filter @ara/web exec opennextjs-cloudflare deploy
