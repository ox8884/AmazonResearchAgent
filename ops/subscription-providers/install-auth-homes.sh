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

preflight_path() {
  local path="$1" expected="$2"
  if [[ -e "$path" || -L "$path" ]]; then
    [[ -d "$path" && ! -L "$path" && "$(stat -c '%U:%G:%a' -- "$path")" == "$expected" ]] || fail "unsafe existing path $path"
  else
    parent="$(dirname -- "$path")"
    [[ ! -e "$parent" && ! -L "$parent" ]] || [[ -d "$parent" && ! -L "$parent" ]] || fail "unsafe path parent $parent"
  fi
}

preflight_identity() {
  local adapter="$1" user="$2" ipc="$3" auth runtime primary_group
  getent passwd "$WORKER" >/dev/null || fail 'missing existing worker identity'
  getent group "$ipc" >/dev/null || fail "missing pre-provisioned IPC group $ipc"
  getent group "$user" >/dev/null || fail "missing pre-provisioned primary group $user"
  getent passwd "$user" >/dev/null || fail "missing pre-provisioned identity $user"
  [[ "$(getent passwd "$user" | cut -d: -f7)" == /usr/sbin/nologin ]] || fail "unsafe existing identity $user"
  primary_group="$(id -gn "$user")"
  [[ "$primary_group" == "$user" ]] || fail "primary group drift for $user"
  allow_only_groups "$user" "$user,$ipc"
  allow_only_groups "$WORKER" 'amazon-research,ara-codex-ipc,ara-grok-ipc'
  exact_groups "$WORKER" "$(printf '%s\n' "$WORKER" ara-codex-ipc ara-grok-ipc | sort | paste -sd, -)"
  exact_groups "$user" "$(printf '%s\n' "$user" "$ipc" | sort | paste -sd, -)"
  auth="$(root_path "/var/lib/amazon-research/subscription/$adapter")"
  runtime="$(root_path "/run/amazon-research/subscription/$adapter")"
  preflight_path "$auth" "$user:$user:700"
  preflight_path "$runtime" "root:$ipc:750"
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

install_identity_paths() {
  local adapter="$1" user="$2" ipc="$3" auth runtime
  auth="$(root_path "/var/lib/amazon-research/subscription/$adapter")"
  runtime="$(root_path "/run/amazon-research/subscription/$adapter")"
  install_path "$auth" "$user" "$user" 0700
  install_path "$runtime" root "$ipc" 0750
}
declare -a CREATED_PATHS=()
rollback_paths() {
  local index
  for ((index=${#CREATED_PATHS[@]}-1; index>=0; index--)); do
    rmdir -- "${CREATED_PATHS[$index]}" 2>/dev/null || true
  done
}
install_path() {
  local path="$1" owner="$2" group="$3" mode="$4"
  if [[ ! -e "$path" && ! -L "$path" ]]; then CREATED_PATHS+=("$path"); fi
  install -d -o "$owner" -g "$group" -m "$mode" -- "$path"
}
transaction_exit() {
  local status=$?
  if (( status != 0 )); then rollback_paths; fi
  exit "$status"
}

if [[ "$MODE" == install ]]; then
  # Identity/group creation and membership changes are deliberately outside this
  # installer: NSS mutations are not truthfully rollback-safe. Require the exact
  # pre-provisioned state before the first filesystem mutation.
  for spec in "${ADAPTERS[@]}"; do
    IFS='|' read -r adapter user ipc <<<"$spec"
    preflight_identity "$adapter" "$user" "$ipc"
  done
  codex_auth="$(root_path /var/lib/amazon-research/subscription/codex)"
  grok_auth="$(root_path /var/lib/amazon-research/subscription/grok)"
  [[ "$codex_auth" != "$grok_auth" ]] || fail 'shared auth home rejected'
  trap transaction_exit EXIT
  for spec in "${ADAPTERS[@]}"; do
    IFS='|' read -r adapter user ipc <<<"$spec"
    install_identity_paths "$adapter" "$user" "$ipc"
  done
  trap - EXIT
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
