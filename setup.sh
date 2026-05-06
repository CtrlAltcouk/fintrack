#!/usr/bin/env bash
# FinTrack — container setup script
# Runs INSIDE the Debian 12 LXC container.
# Called automatically by install.sh, or run manually:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/setup.sh)"

set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }

#───────────────────────────────────────────────
info "Updating packages..."
apt-get update -qq
apt-get install -y -qq curl git 2>/dev/null
success "Base packages ready."

#───────────────────────────────────────────────
info "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
apt-get install -y -qq nodejs 2>/dev/null
success "Node $(node -v) installed."

#───────────────────────────────────────────────
info "Cloning FinTrack..."
rm -rf /opt/fintrack
git clone --depth=1 https://github.com/CtrlAltcouk/fintrack.git /opt/fintrack &>/dev/null
success "Repository cloned."

#───────────────────────────────────────────────
info "Installing dependencies..."
cd /opt/fintrack
npm install --omit=dev --silent
success "npm packages installed."

#───────────────────────────────────────────────
info "Setting up pm2..."
npm install -g pm2 --silent
pm2 start server.js --name fintrack
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true
pm2 save --force &>/dev/null
success "pm2 configured (survives reboots)."

#───────────────────────────────────────────────
success "FinTrack is running on port 3000."
