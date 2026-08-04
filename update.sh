#!/usr/bin/env bash
# Proxmox host wrapper for the safe, pinned Outflow release updater.
set -euo pipefail

die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
command -v pct >/dev/null 2>&1 || die 'This script must run on a Proxmox VE host.'
CTID=${1:-}
RELEASE_REF=${2:-}
[[ -n "$CTID" ]] || die 'Usage: update.sh <container-id> <vX.Y.Z|40-character-commit>'
[[ "$RELEASE_REF" =~ ^[0-9a-fA-F]{40}$ || "$RELEASE_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die 'A pinned semantic version tag or full 40-character commit SHA is required.'
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID not found."
[[ $(pct status "$CTID") == *running* ]] || die "Container $CTID is not running."
pct exec "$CTID" -- test -f /opt/outflow/app/scripts/deploy-update.sh \
  || die 'Managed Outflow deployment not found. Follow RELEASE.md for legacy migration.'
pct exec "$CTID" -- bash /opt/outflow/app/scripts/deploy-update.sh "$RELEASE_REF" \
  || die 'Update failed; the previous release and persistent data were retained or restored.'
printf '[OK] Outflow %s deployed in container %s.\n' "$RELEASE_REF" "$CTID"
