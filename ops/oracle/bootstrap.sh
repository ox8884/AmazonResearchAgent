#!/usr/bin/env bash
set -euo pipefail

arch="$(uname -m)"
if [[ "${arch}" != "aarch64" && "${arch}" != "arm64" ]]; then
  echo "This bootstrap supports ARM64/aarch64 only (got ${arch})." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 LTS through the distro-supported method before continuing." >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@11.24.0 --activate

if ! id -u amazon-research >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /opt/amazon-research --shell /usr/sbin/nologin amazon-research
fi

mkdir -p /opt/amazon-research/current /etc/amazon-research
chown -R amazon-research:amazon-research /opt/amazon-research
chmod 0750 /etc/amazon-research

if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

echo "Bootstrap complete. Populate /etc/amazon-research/worker.env with variable names only; never write secret values into this script."
