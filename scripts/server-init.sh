#!/usr/bin/env bash
# =============================================================================
# server-init.sh — Run this ONCE on a fresh Hostinger KVM VPS
# Usage: curl -sL https://raw.githubusercontent.com/dawei7/dawei7/main/scripts/server-init.sh | bash
# =============================================================================
set -euo pipefail

COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RESET='\033[0m'

info()    { echo -e "${COLOR_GREEN}[INFO]${COLOR_RESET} $1"; }
warning() { echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $1"; }

# ─── 1. SYSTEM UPDATE ─────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

apt-get install -y -qq \
  curl wget git ufw fail2ban \
  ca-certificates gnupg lsb-release \
  apache2-utils    # for htpasswd (Traefik dashboard auth)

# ─── 2. DOCKER ────────────────────────────────────────────────────────────────
# Hostinger KVM 4 comes with Docker pre-installed — skip if already present
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  info "Docker already installed: $(docker --version)"
fi

# ─── 2b. STOP HOSTINGER PRE-INSTALLED TRAEFIK ─────────────────────────────────
# Hostinger's Docker+Traefik template runs its own Traefik on ports 80/443.
# We must stop it before starting ours, otherwise ports will conflict.
info "Stopping any pre-installed Traefik containers..."
if docker ps -q --filter "name=traefik" | grep -q .; then
  docker stop traefik 2>/dev/null || true
  docker rm traefik   2>/dev/null || true
  info "Pre-installed Traefik stopped and removed."
fi
# Also stop anything else bound to ports 80 / 443
for cid in $(docker ps -q); do
  ports=$(docker port "$cid" 2>/dev/null || true)
  if echo "$ports" | grep -qE '0\.0\.0\.0:(80|443)->'; then
    warning "Stopping container $cid (occupying port 80/443)..."
    docker stop "$cid" 2>/dev/null || true
  fi
done
# Disable Hostinger's docker-compose auto-start if it exists
if [ -f /root/docker-compose.yml ] || [ -f /root/docker-compose.yaml ]; then
  warning "Found docker-compose in /root — renaming to avoid auto-start conflicts."
  mv /root/docker-compose.yml /root/docker-compose.yml.hostinger-backup 2>/dev/null || true
  mv /root/docker-compose.yaml /root/docker-compose.yaml.hostinger-backup 2>/dev/null || true
fi

# ─── 3. DOCKER PROXY NETWORK ──────────────────────────────────────────────────
info "Creating shared proxy network..."
docker network create proxy 2>/dev/null || info "Network 'proxy' already exists, skipping."

# ─── 4. CLONE SERVER REPO ─────────────────────────────────────────────────────
info "Cloning server repository..."
mkdir -p /opt/server
# If already exists, just pull
if [ -d "/opt/server/.git" ]; then
  cd /opt/server && git pull
else
  # Replace with your actual repo URL
  git clone https://github.com/dawei7/dawei7.git /opt/server
fi
cd /opt/server

# ─── 5. ENV FILE ──────────────────────────────────────────────────────────────
if [ ! -f "/opt/server/.env" ]; then
  cp .env.example .env
  warning "Created .env from .env.example — EDIT IT NOW before continuing!"
  warning "Run: nano /opt/server/.env"
  exit 1
fi

# ─── 6. TRAEFIK ACME FILE ─────────────────────────────────────────────────────
info "Setting up Traefik acme.json..."
touch /opt/server/traefik/acme.json
chmod 600 /opt/server/traefik/acme.json   # REQUIRED by Traefik

# ─── 7. FIREWALL ──────────────────────────────────────────────────────────────
info "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp    # HTTP/3 QUIC
ufw --force enable
ufw status

# ─── 8. FAIL2BAN ──────────────────────────────────────────────────────────────
info "Enabling fail2ban (SSH brute-force protection)..."
systemctl enable fail2ban
systemctl start fail2ban

# ─── 9. SSH HARDENING (optional) ──────────────────────────────────────────────
# Disable password auth — key auth only
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload sshd
warning "SSH password auth disabled. Ensure your SSH key is set up before closing this session!"

# ─── 10. START STACK ──────────────────────────────────────────────────────────
info "Starting Docker stack..."
cd /opt/server
docker compose pull
docker compose up -d

# ─── DONE ─────────────────────────────────────────────────────────────────────
info ""
info "==========================================="
info " Server initialized successfully!"
info "==========================================="
info " Traefik dashboard: https://traefik.dawei7.com"
info " Website:           https://dawei7.com"
info ""
info " Add GitHub Actions secrets:"
info "   VPS_HOST = $(curl -s ifconfig.me)"
info "   VPS_USER = root  (or your user)"
info "   VPS_SSH_KEY = <your private key>"
info "==========================================="
