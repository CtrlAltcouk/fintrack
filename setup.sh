#!/usr/bin/env bash
# Safe first-time Outflow installation for Debian 12.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/scripts/deploy-lib.sh"

APP_ROOT=${OUTFLOW_APP_ROOT:-/opt/outflow}
RELEASES_DIR=${OUTFLOW_RELEASES_DIR:-$APP_ROOT/releases}
APP_LINK=${OUTFLOW_APP_LINK:-$APP_ROOT/app}
DATA_DIR=${OUTFLOW_DATA_DIR:-/var/lib/outflow}
BACKUP_DIR=${OUTFLOW_BACKUP_DIR:-$DATA_DIR/backups}
CONFIG_DIR=${OUTFLOW_CONFIG_DIR:-/etc/outflow}
CONFIG_FILE=${OUTFLOW_CONFIG_FILE:-$CONFIG_DIR/outflow.env}
LOG_DIR=${OUTFLOW_LOG_DIR:-/var/log/outflow}
LEGACY_ROOT=${OUTFLOW_LEGACY_ROOT:-/opt/fintrack}
SERVICE_USER=${OUTFLOW_SERVICE_USER:-outflow}
REPO_URL=${OUTFLOW_REPOSITORY_URL:-https://github.com/CtrlAltcouk/fintrack.git}
RELEASE_REF=${OUTFLOW_RELEASE_REF:-${1:-}}
TEST_MODE=${OUTFLOW_TEST_MODE:-0}
FAIL_AT=${OUTFLOW_TEST_FAIL_AT:-}
DEFER_START=${OUTFLOW_DEFER_START:-0}

outflow_validate_release_ref "$RELEASE_REF"
APP_ROOT=$(outflow_validate_absolute_path "$APP_ROOT")
RELEASES_DIR=$(outflow_validate_absolute_path "$RELEASES_DIR" "$APP_ROOT")
DATA_DIR=$(outflow_validate_absolute_path "$DATA_DIR")
BACKUP_DIR=$(outflow_validate_absolute_path "$BACKUP_DIR" "$DATA_DIR")
CONFIG_DIR=$(outflow_validate_absolute_path "$CONFIG_DIR")
LOG_DIR=$(outflow_validate_absolute_path "$LOG_DIR")
LEGACY_ROOT=$(outflow_validate_absolute_path "$LEGACY_ROOT")
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$APP_ROOT" == /opt/outflow && "$DATA_DIR" == /var/lib/outflow \
     && "$CONFIG_DIR" == /etc/outflow && "$LOG_DIR" == /var/log/outflow \
     && "$SERVICE_USER" == outflow ]] \
    || outflow_die 'Production setup uses the documented /opt, /var/lib, /etc and /var/log Outflow layout.'
fi

layout=$(outflow_detect_layout "$APP_ROOT" "$DATA_DIR" "$CONFIG_DIR" "$LEGACY_ROOT")
case "$layout" in
  conflict) outflow_die 'Both legacy FinTrack and Outflow data were detected. Nothing was changed. Follow RELEASE.md.' ;;
  legacy) outflow_die "Legacy FinTrack data was detected beneath $LEGACY_ROOT. Nothing was changed and no empty Outflow database was created. Follow RELEASE.md." ;;
  existing) outflow_die 'An existing Outflow installation was detected. Setup is first-install only and changed nothing. Use update.sh with a pinned release.' ;;
esac
for candidate in "$APP_ROOT" "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"; do
  [[ ! -e "$candidate" ]] || outflow_die "Refusing unexpected pre-existing path without an installation marker: $candidate"
done

