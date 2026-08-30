#!/usr/bin/env bash
set -euo pipefail

readonly ACTION="${1:-}"
readonly ADAPTER="${2:-}"
readonly INSTANCE="${3:-}"
readonly UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
readonly BASE='/run/amazon-research/subscription'

case "$ADAPTER" in
  codex)
    readonly GROUP='ara-codex-ipc'
    readonly SERVICE_USER='ara-codex'
    readonly SERVICE_GROUP='ara-codex'
    ;;
  grok)
    readonly GROUP='ara-grok-ipc'
    readonly SERVICE_USER='ara-grok'
    readonly SERVICE_GROUP='ara-grok'
    ;;
  *) exit 64 ;;
esac
[[ "$INSTANCE" =~ $UUID_RE ]] || exit 64
readonly ROOT="$BASE/$ADAPTER"
readonly INVOCATION="$ROOT/$INSTANCE"
readonly APPROVED_ROOT="$ROOT/.approved"
readonly APPROVED="$APPROVED_ROOT/$INSTANCE"
readonly SERVICE_GID="$(id -g "$SERVICE_USER")"
[[ "$INVOCATION" == "$ROOT/$INSTANCE" ]] || exit 65
[[ -d "$ROOT" && ! -L "$ROOT" ]] || exit 65
[[ "$(stat -c '%U:%G:%a' -- "$ROOT")" == "root:$GROUP:750" ]] || exit 65

prepare_and_wait() {
  [[ ! -e "$INVOCATION" && ! -L "$INVOCATION" ]] || exit 66
  install -d -o root -g "$SERVICE_GROUP" -m 0750 -- "$APPROVED_ROOT"
  [[ "$(stat -c '%U:%G:%a' -- "$APPROVED_ROOT")" == "root:$SERVICE_GROUP:750" ]] || exit 66
  [[ ! -e "$APPROVED" && ! -L "$APPROVED" ]] || exit 66
  install -d -o root -g "$SERVICE_GROUP" -m 2550 -- "$APPROVED"
  [[ "$(stat -c '%U:%G:%a' -- "$APPROVED")" == "root:$SERVICE_GROUP:2550" ]] || exit 66
  install -d -o amazon-research -g "$GROUP" -m 2770 -- "$INVOCATION"
  [[ "$(stat -c '%U:%G:%a' -- "$INVOCATION")" == "amazon-research:$GROUP:2770" ]] || exit 66
  local elapsed=0
  while (( elapsed < 50 )); do
    if [[ -e "$INVOCATION/request.json" ]]; then
      /usr/bin/node /usr/local/libexec/amazon-research/subscription-supervisor.mjs \
        --approve-request "$ADAPTER" "$INSTANCE" "$SERVICE_GID"
      [[ ! -e "$INVOCATION/request.json" && ! -L "$INVOCATION/request.json" ]] || exit 67
      [[ -f "$APPROVED/request.json" && ! -L "$APPROVED/request.json" ]] || exit 67
      [[ "$(stat -c '%U:%G:%a' -- "$APPROVED/request.json")" == "root:$SERVICE_GROUP:440" ]] || exit 67
      return
    fi
    /usr/bin/sleep 0.1
    elapsed=$((elapsed + 1))
  done
  exit 68
}

cleanup() {
  [[ ! -L "$INVOCATION" && ! -L "$APPROVED" ]] || exit 69
  if [[ -e "$INVOCATION" ]]; then
    [[ -d "$INVOCATION" ]] || exit 69
    [[ "$(readlink -f -- "$INVOCATION")" == "$INVOCATION" ]] || exit 69
    rm -rf --one-file-system -- "$INVOCATION"
  fi
  if [[ -e "$APPROVED" ]]; then
    [[ -d "$APPROVED" ]] || exit 69
    [[ "$(readlink -f -- "$APPROVED")" == "$APPROVED" ]] || exit 69
    rm -rf --one-file-system -- "$APPROVED"
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
    rm -rf --one-file-system -- "$APPROVED_ROOT/$instance"
  done
}

case "$ACTION" in
  prepare-and-wait) prepare_and_wait ;;
  cleanup) cleanup ;;
  gc) gc ;;
  *) exit 64 ;;
esac
