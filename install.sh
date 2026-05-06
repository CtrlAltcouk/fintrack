#!/usr/bin/env bash
# FinTrack — Proxmox LXC installer
# Run this on your Proxmox HOST shell:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/install.sh)"

set -euo pipefail

#───────────────────────────────────────────────
# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

#───────────────────────────────────────────────
# Check we're on Proxmox host
command -v pct &>/dev/null || die "This script must be run on a Proxmox VE host."
command -v pvesm &>/dev/null || die "Proxmox storage manager not found."

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║      FinTrack — LXC Installer        ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

#───────────────────────────────────────────────
# Defaults / prompts
CTID="${1:-}"
if [[ -z "$CTID" ]]; then
  NEXT_ID=$(pvesh get /cluster/nextid 2>/dev/null || echo 200)
  read -rp "$(echo -e "${BOLD}Container ID${RESET} [${NEXT_ID}]: ")" CTID
  CTID="${CTID:-$NEXT_ID}"
fi

read -rp "$(echo -e "${BOLD}Hostname${RESET} [fintrack]: ")" HOSTNAME
HOSTNAME="${HOSTNAME:-fintrack}"

read -rsp "$(echo -e "${BOLD}Root password${RESET}: ")" ROOT_PASS; echo
[[ -z "$ROOT_PASS" ]] && die "Password cannot be empty."

read -rp "$(echo -e "${BOLD}Static IP (e.g. 192.168.1.50/24) or 'dhcp'${RESET} [dhcp]: ")" CT_IP
CT_IP="${CT_IP:-dhcp}"

if [[ "$CT_IP" != "dhcp" ]]; then
  read -rp "$(echo -e "${BOLD}Gateway IP${RESET} [192.168.1.1]: ")" CT_GW
  CT_GW="${CT_GW:-192.168.1.1}"
  NET_CONFIG="ip=${CT_IP},gw=${CT_GW}"
else
  NET_CONFIG="ip=dhcp"
fi

read -rp "$(echo -e "${BOLD}RAM (MB)${RESET} [512]: ")" CT_RAM
CT_RAM="${CT_RAM:-512}"

read -rp "$(echo -e "${BOLD}Disk size (GB)${RESET} [4]: ")" CT_DISK
CT_DISK="${CT_DISK:-4}"

read -rp "$(echo -e "${BOLD}Storage pool${RESET} [local-lvm]: ")" CT_STORAGE
CT_STORAGE="${CT_STORAGE:-local-lvm}"

read -rp "$(echo -e "${BOLD}Bridge${RESET} [vmbr0]: ")" CT_BRIDGE
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"

echo ""
info "Container ID:  $CTID"
info "Hostname:      $HOSTNAME"
info "IP:            $CT_IP"
info "RAM:           ${CT_RAM}MB"
info "Disk:          ${CT_DISK}GB on $CT_STORAGE"
echo ""
read -rp "$(echo -e "${BOLD}Proceed? [y/N]:${RESET} ")" CONFIRM
[[ "${CONFIRM,,}" == "y" ]] || { echo "Aborted."; exit 0; }

#───────────────────────────────────────────────
# Download Debian 12 template if needed
TEMPLATE_STORAGE=$(pvesm status -content vztmpl | awk 'NR>1{print $1; exit}')
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep "debian-12" | tail -1 | awk '{print $1}')

if [[ -z "$TEMPLATE" ]]; then
  info "Downloading Debian 12 template..."
  pveam update &>/dev/null
  TEMPLATE_NAME=$(pveam available --section system | grep "debian-12" | tail -1 | awk '{print $2}')
  [[ -z "$TEMPLATE_NAME" ]] && die "Could not find Debian 12 template. Download manually in Proxmox UI."
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME" &>/dev/null
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
  success "Template downloaded."
else
  success "Found template: $TEMPLATE"
fi

#───────────────────────────────────────────────
# Create container
info "Creating LXC container $CTID..."
pct create "$CTID" "$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --password "$ROOT_PASS" \
  --cores 1 \
  --memory "$CT_RAM" \
  --rootfs "${CT_STORAGE}:${CT_DISK}" \
  --net0 "name=eth0,bridge=${CT_BRIDGE},firewall=1,${NET_CONFIG}" \
  --features nesting=1 \
  --unprivileged 1 \
  --start 1 \
  --onboot 1 \
  --description "FinTrack personal finance tracker" \
  2>&1 | tail -1

success "Container $CTID created and started."

# Wait for network
info "Waiting for container to come up..."
sleep 8

#───────────────────────────────────────────────
# Run the app installer inside the container
info "Installing FinTrack inside container $CTID..."
pct exec "$CTID" -- bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/setup.sh)" 2>&1

#───────────────────────────────────────────────
# Done
echo ""
CT_FINAL_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  FinTrack installed successfully!            ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Open in your browser: ${BOLD}http://${CT_FINAL_IP}:3000${RESET}"
echo ""