if [[ "$TEST_MODE" != 1 ]]; then
  [[ $(id -u) -eq 0 ]] || outflow_die 'setup.sh must run as root'
  apt-get update -qq
  apt-get install -y -qq curl git ca-certificates
  if ! command -v node >/dev/null || [[ $(node -p 'Number(process.versions.node.split(`.`)[0])') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  fi
  id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p -- "$RELEASES_DIR" "$DATA_DIR" "$BACKUP_DIR" "$CONFIG_DIR" "$LOG_DIR"
chmod 750 "$APP_ROOT" "$RELEASES_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR" "$CONFIG_DIR" "$LOG_DIR"
db_path="$DATA_DIR/outflow.db"
outflow_verify_database_path "$db_path" "$DATA_DIR" "$APP_ROOT" >/dev/null
outflow_write_config "$CONFIG_FILE" "$db_path" "$APP_LINK"

install_complete=0
cleanup_install() {
  if (( ! install_complete )); then
    rm -f -- "$CONFIG_FILE"
    rmdir -- "$BACKUP_DIR" "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR" 2>/dev/null || true
    rmdir -- "$RELEASES_DIR" "$APP_ROOT" 2>/dev/null || true
  fi
}
trap cleanup_install EXIT

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
stage="$RELEASES_DIR/.staging-$timestamp-$$"
mkdir -p -- "$stage"
touch "$stage/.outflow-staging"
cleanup_stage() { [[ ! -d "$stage" ]] || outflow_safe_remove_staging "$stage" "$RELEASES_DIR"; }
trap 'cleanup_stage; cleanup_install' EXIT

if [[ "$TEST_MODE" == 1 ]]; then
  [[ -n ${OUTFLOW_STAGE_SOURCE:-} ]] || outflow_die 'OUTFLOW_STAGE_SOURCE is required in test mode'
  cp -a -- "$OUTFLOW_STAGE_SOURCE/." "$stage/"
else
  git clone --no-checkout --filter=blob:none "$REPO_URL" "$stage/repository"
  git -C "$stage/repository" checkout --detach "$RELEASE_REF"
  resolved_commit=$(git -C "$stage/repository" rev-parse HEAD)
  if [[ "$RELEASE_REF" =~ ^[0-9a-fA-F]{40}$ && "${resolved_commit,,}" != "${RELEASE_REF,,}" ]]; then
    outflow_die 'Resolved commit does not match requested commit'
  fi
  find "$stage/repository" -mindepth 1 -maxdepth 1 -exec mv -t "$stage" -- {} +
  rmdir "$stage/repository"
fi
[[ -f "$stage/package.json" && -f "$stage/package-lock.json" && -f "$stage/server.js" ]] \
  || outflow_die 'Staged release is missing required application files'
[[ "$FAIL_AT" != after_staging ]] || outflow_die 'Simulated failure after staging'
if [[ "$TEST_MODE" != 1 ]]; then
  (cd "$stage" && npm ci --omit=dev)
  outflow_verify_release_metadata "$stage" "$RELEASE_REF"
  (cd "$stage" && node scripts/verify-syntax.js)
fi

release_name=${RELEASE_REF//[^0-9A-Za-z._-]/-}-$timestamp
release_dir="$RELEASES_DIR/$release_name"
touch "$stage/.outflow-installation"
mv -- "$stage" "$release_dir"
rm -f -- "$release_dir/.outflow-staging"
outflow_atomic_link "$release_dir" "$APP_LINK"
touch "$APP_ROOT/.outflow-installation"
install_complete=1

if [[ "$TEST_MODE" != 1 ]]; then
  chown -R root:"$SERVICE_USER" "$APP_ROOT"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$LOG_DIR"
  chown root:"$SERVICE_USER" "$CONFIG_DIR"
  chmod 750 "$CONFIG_DIR"
  chown root:"$SERVICE_USER" "$CONFIG_FILE"
  chmod 640 "$CONFIG_FILE"
  cat > /etc/systemd/system/outflow.service <<'UNIT'
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
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/var/lib/outflow /var/log/outflow
StandardOutput=journal
StandardError=journal
SyslogIdentifier=outflow

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  if [[ "$DEFER_START" == 1 ]]; then systemctl enable outflow
  else systemctl enable --now outflow; fi
fi
trap - EXIT
outflow_info "Outflow installed. Code: $APP_LINK; data: $DATA_DIR; database: $db_path"
outflow_info 'Re-running setup exits without changes. Use update.sh for pinned releases.'
