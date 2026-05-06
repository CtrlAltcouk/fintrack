#!/usr/bin/env bash
# FinTrack — update script
# Run on your Proxmox HOST shell to update a running container:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/update.sh)"

set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

command -v pct &>/dev/null || die "This script must be run on a Proxmox VE host."

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║      FinTrack — Updater              ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

read -rp "$(echo -e "${BOLD}Container ID${RESET} [104]: ")" CTID
CTID="${CTID:-104}"

pct status "$CTID" &>/dev/null || die "Container $CTID not found."
[[ "$(pct status "$CTID")" == *"running"* ]] || die "Container $CTID is not running."

info "Pulling latest code..."
pct exec "$CTID" -- bash -c "cd /opt/fintrack && git pull origin main" || die "git pull failed."

info "Installing any new dependencies..."
pct exec "$CTID" -- bash -c "cd /opt/fintrack && npm install --omit=dev --silent"

info "Restarting app..."
pct exec "$CTID" -- bash -c "pm2 restart fintrack" || die "pm2 restart failed."

sleep 2
STATUS=$(pct exec "$CTID" -- bash -c "pm2 jlist" | grep -o '"status":"[^"]*"' | head -1)

echo ""
success "FinTrack updated and restarted."
CT_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
echo -e "  App is live at: ${BOLD}http://${CT_IP}:3000${RESET}"
echo ""
