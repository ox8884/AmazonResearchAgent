#!/usr/bin/env bash
set -euo pipefail

readonly MODE="${1:-}"
readonly FIXTURE_ROOT_ARG="$([[ "${2:-}" == --fixture-root ]] && printf '%s' "${3:-}")"
readonly FIXTURE_REPOSITORY_ARG="$([[ "${4:-}" == --repository-root ]] && printf '%s' "${5:-}")"
readonly FIXTURE_MODE="$([[ -n "$FIXTURE_ROOT_ARG" ]] && printf 1 || printf '%s' "${ARA_FIXTURE_MODE:-0}")"
readonly REPOSITORY_ROOT="${FIXTURE_REPOSITORY_ARG:-${ARA_REPOSITORY_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}}"
readonly PREFIX="${FIXTURE_ROOT_ARG:-${ARA_INSTALL_ROOT:-}}"
readonly PROBE="$REPOSITORY_ROOT/scripts/probe-subscription-provider.mjs"
readonly LOCK_HELPER="$REPOSITORY_ROOT/scripts/subscription-install-lock.mjs"
readonly LOCK_HELPER_SHA256='e1ec5095b4135c09f08a1e99b0601ce0a974488d52dd1d0df12f62bbf0d9a946'
readonly LOCK_HELPER_MODE='644'
readonly FIXTURE_AUTHORITY="$REPOSITORY_ROOT/ops/subscription-providers/endpoint-bindings.json"
readonly HOST_AUTHORITY="${PREFIX}/etc/amazon-research/subscription/endpoint-bindings.json"
readonly FIXTURE_FAIL_AT="$([[ "${6:-}" == --fail-at ]] && printf '%s' "${7:-}" || printf '%s' "${ARA_FIXTURE_FAIL_AT:-}")"
readonly FIXTURE_RACE_AT="$([[ "${6:-}" == --race-at ]] && printf '%s' "${7:-}" || printf '%s' "${ARA_FIXTURE_RACE_AT:-}")"

fail() { printf 'install-systemd-sandbox: %s\n' "$1" >&2; exit 1; }
root_path() { printf '%s%s' "$PREFIX" "$1"; }
sha() { sha256sum -- "$1" | cut -d' ' -f1; }

