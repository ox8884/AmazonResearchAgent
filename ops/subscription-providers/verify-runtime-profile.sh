#!/usr/bin/env bash
set -euo pipefail

readonly MODE="${1:-}"
readonly ADAPTER="${2:-}"
readonly REPOSITORY_ROOT="${ARA_REPOSITORY_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
readonly OUTPUT="${ARA_PROFILE_OUTPUT:-}"
fail() { printf 'verify-runtime-profile: %s\n' "$1" >&2; exit 1; }
sha() { sha256sum -- "$1" | cut -d' ' -f1; }

case "$MODE" in verify|dry-run) ;; *) fail 'usage: verify-runtime-profile.sh verify|dry-run codex|grok' ;; esac
case "$ADAPTER" in codex|grok) ;; *) fail 'adapter must be codex or grok' ;; esac

readonly UNIT="$REPOSITORY_ROOT/ops/systemd/amazon-research-${ADAPTER}@.service"
readonly COMMON=(
  "$REPOSITORY_ROOT/ops/subscription-providers/manage-invocation.sh"
  "$REPOSITORY_ROOT/ops/subscription-providers/subscription-supervisor.mjs"
  "$REPOSITORY_ROOT/ops/systemd/amazon-research-subscription-gc.service"
  "$REPOSITORY_ROOT/ops/systemd/amazon-research-subscription-gc.timer"
  "$REPOSITORY_ROOT/ops/polkit/50-amazon-research-subscription.rules"
  "$REPOSITORY_ROOT/ops/nftables/amazon-research-subscription.nft"
)
for artifact in "$UNIT" "${COMMON[@]}"; do
  [[ -f "$artifact" && ! -L "$artifact" ]] || fail "invalid repository artifact: $artifact"
done

unit_text="$(cat -- "$UNIT")"
for fixed in \
  'Type=notify' 'NotifyAccess=main' 'TimeoutStartSec=20' 'TimeoutStopSec=15' \
  'RuntimeMaxSec=150' 'KillMode=control-group' 'StandardOutput=null' 'StandardError=null' \
  'ProtectSystem=strict' 'ProtectHome=yes' 'PrivateTmp=yes' 'PrivateDevices=yes' \
  'NoNewPrivileges=yes' 'NoExecPaths=/' 'IPAddressDeny=any'; do
  grep -Fqx -- "$fixed" <<<"$unit_text" || fail "unit profile drift: $fixed"
done
grep -Fqx -- "ExecStartPre=+/usr/local/libexec/amazon-research/manage-invocation.sh prepare-and-wait $ADAPTER %i" <<<"$unit_text" || fail 'ExecStartPre drift'
grep -Fqx -- "ExecStart=/usr/bin/node /usr/local/libexec/amazon-research/subscription-supervisor.mjs $ADAPTER %i" <<<"$unit_text" || fail 'ExecStart drift'
grep -Fqx -- "ExecStopPost=+/usr/local/libexec/amazon-research/manage-invocation.sh cleanup $ADAPTER %i" <<<"$unit_text" || fail 'ExecStopPost drift'

readonly POLICY_DIGEST="$(
  for artifact in "$UNIT" "${COMMON[@]}"; do
    printf '%s\0' "${artifact#"$REPOSITORY_ROOT/"}"
    cat -- "$artifact"
    printf '\0'
  done | sha256sum | cut -d' ' -f1
)"

if [[ "$MODE" == verify ]]; then
  [[ "$(uname -s)" == Linux ]] || fail 'host verification requires Linux'
  systemd-analyze verify "$UNIT" >/dev/null
  nft --check --file "$REPOSITORY_ROOT/ops/nftables/amazon-research-subscription.nft"
  pkaction --action-id org.freedesktop.systemd1.manage-units >/dev/null
  [[ "$(stat -fc %T /sys/fs/cgroup)" == cgroup2fs ]] || fail 'unified cgroup v2 required'
  readonly USER="ara-$ADAPTER"
  readonly IPC="ara-$ADAPTER-ipc"
  readonly AUTH="/var/lib/amazon-research/subscription/$ADAPTER"
  readonly RUNTIME="/run/amazon-research/subscription/$ADAPTER"
  getent passwd "$USER" >/dev/null || fail "missing $USER"
  [[ "$(getent passwd "$USER" | cut -d: -f7)" == /usr/sbin/nologin ]] || fail 'adapter login shell drift'
  [[ -d "$AUTH" && ! -L "$AUTH" && "$(stat -c '%U:%G:%a' "$AUTH")" == "$USER:$USER:700" ]] || fail 'auth home drift'
  [[ -d "$RUNTIME" && ! -L "$RUNTIME" && "$(stat -c '%U:%G:%a' "$RUNTIME")" == "root:$IPC:750" ]] || fail 'runtime root drift'
fi

report="{\"schemaVersion\":1,\"ok\":true,\"mode\":\"$MODE\",\"adapter\":\"$ADAPTER\",\"policyDigest\":\"$POLICY_DIGEST\",\"oracleHostVerified\":$([[ "$MODE" == verify ]] && printf true || printf false),\"liveProviderVerified\":false,\"productionActivated\":false}"
[[ "${#report}" -le 4096 ]] || fail 'report exceeded fixed bound'
if [[ -n "$OUTPUT" ]]; then
  [[ "$OUTPUT" == /* ]] || fail 'profile output must be absolute'
  temporary="${OUTPUT}.tmp"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || fail 'profile temporary path exists'
  (umask 027; printf '%s\n' "$report" >"$temporary")
  mv -- "$temporary" "$OUTPUT"
else
  printf '%s\n' "$report"
fi
