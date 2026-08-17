#!/usr/bin/env bash
# Installs the fixed Outflow application systemd unit without touching local drop-ins.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/deploy-lib.sh"

UNIT_DIR=${OUTFLOW_SYSTEMD_UNIT_DIR:-/etc/systemd/system}
SERVICE_USER=${OUTFLOW_SERVICE_USER:-outflow}
TEST_MODE=${OUTFLOW_TEST_MODE:-0}
DEFER_START=${OUTFLOW_DEFER_START:-0}
SYSTEMD_PROFILE=$(outflow_detect_systemd_profile "${OUTFLOW_SYSTEMD_PROFILE:-auto}")
UNIT_FILE="$UNIT_DIR/outflow.service"

if [[ "$TEST_MODE" != 1 ]]; then
  [[ $(id -u) -eq 0 ]] || { printf '[ERROR] application service installation requires root\n' >&2; exit 1; }
  [[ "$UNIT_DIR" == /etc/systemd/system && "$SERVICE_USER" == outflow ]] \
    || { printf '[ERROR] application service uses fixed production paths\n' >&2; exit 1; }
  [[ -f /opt/outflow/app/.outflow-installation && -f /etc/outflow/outflow.env ]] \
    || { printf '[ERROR] no managed Outflow installation is available\n' >&2; exit 1; }
fi

mkdir -p -- "$UNIT_DIR"
if [[ -e "$UNIT_FILE" || -L "$UNIT_FILE" ]]; then
  [[ -f "$UNIT_FILE" && ! -L "$UNIT_FILE" && $(stat -c '%h' "$UNIT_FILE") == 1 ]] \
    || { printf '[ERROR] refusing unsafe existing application unit: %s\n' "$UNIT_FILE" >&2; exit 1; }
fi

cat > "$UNIT_FILE" <<'UNIT'
[Unit]
Description=Outflow personal finance tracker
After=network.target

[Service]
Type=simple
User=outflow
Group=outflow
WorkingDirectory=/opt/outflow/app
EnvironmentFile=/etc/outflow/outflow.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
RestrictSUIDSGID=true
LockPersonality=true
UNIT
outflow_append_namespace_hardening "$SYSTEMD_PROFILE" strict '/var/lib/outflow /var/log/outflow' \
  >> "$UNIT_FILE"
cat >> "$UNIT_FILE" <<UNIT
# OutflowSystemdProfile=$SYSTEMD_PROFILE
StandardOutput=journal
StandardError=journal
SyslogIdentifier=outflow

[Install]
WantedBy=multi-user.target
UNIT

if [[ "$TEST_MODE" != 1 ]]; then
  chmod 644 "$UNIT_FILE"
  systemctl daemon-reload
  if [[ "$DEFER_START" == 1 ]]; then systemctl enable outflow
  else systemctl enable --now outflow; fi
fi
