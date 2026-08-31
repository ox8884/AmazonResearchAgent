#!/usr/bin/env bash
set -euo pipefail

readonly MODE="${1:-}"
readonly REPOSITORY_ROOT="${ARA_REPOSITORY_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
readonly PREFIX="${ARA_INSTALL_ROOT:-}"

fail() { printf 'install-systemd-sandbox: %s\n' "$1" >&2; exit 1; }
root_path() { printf '%s%s' "$PREFIX" "$1"; }
require_root() { [[ "$MODE" != install || "${EUID:-$(id -u)}" -eq 0 ]] || fail 'install requires root'; }

case "$MODE" in install|verify|dry-run) ;; *) fail 'usage: install-systemd-sandbox.sh install|verify|dry-run' ;; esac
require_root

if [[ -z "$PREFIX" && "$MODE" != dry-run ]]; then
  [[ "$(uname -s)" == Linux ]] || fail 'host verification requires Linux'
  [[ -r /etc/os-release ]] || fail 'missing os-release'
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || fail 'Ubuntu 24.04 required'
  readonly SYSTEMD_VERSION="$(systemctl --version | sed -n '1s/^systemd \([0-9][0-9]*\).*/\1/p')"
  [[ "$SYSTEMD_VERSION" =~ ^[0-9]+$ && "$SYSTEMD_VERSION" -ge 255 ]] || fail 'systemd >=255 required'
  [[ "$(stat -fc %T /sys/fs/cgroup)" == cgroup2fs ]] || fail 'unified cgroup v2 required'
  command -v nft >/dev/null || fail 'nftables required'
  command -v pkaction >/dev/null || fail 'polkit required'
else
  [[ "$MODE" != install ]] || fail 'prefixed fixtures are verify/dry-run only'
fi

readonly ARTIFACTS=(
  'ops/subscription-providers/subscription-supervisor.mjs|/usr/local/libexec/amazon-research/subscription-supervisor.mjs|0500'
  'ops/subscription-providers/manage-invocation.sh|/usr/local/libexec/amazon-research/manage-invocation.sh|0500'
  'ops/systemd/amazon-research-codex@.service|/etc/systemd/system/amazon-research-codex@.service|0444'
  'ops/systemd/amazon-research-grok@.service|/etc/systemd/system/amazon-research-grok@.service|0444'
  'ops/systemd/amazon-research-subscription-gc.service|/etc/systemd/system/amazon-research-subscription-gc.service|0444'
  'ops/systemd/amazon-research-subscription-gc.timer|/etc/systemd/system/amazon-research-subscription-gc.timer|0444'
  'ops/polkit/50-amazon-research-subscription.rules|/etc/polkit-1/rules.d/50-amazon-research-subscription.rules|0444'
  'ops/nftables/amazon-research-subscription.nft|/etc/nftables.d/amazon-research-subscription.nft|0444'
)

verify_source() {
  local source="$1"
  [[ -f "$source" && ! -L "$source" ]] || fail "invalid source artifact: $source"
}

verify_installed() {
  local source="$1" target="$2" mode="$3" expected actual owner
  [[ -f "$target" && ! -L "$target" ]] || fail "missing regular installed artifact: $target"
  expected="$(sha256sum -- "$source" | cut -d' ' -f1)"
  actual="$(sha256sum -- "$target" | cut -d' ' -f1)"
  [[ "$actual" == "$expected" ]] || fail "digest drift: $target"
  owner="$(stat -c '%u:%g:%a' -- "$target")"
  [[ "$owner" == "0:0:${mode#0}" ]] || fail "owner or mode drift: $target"
}

install_one() {
  local source="$1" target="$2" mode="$3" directory
  directory="$(dirname -- "$target")"
  install -d -o root -g root -m 0755 -- "$directory"
  if [[ -e "$target" || -L "$target" ]]; then
    verify_installed "$source" "$target" "$mode"
    return
  fi
  install -o root -g root -m "$mode" -- "$source" "$target"
  verify_installed "$source" "$target" "$mode"
}

for spec in "${ARTIFACTS[@]}"; do
  IFS='|' read -r source_relative target_absolute mode <<<"$spec"
  source="$REPOSITORY_ROOT/$source_relative"
  target="$(root_path "$target_absolute")"
  verify_source "$source"
  case "$MODE" in
    install) install_one "$source" "$target" "$mode" ;;
    verify) verify_installed "$source" "$target" "$mode" ;;
    dry-run) printf 'VERIFY %s -> %s sha256=%s mode=%s\n' "$source_relative" "$target_absolute" "$(sha256sum -- "$source" | cut -d' ' -f1)" "$mode" ;;
  esac
done

if [[ "$MODE" == install ]]; then
  systemd-analyze verify \
    /etc/systemd/system/amazon-research-codex@.service \
    /etc/systemd/system/amazon-research-grok@.service \
    /etc/systemd/system/amazon-research-subscription-gc.service \
    /etc/systemd/system/amazon-research-subscription-gc.timer
  nft --check --file /etc/nftables.d/amazon-research-subscription.nft
  systemctl daemon-reload
fi
printf 'PASS mode=%s artifacts=%d production_activation=false\n' "$MODE" "${#ARTIFACTS[@]}"