case "$MODE" in install|verify|dry-run) ;; *) fail 'usage: install-systemd-sandbox.sh install|verify|dry-run' ;; esac
[[ $# -eq 1 || ( ( $# -eq 5 || $# -eq 7 ) && "$MODE" == install && "${2:-}" == --fixture-root && "${4:-}" == --repository-root && -n "$FIXTURE_ROOT_ARG" && -n "$FIXTURE_REPOSITORY_ARG" ) ]] || fail 'closed fixture arguments rejected'
[[ -z "$FIXTURE_FAIL_AT" || ( $# -eq 7 && "${6:-}" == --fail-at && "$FIXTURE_FAIL_AT" =~ ^(stage|publish)-(0|1|2|3|4|5|6|nft)$ ) ]] || fail 'closed failure injection rejected'
[[ -z "$FIXTURE_RACE_AT" || ( $# -eq 7 && "${6:-}" == --race-at && "$FIXTURE_RACE_AT" =~ ^(publish|rollback)-(0|1|2|3|4|5|6|nft)$ ) ]] || fail 'closed race injection rejected'
[[ "$MODE" != install || -z "$PREFIX" || "$FIXTURE_MODE" == 1 ]] || fail 'prefixed install requires fixture mode'
[[ "$MODE" != install || "$FIXTURE_MODE" == 1 || "${EUID:-$(id -u)}" -eq 0 ]] || fail 'install requires root'

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
fi
command -v node >/dev/null || fail 'node required'
command -v install >/dev/null || fail 'install required'
command -v sha256sum >/dev/null || fail 'sha256sum required'
command -v ln >/dev/null || fail 'ln required'
command -v sync >/dev/null || fail 'sync required'
command -v flock >/dev/null || fail 'flock required'
[[ ( -z "$FIXTURE_FAIL_AT" && -z "$FIXTURE_RACE_AT" ) || "$FIXTURE_MODE" == 1 ]] || fail 'fixture injection requires fixture mode'

readonly ARTIFACTS=(
  'ops/subscription-providers/subscription-supervisor.mjs|/usr/local/libexec/amazon-research/subscription-supervisor.mjs|0500'
  'ops/subscription-providers/manage-invocation.sh|/usr/local/libexec/amazon-research/manage-invocation.sh|0500'
  'ops/systemd/amazon-research-codex@.service|/etc/systemd/system/amazon-research-codex@.service|0444'
  'ops/systemd/amazon-research-grok@.service|/etc/systemd/system/amazon-research-grok@.service|0444'
  'ops/systemd/amazon-research-subscription-gc.service|/etc/systemd/system/amazon-research-subscription-gc.service|0444'
  'ops/systemd/amazon-research-subscription-gc.timer|/etc/systemd/system/amazon-research-subscription-gc.timer|0444'
  'ops/polkit/50-amazon-research-subscription.rules|/etc/polkit-1/rules.d/50-amazon-research-subscription.rules|0444'
  'ops/subscription-providers/subscription-gc-decision.mjs|/usr/local/libexec/amazon-research/subscription-gc-decision.mjs|0500'
  'scripts/subscription-install-lock.mjs|/usr/local/libexec/amazon-research/subscription-install-lock.mjs|0500'
)

verify_regular() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail "invalid regular file: $path"
}

verify_target_parent() {
  local target="$1" parent
  parent="$(dirname -- "$target")"
  if [[ -e "$parent" || -L "$parent" ]]; then
    [[ -d "$parent" && ! -L "$parent" ]] || fail "unsafe target parent: $parent"
  fi
}

verify_transaction_staging_parent() {
  local parent="$1" owner_mode mode
  [[ -d "$parent" && ! -L "$parent" ]] || fail 'transaction staging parent rejected'
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    case "$(stat -fc %T -- "$parent")" in v9fs|drvfs) return ;; esac
  fi
  owner_mode="$(stat -c '%u:%g:%a' -- "$parent")"
  mode="${owner_mode##*:}"
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    (( ( 8#$mode & 022 ) == 0 )) || fail 'transaction staging parent rejected'
  else
    [[ "$owner_mode" == '0:0:755' ]] || fail 'transaction staging parent rejected'
  fi
}

verify_publication_parent() {
  local parent="$1" owner_mode mode
  [[ -d "$parent" && ! -L "$parent" ]] || fail "unsafe final parent: $parent"
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    case "$(stat -fc %T -- "$parent")" in v9fs|drvfs) return ;; esac
  fi
  owner_mode="$(stat -c '%u:%g:%a' -- "$parent")"
  mode="${owner_mode##*:}"
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    (( ( 8#$mode & 022 ) == 0 )) || fail "unsafe final parent: $parent"
  else
    [[ "$owner_mode" == 0:0:* ]] || fail "unsafe final parent: $parent"
  fi
}

verify_installed() {
  local source="$1" target="$2" mode="$3" metadata="${4:-installed}" owner
  verify_regular "$target"
  [[ "$(sha "$target")" == "$(sha "$source")" ]] || fail "digest drift: $target"
  if [[ "$metadata" == installed && "$FIXTURE_MODE" != 1 ]]; then
    owner="$(stat -c '%u:%g:%a' -- "$target")"
    [[ "$owner" == "0:0:${mode#0}" ]] || fail "owner or mode drift: $target"
  fi
}

readonly AUTHORITY="$([[ "$MODE" == dry-run ]] && printf '%s' "$FIXTURE_AUTHORITY" || printf '%s' "$HOST_AUTHORITY")"
readonly ENVIRONMENT="$([[ "$MODE" == dry-run || "$FIXTURE_MODE" == 1 ]] && printf local-fixture || printf oracle)"
verify_regular "$PROBE"
verify_regular "$AUTHORITY"
if [[ "$ENVIRONMENT" == oracle ]]; then
  [[ "$(stat -c '%u:%g:%a' -- "$AUTHORITY")" == '0:0:444' ]] || fail 'endpoint authority must be root:root 0444'
  [[ "$(realpath -- "$AUTHORITY")" == '/etc/amazon-research/subscription/endpoint-bindings.json' ]] || fail 'endpoint authority fixed path rejected'
fi
readonly TRANSACTION_LOCK="$(root_path /run/lock/amazon-research-subscription-install.lock)"
if [[ "$MODE" == install ]]; then
  lock_parent="$(dirname -- "$TRANSACTION_LOCK")"
  if [[ "$FIXTURE_MODE" == 1 ]]; then
    if [[ ! -e "$lock_parent" && ! -L "$lock_parent" ]]; then install -d -m 0755 -- "$lock_parent"; fi
  fi
  verify_transaction_staging_parent "$lock_parent"
  if [[ -z "${ARA_TRANSACTION_LOCK_FD:-}" ]]; then
    bootstrap_stage="$(mktemp -d --tmpdir="$lock_parent" .ara-subscription-lock.XXXXXX)" || fail 'transaction staging boundary rejected'
    chmod 0700 -- "$bootstrap_stage"
    bootstrap_helper_mode="$LOCK_HELPER_MODE"
    if [[ "$FIXTURE_MODE" == 1 ]]; then
      case "$(stat -fc %T -- "$lock_parent")" in v9fs|drvfs) bootstrap_helper_mode=fixture ;; esac
    fi
    node --input-type=module --eval '
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [helper, expectedDigest, expectedModeText, stage, expectedStageUidText, ...command] = process.argv.slice(1);
let handle;
try {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new TypeError("lock helper descriptor rejected");
  try {
    handle = await open(helper, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new TypeError("lock helper descriptor rejected");
  }
  const before = await handle.stat({ bigint: true });
  const expectedMode = expectedModeText === "fixture" ? undefined : BigInt(`0o${expectedModeText}`);
  const fixtureFilesystem = expectedModeText === "fixture";
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError("lock helper descriptor rejected");
  if (expectedMode !== undefined && (before.mode & 0o777n) !== expectedMode) throw new TypeError("lock helper mode rejected");
  const bytes = await handle.readFile();
  const after = await handle.stat({ bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode || before.size !== after.size) {
    throw new TypeError("lock helper descriptor identity rejected");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) throw new TypeError("lock helper digest rejected");
  const expectedStageUid = expectedStageUidText === "fixture" ? undefined : BigInt(expectedStageUidText);
  const stageInfo = await lstat(stage, { bigint: true });
  if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink() || (expectedStageUid !== undefined && stageInfo.uid !== expectedStageUid) || (!fixtureFilesystem && (stageInfo.mode & 0o777n) !== 0o700n)) {
    throw new TypeError("transaction staging boundary rejected");
  }
  const stagedHelper = join(stage, "subscription-install-lock.mjs");
  await writeFile(stagedHelper, bytes, { flag: "wx", mode: 0o500 });
  const stagedInfo = await lstat(stagedHelper, { bigint: true });
  if (!stagedInfo.isFile() || stagedInfo.isSymbolicLink() || (expectedStageUid !== undefined && stagedInfo.uid !== expectedStageUid) || (!fixtureFilesystem && (stagedInfo.mode & 0o777n) !== 0o500n) ||
      createHash("sha256").update(await readFile(stagedHelper)).digest("hex") !== expectedDigest) {
    throw new TypeError("transaction staging boundary rejected");
  }
  await handle.close();
  handle = undefined;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [stagedHelper, ...command], { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal === null ? (code ?? 1) : 1));
  });
} catch (error) {
  process.stderr.write(`install-systemd-sandbox: ${error instanceof Error ? error.message : "lock helper bootstrap rejected"}\n`);
  process.exitCode = 1;
} finally {
  await handle?.close();
  await rm(stage, { recursive: true, force: true });
}
' "$LOCK_HELPER" "$LOCK_HELPER_SHA256" "$bootstrap_helper_mode" "$bootstrap_stage" "$([[ "$FIXTURE_MODE" == 1 ]] && printf fixture || id -u)" "$TRANSACTION_LOCK" "$([[ "$FIXTURE_MODE" == 1 ]] && printf fixture || printf root)" bash "$0" "$@"
    exit "$?"
  fi
  [[ "$ARA_TRANSACTION_LOCK_FD" =~ ^[0-9]+$ ]] || fail 'transaction lock descriptor rejected'
  flock -n "$ARA_TRANSACTION_LOCK_FD" || fail 'installation transaction is busy'
fi

declare -a SOURCES=() TARGETS=() MODES=()
for spec in "${ARTIFACTS[@]}"; do
  IFS='|' read -r source_relative target_absolute mode <<<"$spec"
  source="$REPOSITORY_ROOT/$source_relative"
  target="$(root_path "$target_absolute")"
  verify_regular "$source"
  verify_target_parent "$target"
  if [[ -e "$target" || -L "$target" ]]; then verify_installed "$source" "$target" "$mode"; fi
  SOURCES+=("$source") TARGETS+=("$target") MODES+=("$mode")
done
readonly NFT_TARGET="$(root_path /etc/nftables.d/amazon-research-subscription.nft)"
verify_target_parent "$NFT_TARGET"

if [[ "$MODE" == verify ]]; then
  for index in "${!SOURCES[@]}"; do verify_installed "${SOURCES[$index]}" "${TARGETS[$index]}" "${MODES[$index]}"; done
  temporary="$(mktemp)"
  trap 'rm -f -- "$temporary"' EXIT
  node "$PROBE" --mode render-endpoint-policy --authority "$AUTHORITY" --environment "$ENVIRONMENT" >"$temporary"
  verify_installed "$temporary" "$NFT_TARGET" 0444
  [[ "$FIXTURE_MODE" == 1 ]] || nft --check --file "$NFT_TARGET"
  printf 'PASS mode=verify artifacts=%d endpoint_authority=%s production_activation=false\n' "$(( ${#ARTIFACTS[@]} + 2 ))" "$(sha "$AUTHORITY")"
  exit 0
fi

readonly STAGE="$(mktemp -d)"
trap 'rm -rf -- "$STAGE"' EXIT
chmod 0700 "$STAGE"
for index in "${!SOURCES[@]}"; do
  install -m "${MODES[$index]}" -- "${SOURCES[$index]}" "$STAGE/$index"
  verify_installed "${SOURCES[$index]}" "$STAGE/$index" "${MODES[$index]}" staged
done
grep -Fqx '[Service]' "$STAGE/2" || fail 'malformed Codex unit'
grep -Fqx 'Type=notify' "$STAGE/2" || fail 'malformed Codex unit'
grep -Fqx '[Service]' "$STAGE/3" || fail 'malformed Grok unit'
grep -Fqx 'Type=notify' "$STAGE/3" || fail 'malformed Grok unit'
grep -Fqx '[Service]' "$STAGE/4" || fail 'malformed GC service'
grep -Fqx '[Timer]' "$STAGE/5" || fail 'malformed GC timer'
grep -Eq '^On(UnitActive|Calendar)Sec=.+' "$STAGE/5" || fail 'malformed GC timer'
grep -Fq 'polkit.addRule' "$STAGE/6" || fail 'malformed polkit rule'
node "$PROBE" --mode render-endpoint-policy --authority "$AUTHORITY" --environment "$ENVIRONMENT" >"$STAGE/policy.nft"
grep -Eq 'elements = \{[^}]+\}' "$STAGE/policy.nft" || fail 'rendered policy is empty'
if [[ "$FIXTURE_MODE" != 1 && "$MODE" == install ]]; then
  systemd-analyze verify "$STAGE/2" "$STAGE/3" "$STAGE/4" "$STAGE/5"
  nft --check --file "$STAGE/policy.nft"
fi

if [[ "$MODE" == dry-run ]]; then
  printf 'PASS mode=dry-run artifacts=%d authority_sha256=%s rendered_policy_sha256=%s fixture_only=true production_activation=false\n' \
    "$(( ${#ARTIFACTS[@]} + 2 ))" "$(sha "$AUTHORITY")" "$(sha "$STAGE/policy.nft")"
  exit 0
fi

declare -a CREATED_FILES=() ROLLBACK_TOKENS=() CREATED_DIRS=() TEMP_FILES=()
rollback() {
  local path token index current token_identity
  for path in "${TEMP_FILES[@]}"; do rm -f -- "$path"; done
  for ((index=${#CREATED_FILES[@]}-1; index>=0; index--)); do
    path="${CREATED_FILES[$index]}"
    token="${ROLLBACK_TOKENS[$index]}"
    if [[ -f "$token" && ! -L "$token" && -f "$path" && ! -L "$path" ]]; then
      current="$(stat -c '%d:%i' -- "$path")"
      token_identity="$(stat -c '%d:%i' -- "$token")"
      if [[ "$current" == "$token_identity" ]]; then
        verify_publication_parent "$(dirname -- "$path")"
        rm -f -- "$path"
      fi
    fi
    rm -f -- "$token"
  done
  for ((index=${#CREATED_DIRS[@]}-1; index>=0; index--)); do rmdir -- "${CREATED_DIRS[$index]}" 2>/dev/null || true; done
}
ensure_parent() {
  local target="$1" parent missing=() path index
  parent="$(dirname -- "$target")"
  path="$parent"
  while [[ ! -e "$path" && ! -L "$path" ]]; do
    missing+=("$path")
    path="$(dirname -- "$path")"
  done
  [[ -d "$path" && ! -L "$path" && -w "$path" ]] || fail "uncreatable target parent: $parent"
  for ((index=${#missing[@]}-1; index>=0; index--)); do
    path="${missing[$index]}"
    CREATED_DIRS+=("$path")
    install -d -m 0755 -- "$path"
  done
  verify_publication_parent "$parent"
}
publish_absent() {
  local source="$1" target="$2" mode="$3" ordinal="$4" parent temporary token identity
  ensure_parent "$target"
  parent="$(dirname -- "$target")"
  temporary="$(mktemp --tmpdir="$parent" .ara-subscription-install.XXXXXX)"
  TEMP_FILES+=("$temporary")
  [[ "$FIXTURE_FAIL_AT" != "stage-$ordinal" ]] || fail "injected staging failure $ordinal"
  install -m "$mode" -- "$source" "$temporary"
  sync -- "$temporary"
  verify_installed "$source" "$temporary" "$mode" staged
  [[ "$(stat -c %d -- "$temporary")" == "$(stat -c %d -- "$parent")" ]] || fail "cross-filesystem staging rejected: $target"
  [[ "$FIXTURE_FAIL_AT" != "publish-$ordinal" ]] || fail "injected publication failure $ordinal"
  if [[ "$FIXTURE_RACE_AT" == "publish-$ordinal" ]]; then printf 'competitor\n' >"$target"; fi
  ln -- "$temporary" "$target"
  identity="$(stat -c '%d:%i' -- "$temporary")"
  [[ "$(stat -c '%d:%i' -- "$target")" == "$identity" ]] || fail "published inode identity rejected: $target"
  token="$temporary"
  CREATED_FILES+=("$target")
  ROLLBACK_TOKENS+=("$token")
  unset "TEMP_FILES[$((${#TEMP_FILES[@]} - 1))]"
  sync -- "$parent"
  if [[ "$FIXTURE_RACE_AT" == "rollback-$ordinal" ]]; then
    rm -f -- "$target"
    printf 'replacement\n' >"$target"
    fail "injected rollback replacement $ordinal"
  fi
  verify_installed "$source" "$target" "$mode"
}
transaction_exit() {
  local status=$?
  if (( status != 0 )); then rollback; fi
  rm -rf -- "$STAGE"
  if [[ "$MODE" == install ]]; then flock -u "$ARA_TRANSACTION_LOCK_FD" || true; fi
  exit "$status"
}
trap transaction_exit EXIT
for index in "${!SOURCES[@]}"; do
  target="${TARGETS[$index]}"
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    publish_absent "${SOURCES[$index]}" "$target" "${MODES[$index]}" "$index"
  fi
done
if [[ ! -e "$NFT_TARGET" && ! -L "$NFT_TARGET" ]]; then
  publish_absent "$STAGE/policy.nft" "$NFT_TARGET" 0444 nft
else
  verify_installed "$STAGE/policy.nft" "$NFT_TARGET" 0444
fi
for index in "${!SOURCES[@]}"; do verify_installed "${SOURCES[$index]}" "${TARGETS[$index]}" "${MODES[$index]}"; done
verify_installed "$STAGE/policy.nft" "$NFT_TARGET" 0444
for token in "${ROLLBACK_TOKENS[@]}"; do rm -f -- "$token"; done
[[ "$FIXTURE_MODE" == 1 ]] || systemctl daemon-reload
for parent in "$(dirname -- "$NFT_TARGET")" "$(dirname -- "${TARGETS[0]}")" "$(dirname -- "${TARGETS[2]}")"; do sync -- "$parent"; done
trap - EXIT
rm -rf -- "$STAGE"
flock -u "$ARA_TRANSACTION_LOCK_FD"
printf 'PASS mode=install artifacts=%d endpoint_authority=%s production_activation=false\n' "$(( ${#ARTIFACTS[@]} + 2 ))" "$(sha "$AUTHORITY")"
