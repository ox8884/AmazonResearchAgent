#!/usr/bin/env bash
set -euo pipefail

readonly MODE="${1:-}"
readonly ADAPTER="${2:-}"
readonly FIXTURE_ROOT_ARG="$([[ "${3:-}" == --fixture-root ]] && printf '%s' "${4:-}")"
readonly FIXTURE_REPOSITORY_ARG="$([[ "${5:-}" == --repository-root ]] && printf '%s' "${6:-}")"
readonly REPOSITORY_ROOT="${FIXTURE_REPOSITORY_ARG:-${ARA_REPOSITORY_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}}"
readonly OUTPUT="${ARA_PROFILE_OUTPUT:-}"
readonly PREFIX="${FIXTURE_ROOT_ARG:-${ARA_INSTALL_ROOT:-}}"
readonly FIXTURE_MODE="$([[ -n "$FIXTURE_ROOT_ARG" ]] && printf 1 || printf '%s' "${ARA_FIXTURE_MODE:-0}")"
readonly PROBE="$REPOSITORY_ROOT/scripts/probe-subscription-provider.mjs"
fail() { printf 'verify-runtime-profile: %s\n' "$1" >&2; exit 1; }
sha() { sha256sum -- "$1" | cut -d' ' -f1; }
readonly ACTIVE_NFT_JSON="$(mktemp)"

