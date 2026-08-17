#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/deploy-lib.sh"

APP_ROOT=${OUTFLOW_APP_ROOT:-/opt/outflow}
RELEASES_DIR=${OUTFLOW_RELEASES_DIR:-$APP_ROOT/releases}
APP_LINK=${OUTFLOW_APP_LINK:-$APP_ROOT/app}
DATA_DIR=${OUTFLOW_DATA_DIR:-/var/lib/outflow}
BACKUP_DIR=${OUTFLOW_BACKUP_DIR:-$DATA_DIR/backups}
CONFIG_FILE=${OUTFLOW_CONFIG_FILE:-/etc/outflow/outflow.env}
REPO_URL=${OUTFLOW_REPOSITORY_URL:-https://github.com/CtrlAltcouk/fintrack.git}
RELEASE_REF=${1:-${OUTFLOW_RELEASE_REF:-}}
TEST_MODE=${OUTFLOW_TEST_MODE:-0}
FAIL_AT=${OUTFLOW_TEST_FAIL_AT:-}

outflow_validate_release_ref "$RELEASE_REF"
APP_ROOT=$(outflow_validate_absolute_path "$APP_ROOT")
RELEASES_DIR=$(outflow_validate_absolute_path "$RELEASES_DIR" "$APP_ROOT")
DATA_DIR=$(outflow_validate_absolute_path "$DATA_DIR")
BACKUP_DIR=$(outflow_validate_absolute_path "$BACKUP_DIR" "$DATA_DIR")
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$APP_ROOT" == /opt/outflow && "$RELEASES_DIR" == /opt/outflow/releases \
     && "$APP_LINK" == /opt/outflow/app && "$DATA_DIR" == /var/lib/outflow \
     && "$BACKUP_DIR" == /var/lib/outflow/backups && "$CONFIG_FILE" == /etc/outflow/outflow.env \
     && "$REPO_URL" == https://github.com/CtrlAltcouk/fintrack.git ]] \
    || outflow_die 'Production updates require the documented Outflow deployment layout.'
fi
[[ -f "$APP_LINK/.outflow-installation" ]] || outflow_die "No managed Outflow installation at $APP_LINK"
[[ -f "$CONFIG_FILE" ]] || outflow_die "Missing Outflow configuration: $CONFIG_FILE"
if [[ "$TEST_MODE" != 1 ]]; then [[ -L "$APP_LINK" ]] || outflow_die 'Active application path is not a managed release symlink'; fi
previous_target=$(readlink -f -- "$APP_LINK")
previous_target=$(outflow_validate_absolute_path "$previous_target" "$RELEASES_DIR")
[[ -f "$previous_target/.outflow-installation" ]] || outflow_die 'Active release is missing its Outflow marker'

set -a
source "$CONFIG_FILE"
set +a
DB_PATH=${OUTFLOW_DB_PATH:-${FINTRACK_DB_PATH:-}}
DB_PATH=$(outflow_verify_database_path "$DB_PATH" "$DATA_DIR" "$APP_ROOT")
APP_PORT=${PORT:-3000}
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || outflow_die 'Configured PORT must be an integer between 1 and 65535'
(( APP_PORT >= 1 && APP_PORT <= 65535 )) || outflow_die 'Configured PORT must be an integer between 1 and 65535'
[[ -s "$DB_PATH" ]] || outflow_die "Production database is missing or empty: $DB_PATH"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path=$(outflow_non_overwriting_path "$BACKUP_DIR" "outflow-pre-update-$timestamp" db)
mkdir -p -- "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if [[ "$TEST_MODE" == 1 ]]; then
  [[ "$FAIL_AT" != backup ]] || outflow_die 'Simulated backup failure'
  cp -- "$DB_PATH" "$backup_path"
else
  node "$APP_LINK/scripts/sqlite-backup.js" "$DB_PATH" "$backup_path"
  chown outflow:outflow "$backup_path"
fi
[[ -s "$backup_path" ]] || outflow_die 'Backup verification failed'
outflow_info "Verified database backup: $backup_path"

stage="$RELEASES_DIR/.staging-$timestamp-$$"
mkdir -p -- "$stage"
touch "$stage/.outflow-staging"
cleanup_stage() { [[ ! -d "$stage" ]] || outflow_safe_remove_staging "$stage" "$RELEASES_DIR"; }
trap cleanup_stage EXIT

if [[ "$TEST_MODE" == 1 ]]; then
  [[ "$FAIL_AT" != fetch ]] || outflow_die 'Simulated clone/fetch failure'
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
[[ "$FAIL_AT" != npm ]] || outflow_die 'Simulated dependency installation failure'
if [[ "$TEST_MODE" != 1 ]]; then
  (cd "$stage" && npm ci --omit=dev)
  outflow_verify_release_metadata "$stage" "$RELEASE_REF"
  (cd "$stage" && node scripts/verify-syntax.js)
fi
[[ "$FAIL_AT" != after_validation ]] || outflow_die 'Simulated failure after validation'

release_name=${RELEASE_REF//[^0-9A-Za-z._-]/-}-$timestamp-$$
release_dir="$RELEASES_DIR/$release_name"
release_suffix=1
while [[ -e "$release_dir" ]]; do
  release_dir="$RELEASES_DIR/$release_name-$release_suffix"
  release_suffix=$((release_suffix + 1))
done
touch "$stage/.outflow-installation"
mv -- "$stage" "$release_dir"
trap - EXIT
rm -f -- "$release_dir/.outflow-staging"
if [[ "$TEST_MODE" == 1 ]]; then outflow_secure_release_tree "$release_dir" outflow 0
else outflow_secure_release_tree "$release_dir" outflow 1; fi

outflow_atomic_link "$release_dir" "$APP_LINK"
rollback() {
  outflow_info 'Health check failed; restoring previous release and database.'
  outflow_atomic_link "$previous_target" "$APP_LINK"
  if [[ "$TEST_MODE" == 1 ]]; then
    cp -- "$backup_path" "$DB_PATH"
  else
    systemctl stop outflow || true
    restore_path="$DB_PATH.restore.$timestamp"
    node "$previous_target/scripts/sqlite-backup.js" "$backup_path" "$restore_path"
    chown outflow:outflow "$restore_path"
    rm -f -- "$DB_PATH-wal" "$DB_PATH-shm"
    mv -f -- "$restore_path" "$DB_PATH"
    systemctl start outflow || outflow_die 'Previous release could not be restarted after rollback'
  fi
  outflow_info 'OUTFLOW_UPDATE_RESULT=rolled_back'
}

if [[ "$TEST_MODE" == 1 ]]; then
  if [[ "$FAIL_AT" == startup ]]; then printf 'simulated-migrated-database' > "$DB_PATH"; rollback; outflow_die 'Simulated startup failure'; fi
  if [[ "$FAIL_AT" == health ]]; then printf 'simulated-unready-database' > "$DB_PATH"; rollback; outflow_die 'Simulated health-check failure'; fi
else
  if ! systemctl restart outflow; then rollback; outflow_die 'Updated release could not be started'; fi
  healthy=0
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error "http://127.0.0.1:$APP_PORT/api/ready" >/dev/null; then healthy=1; break; fi
    sleep 2
  done
  if (( ! healthy )); then rollback; outflow_die 'Updated release failed its health check'; fi
fi
outflow_info "Activated Outflow release $release_name"
outflow_info 'OUTFLOW_UPDATE_RESULT=succeeded'
