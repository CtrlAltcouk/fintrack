#!/usr/bin/env bash
# Outflow Proxmox LXC installer. Run on the Proxmox host.
set -euo pipefail

die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '[INFO] %s\n' "$*"; }
command -v pct >/dev/null 2>&1 || die 'This script must run on a Proxmox VE host.'
command -v pvesm >/dev/null 2>&1 || die 'Proxmox storage manager not found.'

CTID=${1:-}
RELEASE_REF=${2:-}
if [[ -z "$CTID" ]]; then
  NEXT_ID=$(pvesh get /cluster/nextid 2>/dev/null || printf '200')
  read -rp "Container ID [$NEXT_ID]: " CTID
  CTID=${CTID:-$NEXT_ID}
fi
if [[ -z "$RELEASE_REF" ]]; then
  read -rp 'Pinned release (vX.Y.Z or full 40-character commit SHA): ' RELEASE_REF
fi
[[ "$RELEASE_REF" =~ ^[0-9a-fA-F]{40}$ || "$RELEASE_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die 'A pinned semantic version tag or full commit SHA is required.'
if pct status "$CTID" >/dev/null 2>&1; then
  die "Container $CTID already exists. Nothing was changed. Choose a new ID or use update.sh for an existing Outflow container."
fi

read -rp 'Hostname [outflow]: ' HOSTNAME
HOSTNAME=${HOSTNAME:-outflow}
read -rsp 'Root password: ' ROOT_PASS; printf '\n'
[[ -n "$ROOT_PASS" ]] || die 'Password cannot be empty.'
read -rp "Static IP with prefix, or 'dhcp' [dhcp]: " CT_IP
CT_IP=${CT_IP:-dhcp}
if [[ "$CT_IP" == dhcp ]]; then NET_CONFIG='ip=dhcp'
else
  read -rp 'Gateway IP [192.168.1.1]: ' CT_GW
  CT_GW=${CT_GW:-192.168.1.1}
  NET_CONFIG="ip=$CT_IP,gw=$CT_GW"
fi
read -rp 'RAM (MB) [512]: ' CT_RAM; CT_RAM=${CT_RAM:-512}
read -rp 'Disk size (GB) [4]: ' CT_DISK; CT_DISK=${CT_DISK:-4}
read -rp 'Storage pool [local-lvm]: ' CT_STORAGE; CT_STORAGE=${CT_STORAGE:-local-lvm}
read -rp 'Bridge [vmbr0]: ' CT_BRIDGE; CT_BRIDGE=${CT_BRIDGE:-vmbr0}
read -rp 'Proceed? [y/N]: ' CONFIRM
[[ ${CONFIRM,,} == y ]] || { printf 'Aborted.\n'; exit 0; }

TEMPLATE_STORAGE=$(pvesm status -content vztmpl | awk 'NR>1{print $1; exit}')
TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-local}
TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep 'debian-12' | tail -1 | awk '{print $1}')
if [[ -z "$TEMPLATE" ]]; then
  pveam update >/dev/null
  TEMPLATE_NAME=$(pveam available --section system | grep 'debian-12' | tail -1 | awk '{print $2}')
  [[ -n "$TEMPLATE_NAME" ]] || die 'Could not find a Debian 12 template.'
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME" >/dev/null
  TEMPLATE="$TEMPLATE_STORAGE:vztmpl/$TEMPLATE_NAME"
fi

NET_OPTS="name=eth0,bridge=$CT_BRIDGE,$NET_CONFIG"
pct create "$CTID" "$TEMPLATE" --hostname "$HOSTNAME" --password "$ROOT_PASS" \
  --cores 1 --memory "$CT_RAM" --rootfs "$CT_STORAGE:$CT_DISK" \
  --net0 "$NET_OPTS" --onboot 1
pct start "$CTID"
sleep 10

STAGE_DIR=$(mktemp -d)
cleanup() {
  [[ ! -d "$STAGE_DIR" ]] || { find "$STAGE_DIR" -depth -mindepth 1 -delete; rmdir "$STAGE_DIR"; }
}
trap cleanup EXIT
git clone --no-checkout --filter=blob:none https://github.com/CtrlAltcouk/fintrack.git "$STAGE_DIR/repository" >/dev/null 2>&1 \
  || die 'Could not fetch the Outflow repository.'
git -C "$STAGE_DIR/repository" checkout --detach "$RELEASE_REF" >/dev/null 2>&1 \
  || die "Could not resolve pinned release $RELEASE_REF."
RESOLVED_COMMIT=$(git -C "$STAGE_DIR/repository" rev-parse HEAD)
if [[ "$RELEASE_REF" =~ ^[0-9a-fA-F]{40}$ && "${RESOLVED_COMMIT,,}" != "${RELEASE_REF,,}" ]]; then
  die 'Resolved commit does not match the requested commit.'
fi
CONTAINER_STAGE=$(pct exec "$CTID" -- mktemp -d /tmp/outflow-installer.XXXXXX)
[[ "$CONTAINER_STAGE" == /tmp/outflow-installer.* ]] || die 'Container returned an unsafe temporary path.'
tar -C "$STAGE_DIR/repository" -cf - setup.sh scripts/deploy-lib.sh \
  | pct exec "$CTID" -- tar -C "$CONTAINER_STAGE" -xf -
pct exec "$CTID" -- env OUTFLOW_RELEASE_REF="$RELEASE_REF" bash "$CONTAINER_STAGE/setup.sh"
pct exec "$CTID" -- find "$CONTAINER_STAGE" -depth -mindepth 1 -delete
pct exec "$CTID" -- rmdir "$CONTAINER_STAGE"

CT_FINAL_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
info "Outflow installed from $RELEASE_REF at http://$CT_FINAL_IP:3000"