case "$MODE" in verify|dry-run) ;; *) fail 'usage: verify-runtime-profile.sh verify|dry-run codex|grok' ;; esac
case "$ADAPTER" in codex|grok) ;; *) fail 'adapter must be codex or grok' ;; esac
[[ $# -eq 2 || ( $# -eq 6 && "$MODE" == verify && "${3:-}" == --fixture-root && "${5:-}" == --repository-root && -n "$FIXTURE_ROOT_ARG" && -n "$FIXTURE_REPOSITORY_ARG" ) ]] || fail 'closed fixture arguments rejected'

readonly SOURCE_UNIT="$REPOSITORY_ROOT/ops/systemd/amazon-research-${ADAPTER}@.service"
readonly AUTHORITY="$([[ "$MODE" == dry-run ]] && printf '%s' "$REPOSITORY_ROOT/ops/subscription-providers/endpoint-bindings.json" || printf '%s' "${PREFIX}/etc/amazon-research/subscription/endpoint-bindings.json")"
readonly ENVIRONMENT="$([[ "$MODE" == dry-run || "$FIXTURE_MODE" == 1 ]] && printf local-fixture || printf oracle)"
readonly SOURCE_COMMON=(
  "$REPOSITORY_ROOT/ops/subscription-providers/manage-invocation.sh"
  "$REPOSITORY_ROOT/ops/subscription-providers/subscription-gc-decision.mjs"
  "$REPOSITORY_ROOT/ops/subscription-providers/subscription-supervisor.mjs"
  "$REPOSITORY_ROOT/ops/systemd/amazon-research-subscription-gc.service"
  "$REPOSITORY_ROOT/ops/systemd/amazon-research-subscription-gc.timer"
  "$REPOSITORY_ROOT/ops/polkit/50-amazon-research-subscription.rules"
)
readonly INSTALLED_UNIT="${PREFIX}/etc/systemd/system/amazon-research-${ADAPTER}@.service"
readonly INSTALLED_COMMON=(
  "${PREFIX}/usr/local/libexec/amazon-research/manage-invocation.sh"
  "${PREFIX}/usr/local/libexec/amazon-research/subscription-gc-decision.mjs"
  "${PREFIX}/usr/local/libexec/amazon-research/subscription-supervisor.mjs"
  "${PREFIX}/etc/systemd/system/amazon-research-subscription-gc.service"
  "${PREFIX}/etc/systemd/system/amazon-research-subscription-gc.timer"
  "${PREFIX}/etc/polkit-1/rules.d/50-amazon-research-subscription.rules"
)
readonly INSTALLED_POLICY="${PREFIX}/etc/nftables.d/amazon-research-subscription.nft"
readonly UNIT="$([[ "$MODE" == dry-run ]] && printf '%s' "$SOURCE_UNIT" || printf '%s' "$INSTALLED_UNIT")"
readonly COMMON_NAME="$([[ "$MODE" == dry-run ]] && printf SOURCE_COMMON || printf INSTALLED_COMMON)"
declare -n COMMON="$COMMON_NAME"
for artifact in "$UNIT" "$AUTHORITY" "$PROBE" "${COMMON[@]}"; do
  [[ -f "$artifact" && ! -L "$artifact" ]] || fail "invalid profile artifact: $artifact"
done
if [[ "$ENVIRONMENT" == oracle ]]; then
  [[ "$(stat -c '%u:%g:%a' -- "$AUTHORITY")" == '0:0:444' ]] || fail 'endpoint authority must be root:root 0444'
  [[ "$(realpath -- "$AUTHORITY")" == '/etc/amazon-research/subscription/endpoint-bindings.json' ]] || fail 'endpoint authority fixed path rejected'
fi

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

readonly RENDERED_POLICY="$(mktemp)"
trap 'rm -f -- "$RENDERED_POLICY" "$ACTIVE_NFT_JSON"' EXIT
node "$PROBE" --mode render-endpoint-policy --authority "$AUTHORITY" --environment "$ENVIRONMENT" >"$RENDERED_POLICY"
readonly POLICY="$([[ "$MODE" == dry-run ]] && printf '%s' "$RENDERED_POLICY" || printf '%s' "$INSTALLED_POLICY")"
grep -Eq 'elements = \{[^}]+\}' "$RENDERED_POLICY" || fail 'rendered policy is empty'
if [[ "$MODE" == verify ]]; then
  [[ -f "$INSTALLED_POLICY" && ! -L "$INSTALLED_POLICY" ]] || fail 'installed nft policy missing or unsafe'
  cmp -s -- "$RENDERED_POLICY" "$INSTALLED_POLICY" || fail 'installed nft policy drift'
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    sources=("$SOURCE_UNIT" "${SOURCE_COMMON[@]}")
    installed=("$INSTALLED_UNIT" "${INSTALLED_COMMON[@]}")
    for index in "${!sources[@]}"; do
      cmp -s -- "${sources[$index]}" "${installed[$index]}" || fail "installed artifact drift: ${installed[$index]}"
    done
  fi
fi
readonly POLICY_DIGEST="$(
  for artifact in "$UNIT" "${COMMON[@]}" "$AUTHORITY" "$INSTALLED_POLICY"; do
    [[ "$MODE" == dry-run && "$artifact" == "$INSTALLED_POLICY" ]] && artifact="$RENDERED_POLICY"
    printf '%s\0' "$artifact"
    cat -- "$artifact"
    printf '\0'
  done | sha256sum | cut -d' ' -f1
)"

if [[ "$MODE" == verify ]]; then
  [[ "$(uname -s)" == Linux || "$FIXTURE_MODE" == 1 ]] || fail 'host verification requires Linux'
  if [[ "$FIXTURE_MODE" != 1 ]]; then
    node "$PROBE" --mode verify-installed --authority "$AUTHORITY" >/dev/null
    systemd-analyze verify "$INSTALLED_UNIT" >/dev/null
    nft --check --file "$INSTALLED_POLICY"
    /usr/sbin/nft --json list table inet amazon_research_subscription >"$ACTIVE_NFT_JSON"
    node "$PROBE" --mode verify-active-nft --authority "$AUTHORITY" --active-json "$ACTIVE_NFT_JSON" >/dev/null
    pkaction --action-id org.freedesktop.systemd1.manage-units >/dev/null
    [[ "$(stat -fc %T /sys/fs/cgroup)" == cgroup2fs ]] || fail 'unified cgroup v2 required'
    readonly USER="ara-$ADAPTER"
    readonly IPC="ara-$ADAPTER-ipc"
    readonly AUTH="/var/lib/amazon-research/subscription/$ADAPTER"
    readonly RUNTIME="/run/amazon-research/subscription/$ADAPTER"
    node "$PROBE" --mode verify-nss-identity --authority "$AUTHORITY" --adapter "$ADAPTER" >/dev/null
    [[ -d "$AUTH" && ! -L "$AUTH" && "$(stat -c '%U:%G:%a' "$AUTH")" == "$USER:$USER:700" ]] || fail 'auth home drift'
    [[ -d "$RUNTIME" && ! -L "$RUNTIME" && "$(stat -c '%U:%G:%a' "$RUNTIME")" == "root:$IPC:750" ]] || fail 'runtime root drift'
  fi
fi

report="{\"schemaVersion\":2,\"ok\":true,\"mode\":\"$MODE\",\"adapter\":\"$ADAPTER\",\"authoritySha256\":\"$(sha "$AUTHORITY")\",\"policySha256\":\"$(sha "$POLICY")\",\"policyDigest\":\"$POLICY_DIGEST\",\"localFixtureVerified\":$([[ "$ENVIRONMENT" == local-fixture ]] && printf true || printf false),\"oracleHostVerified\":$([[ "$MODE" == verify && "$ENVIRONMENT" == oracle ]] && printf true || printf false),\"liveProviderVerified\":false,\"productionActivated\":false}"
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
