#!/usr/bin/env bash
# =============================================================================
# setup-runner.sh — Install GitHub Actions self-hosted runner on the VPS
#
# Usage:
#   1. Get a token from:
#      https://github.com/dawei7/dawei7/settings/actions/runners/new
#   2. Run: bash setup-runner.sh <REGISTRATION_TOKEN>
# =============================================================================
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <REGISTRATION_TOKEN>"
  echo "Get token from: https://github.com/dawei7/dawei7/settings/actions/runners/new"
  exit 1
fi

REPO_URL="https://github.com/dawei7/dawei7"
RUNNER_DIR="/opt/actions-runner"
RUNNER_USER="runner"

# ── Create a dedicated user ────────────────────────────────────────────────────
if ! id "$RUNNER_USER" &>/dev/null; then
  useradd --system --shell /bin/bash --home "$RUNNER_DIR" --create-home "$RUNNER_USER"
fi
# Allow runner to run docker commands
usermod -aG docker "$RUNNER_USER"

# ── Download latest runner ─────────────────────────────────────────────────────
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

LATEST=$(curl -s https://api.github.com/repos/actions/runner/releases/latest \
  | grep '"tag_name"' | cut -d'"' -f4 | sed 's/v//')

ARCHIVE="actions-runner-linux-x64-${LATEST}.tar.gz"
curl -sLO "https://github.com/actions/runner/releases/download/v${LATEST}/${ARCHIVE}"
tar xzf "$ARCHIVE" && rm "$ARCHIVE"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"

# ── Configure ─────────────────────────────────────────────────────────────────
sudo -u "$RUNNER_USER" ./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$(hostname)" \
  --labels "self-hosted,linux,x64" \
  --runnergroup "Default" \
  --unattended \
  --replace

# ── Install & start as a systemd service ──────────────────────────────────────
./svc.sh install "$RUNNER_USER"
./svc.sh start

echo ""
echo "✓ Runner installed and running as systemd service."
echo "  Status: sudo systemctl status actions.runner.*.service"
