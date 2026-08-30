#!/usr/bin/env bash
set -euo pipefail

readonly ACTION="${1:-}"
readonly ADAPTER="${2:-}"
readonly INSTANCE="${3:-}"
readonly UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
readonly BASE='/run/amazon-research/subscription'

case "$ADAPTER" in
  codex) readonly GROUP='ara-codex-ipc' ;;
  grok) readonly GROUP='ara-grok-ipc' ;;
  *) exit 64 ;;
esac
[[ "$INSTANCE" =~ $UUID_RE ]] || exit 64
readonly ROOT="$BASE/$ADAPTER"
readonly INVOCATION="$ROOT/$INSTANCE"
[[ "$INVOCATION" == "$ROOT/$INSTANCE" ]] || exit 65
[[ -d "$ROOT" && ! -L "$ROOT" ]] || exit 65
[[ "$(stat -c '%U:%G:%a' -- "$ROOT")" == "root:$GROUP:750" ]] || exit 65

prepare_and_wait() {
  [[ ! -e "$INVOCATION" && ! -L "$INVOCATION" ]] || exit 66
  install -d -o amazon-research -g "$GROUP" -m 2770 -- "$INVOCATION"
  [[ "$(stat -c '%U:%G:%a' -- "$INVOCATION")" == "amazon-research:$GROUP:2770" ]] || exit 66
  local elapsed=0
  while (( elapsed < 50 )); do
    if [[ -e "$INVOCATION/request.json" ]]; then
      [[ -f "$INVOCATION/request.json" && ! -L "$INVOCATION/request.json" ]] || exit 67
      [[ "$(stat -c '%U:%G:%a' -- "$INVOCATION/request.json")" == "amazon-research:$GROUP:640" ]] || exit 67
      (( "$(stat -c '%s' -- "$INVOCATION/request.json")" <= 262144 )) || exit 67
      /usr/bin/node /usr/local/libexec/amazon-research/subscription-supervisor.mjs --validate-request "$ADAPTER" "$INSTANCE"
      return
    fi
    /usr/bin/sleep 0.1
    elapsed=$((elapsed + 1))
  done
  exit 68
}

cleanup() {
  [[ ! -L "$INVOCATION" ]] || exit 69
  if [[ -e "$INVOCATION" ]]; then
    [[ -d "$INVOCATION" ]] || exit 69
    [[ "$(readlink -f -- "$INVOCATION")" == "$INVOCATION" ]] || exit 69
    rm -rf --one-file-system -- "$INVOCATION"
  fi
}

gc() {
  local path instance unit active
  shopt -s nullglob
  for path in "$ROOT"/*; do
    [[ -d "$path" && ! -L "$path" ]] || continue
    instance="${path##*/}"
    [[ "$instance" =~ $UUID_RE ]] || continue
    unit="amazon-research-${ADAPTER}@${instance}.service"
    active="$(systemctl show "$unit" --property=ActiveState --value 2>/dev/null || true)"
    [[ "$active" == inactive || "$active" == failed || -z "$active" ]] || continue
    find "$path" -maxdepth 0 -mmin +10 -print -quit | grep -q . || continue
    rm -rf --one-file-system -- "$path"
  done
}

case "$ACTION" in
  prepare-and-wait) prepare_and_wait ;;
  cleanup) cleanup ;;
  gc) gc ;;
  *) exit 64 ;;
esac
