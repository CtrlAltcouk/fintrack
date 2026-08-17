#!/usr/bin/env bash
# Installs only the fixed Outflow update spool and systemd units.
set -euo pipefail

UPDATE_ROOT=${OUTFLOW_UPDATE_ROOT:-/var/lib/outflow-update}
UNIT_DIR=${OUTFLOW_SYSTEMD_UNIT_DIR:-/etc/systemd/system}
SERVICE_USER=${OUTFLOW_SERVICE_USER:-outflow}
TEST_MODE=${OUTFLOW_TEST_MODE:-0}

if [[ "$TEST_MODE" != 1 ]]; then
  [[ $(id -u) -eq 0 ]] || { printf '[ERROR] update agent installation requires root\n' >&2; exit 1; }
  [[ "$UPDATE_ROOT" == /var/lib/outflow-update && "$UNIT_DIR" == /etc/systemd/system \
     && "$SERVICE_USER" == outflow ]] \
    || { printf '[ERROR] update agent uses fixed production paths\n' >&2; exit 1; }
fi

for managed_path in "$UPDATE_ROOT" "$UPDATE_ROOT/request" "$UPDATE_ROOT/state"; do
  [[ ! -L "$managed_path" ]] \
    || { printf '[ERROR] refusing symlinked update control path: %s\n' "$managed_path" >&2; exit 1; }
done
mkdir -p -- "$UPDATE_ROOT/request" "$UPDATE_ROOT/state" "$UNIT_DIR"
chown root:root "$UPDATE_ROOT" 2>/dev/null || [[ "$TEST_MODE" == 1 ]]
chmod 755 "$UPDATE_ROOT"
chown root:"$SERVICE_USER" "$UPDATE_ROOT/request" 2>/dev/null || [[ "$TEST_MODE" == 1 ]]
chmod 730 "$UPDATE_ROOT/request"
chown root:"$SERVICE_USER" "$UPDATE_ROOT/state" 2>/dev/null || [[ "$TEST_MODE" == 1 ]]
chmod 750 "$UPDATE_ROOT/state"

for unit_file in "$UNIT_DIR/outflow-update.path" "$UNIT_DIR/outflow-update.service"; do
  if [[ -e "$unit_file" || -L "$unit_file" ]]; then
    [[ -f "$unit_file" && ! -L "$unit_file" && $(stat -c '%h' "$unit_file") == 1 ]] \
      || { printf '[ERROR] refusing unsafe existing update unit: %s\n' "$unit_file" >&2; exit 1; }
  fi
done

cat > "$UNIT_DIR/outflow-update.path" <<'UNIT'
[Unit]
Description=Watch for a validated Outflow update request

[Path]
PathExists=/var/lib/outflow-update/request/request.json
Unit=outflow-update.service

[Install]
WantedBy=multi-user.target
UNIT

cat > "$UNIT_DIR/outflow-update.service" <<'UNIT'
[Unit]
Description=Install one pinned Outflow release
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=/opt/outflow/app/scripts/update-agent.sh
UMask=0077
Environment=NPM_CONFIG_CACHE=/var/lib/outflow-update/state/npm-cache
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
NoNewPrivileges=true
LockPersonality=true
RestrictSUIDSGID=true
ReadWritePaths=/opt/outflow /var/lib/outflow /var/lib/outflow-update /run/lock
StandardOutput=journal
StandardError=journal
SyslogIdentifier=outflow-update
UNIT

if [[ "$TEST_MODE" != 1 ]]; then
  chmod 644 "$UNIT_DIR/outflow-update.path" "$UNIT_DIR/outflow-update.service"
  systemctl daemon-reload
  systemctl enable --now outflow-update.path
fi
