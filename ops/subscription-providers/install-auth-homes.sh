#!/usr/bin/env bash
set -euo pipefail

readonly MODE="${1:-}"
readonly PREFIX="${ARA_INSTALL_ROOT:-}"
fail() { printf 'install-auth-homes: %s\n' "$1" >&2; exit 1; }
root_path() { printf '%s%s' "$PREFIX" "$1"; }

case "$MODE" in install|verify|dry-run) ;; *) fail 'usage: install-auth-homes.sh install|verify|dry-run' ;; esac
[[ "$MODE" != install || -z "$PREFIX" ]] || fail 'prefixed fixtures are verify/dry-run only'
[[ "$MODE" != install || "${EUID:-$(id -u)}" -eq 0 ]] || fail 'install requires root'

readonly WORKER='amazon-research'
readonly ADAPTERS=('codex|ara-codex|ara-codex-ipc' 'grok|ara-grok|ara-grok-ipc')

exact_groups() {
  local user="$1" expected="$2" actual
  actual="$(id -nG "$user" | tr ' ' '\n' | sort | paste -sd, -)"
  [[ "$actual" == "$expected" ]] || fail "group membership drift for $user"
}
allow_only_groups() {
  local user="$1" allowed="$2" group
  while IFS= read -r group; do
    [[ ",$allowed," == *",$group,"* ]] || fail "unexpected existing group $group for $user"
  done < <(id -nG "$user" | tr ' ' '\n')
}

verify_identity() {
  local adapter="$1" user="$2" ipc="$3" auth runtime owner expected_worker expected_adapter
  auth="$(root_path "/var/lib/amazon-research/subscription/$adapter")"
  runtime="$(root_path "/run/amazon-research/subscription/$adapter")"
  getent passwd "$user" >/dev/null || fail "missing identity $user"
  [[ "$(getent passwd "$user" | cut -d: -f7)" == /usr/sbin/nologin ]] || fail "login shell drift for $user"
  [[ -d "$auth" && ! -L "$auth" ]] || fail "invalid auth home $auth"
  owner="$(stat -c '%U:%G:%a' -- "$auth")"
  [[ "$owner" == "$user:$user:700" ]] || fail "auth home ownership drift for $auth"
  [[ -d "$runtime" && ! -L "$runtime" ]] || fail "invalid runtime parent $runtime"
  [[ "$(stat -c '%U:%G:%a' -- "$runtime")" == "root:$ipc:750" ]] || fail "runtime parent drift for $runtime"
  expected_worker="$(printf '%s\n' "$WORKER" ara-codex-ipc ara-grok-ipc | sort | paste -sd, -)"
  expected_adapter="$(printf '%s\n' "$user" "$ipc" | sort | paste -sd, -)"
  exact_groups "$WORKER" "$expected_worker"
  exact_groups "$user" "$expected_adapter"
}

install_identity() {
  local adapter="$1" user="$2" ipc="$3" auth runtime
  getent group "$ipc" >/dev/null || groupadd --system "$ipc"
  if getent passwd "$user" >/dev/null; then
    [[ "$(getent passwd "$user" | cut -d: -f7)" == /usr/sbin/nologin ]] || fail "unsafe existing identity $user"
  else
    useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
  fi
  getent passwd "$WORKER" >/dev/null || fail "missing existing worker identity"
  allow_only_groups "$WORKER" 'amazon-research,ara-codex-ipc,ara-grok-ipc'
  allow_only_groups "$user" "$user,$ipc"
  usermod --append --groups "$ipc" "$WORKER"
  usermod --append --groups "$ipc" "$user"
  auth="/var/lib/amazon-research/subscription/$adapter"
  runtime="/run/amazon-research/subscription/$adapter"
  [[ ! -e "$auth" && ! -L "$auth" ]] || {
    [[ -d "$auth" && ! -L "$auth" && "$(stat -c '%U:%G:%a' -- "$auth")" == "$user:$user:700" ]] || fail "unsafe existing auth home $auth"
  }
  install -d -o "$user" -g "$user" -m 0700 -- "$auth"
  [[ ! -e "$runtime" && ! -L "$runtime" ]] || {
    [[ -d "$runtime" && ! -L "$runtime" && "$(stat -c '%U:%G:%a' -- "$runtime")" == "root:$ipc:750" ]] || fail "unsafe existing runtime parent $runtime"
  }
  install -d -o root -g "$ipc" -m 0750 -- "$runtime"
}

if [[ "$MODE" == install ]]; then
  for spec in "${ADAPTERS[@]}"; do
    IFS='|' read -r adapter user ipc <<<"$spec"
    install_identity "$adapter" "$user" "$ipc"
  done
fi
for spec in "${ADAPTERS[@]}"; do
  IFS='|' read -r adapter user ipc <<<"$spec"
  case "$MODE" in
    install|verify) verify_identity "$adapter" "$user" "$ipc" ;;
    dry-run) printf 'VERIFY identity=%s shell=/usr/sbin/nologin ipc=%s auth=/var/lib/amazon-research/subscription/%s:0700 runtime=/run/amazon-research/subscription/%s:0750\n' "$user" "$ipc" "$adapter" "$adapter" ;;
  esac
done

if [[ "$MODE" != dry-run ]]; then
  codex_auth="$(root_path /var/lib/amazon-research/subscription/codex)"
  grok_auth="$(root_path /var/lib/amazon-research/subscription/grok)"
  [[ "$(realpath -- "$codex_auth")" != "$(realpath -- "$grok_auth")" ]] || fail 'shared auth home rejected'
fi
printf 'PASS mode=%s dedicated_auth_homes=2 production_activation=false\n' "$MODE"
