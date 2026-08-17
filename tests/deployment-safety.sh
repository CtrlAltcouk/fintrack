#!/usr/bin/env bash
set -u

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
source "$REPO_ROOT/scripts/deploy-lib.sh"
ROOT=$(mktemp -d)
PASS=0
FAIL=0
REF=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

cleanup() { find "$ROOT" -depth -mindepth 1 -delete; rmdir "$ROOT"; }
trap cleanup EXIT
ok() { PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"; }
not_ok() { FAIL=$((FAIL + 1)); printf '  ✗ %s: %s\n' "$1" "$2" >&2; }
assert() { local name=$1; shift; if "$@"; then ok "$name"; else not_ok "$name" 'assertion failed'; fi; }
hash_file() { sha256sum "$1" | awk '{print $1}'; }
mode_is() { [[ ${MSYSTEM:-} ]] || [[ $(stat -c '%a' "$1") == "$2" ]]; }

make_source() {
  local target=$1 label=$2
  mkdir -p "$target"
  printf '{"name":"outflow-test","version":"1.0.0"}\n' > "$target/package.json"
  printf '{"name":"outflow-test","version":"1.0.0","lockfileVersion":3,"packages":{}}\n' > "$target/package-lock.json"
  printf 'console.log(%q);\n' "$label" > "$target/server.js"
}

if outflow_verify_release_metadata "$REPO_ROOT" v2.3.0 >/dev/null 2>&1 \
   && ! outflow_verify_release_metadata "$REPO_ROOT" v9.9.9 >/dev/null 2>&1; then
  ok 'deployment metadata validation rejects a tag that differs from the package version'
else
  not_ok 'deployment metadata validation rejects a tag that differs from the package version' 'tag/package mismatch was accepted'
fi

setup_case() {
  local base=$1 source=$2 fail=${3:-}
  env OUTFLOW_TEST_MODE=1 OUTFLOW_TEST_FAIL_AT="$fail" OUTFLOW_RELEASE_REF="$REF" \
    OUTFLOW_STAGE_SOURCE="$source" OUTFLOW_APP_ROOT="$base/opt/outflow" \
    OUTFLOW_DATA_DIR="$base/var/lib/outflow" OUTFLOW_CONFIG_DIR="$base/etc/outflow" \
    OUTFLOW_LOG_DIR="$base/var/log/outflow" OUTFLOW_LEGACY_ROOT="$base/opt/fintrack" \
    bash "$REPO_ROOT/setup.sh" >/dev/null 2>"$base-setup.err"
}

update_case() {
  local base=$1 source=$2 fail=${3:-}
  env OUTFLOW_TEST_MODE=1 OUTFLOW_TEST_FAIL_AT="$fail" OUTFLOW_STAGE_SOURCE="$source" \
    OUTFLOW_APP_ROOT="$base/opt/outflow" OUTFLOW_DATA_DIR="$base/var/lib/outflow" \
    OUTFLOW_CONFIG_FILE="$base/etc/outflow/outflow.env" \
    bash "$REPO_ROOT/scripts/deploy-update.sh" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
      >"$base-update.out" 2>"$base-update.err"
}

source_one="$ROOT/source-one"
source_two="$ROOT/source-two"
make_source "$source_one" old
make_source "$source_two" new

# Fresh install creates separated code/data/config/log paths and no checkout database.
fresh="$ROOT/fresh"
if setup_case "$fresh" "$source_one" \
   && [[ -e "$fresh/opt/outflow/app" && -f "$fresh/opt/outflow/app/.outflow-installation" ]] \
   && [[ -d "$fresh/var/lib/outflow/backups" && -f "$fresh/etc/outflow/outflow.env" ]] \
   && [[ ! -e "$fresh/opt/outflow/app/data/fintrack.db" ]] \
   && mode_is "$fresh/var/lib/outflow" 700 \
   && mode_is "$fresh/etc/outflow/outflow.env" 600; then ok 'fresh installation uses separated protected paths'
else cat "$fresh-setup.err" >&2; not_ok 'fresh installation uses separated persistent paths' 'layout was not created safely'; fi

# Runtime creates the database only at the configured production location.
runtime_db="$fresh/var/lib/outflow/outflow.db"
if env -u FINTRACK_DB_PATH NODE_ENV=production OUTFLOW_DB_PATH="$runtime_db" OUTFLOW_APP_DIR="$fresh/opt/outflow/app" \
   node -e "const db=require(process.argv[1]); db.close()" "$REPO_ROOT/db.js" >/dev/null 2>&1 \
   && [[ -s "$runtime_db" ]]; then ok 'production database is created only in persistent storage'
else not_ok 'production database is created only in persistent storage' 'runtime path assertion failed'; fi

# Rerun must preserve the database, sidecars, backups, configuration, and logs byte-for-byte.
printf 'wal-sentinel' > "$runtime_db-wal"
printf 'shm-sentinel' > "$runtime_db-shm"
printf 'backup-sentinel' > "$fresh/var/lib/outflow/backups/keep.backup"
printf '# secret-sentinel\n' >> "$fresh/etc/outflow/outflow.env"
printf 'log-sentinel' > "$fresh/var/log/outflow/outflow.log"
before=$(for f in "$runtime_db" "$runtime_db-wal" "$runtime_db-shm" "$fresh/var/lib/outflow/backups/keep.backup" "$fresh/etc/outflow/outflow.env" "$fresh/var/log/outflow/outflow.log"; do hash_file "$f"; done)
if ! setup_case "$fresh" "$source_two" && [[ "$before" == "$(for f in "$runtime_db" "$runtime_db-wal" "$runtime_db-shm" "$fresh/var/lib/outflow/backups/keep.backup" "$fresh/etc/outflow/outflow.env" "$fresh/var/log/outflow/outflow.log"; do hash_file "$f"; done)" ]]; then ok 'installer rerun exits and preserves all persistent files'
else not_ok 'installer rerun exits and preserves all persistent files' 'persistent hash changed or rerun succeeded'; fi

legacy="$ROOT/legacy"
mkdir -p "$legacy/opt/fintrack/data"
printf 'legacy-db' > "$legacy/opt/fintrack/data/fintrack.db"
if ! setup_case "$legacy" "$source_one" && [[ ! -e "$legacy/var/lib/outflow/outflow.db" ]] && [[ $(cat "$legacy/opt/fintrack/data/fintrack.db") == legacy-db ]]; then ok 'legacy FinTrack layout is detected without creating a second database'
else not_ok 'legacy FinTrack layout is detected without creating a second database' 'legacy data changed'; fi

both="$ROOT/both"
mkdir -p "$both/opt/fintrack/data" "$both/var/lib/outflow"
printf legacy > "$both/opt/fintrack/data/fintrack.db"
printf current > "$both/var/lib/outflow/outflow.db"
if ! setup_case "$both" "$source_one" && [[ $(cat "$both/opt/fintrack/data/fintrack.db") == legacy ]] && [[ $(cat "$both/var/lib/outflow/outflow.db") == current ]]; then ok 'conflicting legacy and current databases stop without mutation'
else not_ok 'conflicting legacy and current databases stop without mutation' 'a conflicting database changed'; fi

# The narrow update agent installs only fixed units/spool paths and reports sanitized persistent state.
agent="$ROOT/agent"
mkdir -p "$agent/data" "$agent/units" "$agent/bin"
if env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
     OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh" \
   && env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
     OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh" \
   && [[ -f "$agent/units/outflow-update.path" && -f "$agent/units/outflow-update.service" ]] \
   && grep -q '^PathExists=/var/lib/outflow-update/request/request.json$' "$agent/units/outflow-update.path" \
   && grep -q '^ExecStart=/opt/outflow/app/scripts/update-agent.sh$' "$agent/units/outflow-update.service" \
   && ! grep -q '^Restart=' "$agent/units/outflow-update.service" \
   && mode_is "$agent/data" 755 && mode_is "$agent/data/request" 730 && mode_is "$agent/data/state" 750; then
  ok 'managed update agent installs a fixed root service and request watcher'
else not_ok 'managed update agent installs a fixed root service and request watcher' 'unit installation failed'; fi

unit_target="$agent/units/unrelated-root-file"
printf 'do-not-overwrite' > "$unit_target"
rm "$agent/units/outflow-update.service"
ln "$unit_target" "$agent/units/outflow-update.service"
if ! env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
     OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh" >/dev/null 2>&1 \
   && [[ $(cat "$unit_target") == do-not-overwrite ]]; then
  ok 'update agent installation rejects linked unit files without overwriting their target'
else not_ok 'update agent installation rejects linked unit files without overwriting their target' 'linked unit target changed'; fi
rm "$agent/units/outflow-update.service" "$unit_target"
env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
  OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh"

agent_request="$agent/data/request/request.json"
agent_state="$agent/data/state/state.json"
printf '{"status":"requested","target":"%s","current":"%s","requested_by":7,"updated_at":"%s"}\n' \
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$agent_request"
chmod 600 "$agent_request"
cat > "$agent/bin/deploy-ok.sh" <<'SCRIPT'
#!/usr/bin/env bash
[[ "$1" == bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ]] || exit 2
printf '[INFO] OUTFLOW_UPDATE_RESULT=succeeded\n'
SCRIPT
if agent_success_output=$(env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-ok.sh" bash "$REPO_ROOT/scripts/update-agent.sh") \
   && [[ ! -e "$agent_request" ]] \
   && grep -q '"action":"update.started"' <<<"$agent_success_output" \
   && grep -q '"action":"update.succeeded"' <<<"$agent_success_output" \
   && node -e "const s=require(process.argv[1]); if(s.status!=='succeeded'||s.target!=='b'.repeat(40)||'shell_output' in s)process.exit(1)" "$agent_state"; then
  ok 'update agent executes only the pinned target and persists sanitized success'
else not_ok 'update agent executes only the pinned target and persists sanitized success' 'agent success state invalid'; fi

printf '{"status":"requested","target":"%s","current":"%s","requested_by":7,"updated_at":"%s"}\n' \
  cccccccccccccccccccccccccccccccccccccccc aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$agent_request"
chmod 600 "$agent_request"
cat > "$agent/bin/deploy-rollback.sh" <<'SCRIPT'
#!/usr/bin/env bash
printf '[INFO] OUTFLOW_UPDATE_RESULT=rolled_back\n'
exit 1
SCRIPT
if ! agent_rollback_output=$(env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-rollback.sh" bash "$REPO_ROOT/scripts/update-agent.sh" 2>&1) \
   && [[ ! -e "$agent_request" ]] \
   && grep -q '"action":"update.rolled_back"' <<<"$agent_rollback_output" \
   && node -e "const s=require(process.argv[1]); if(s.status!=='rolled_back'||s.error!=='update_rolled_back')process.exit(1)" "$agent_state"; then
  ok 'update agent exposes rollback without shell output or partial request state'
else not_ok 'update agent exposes rollback without shell output or partial request state' 'agent rollback state invalid'; fi

printf '{"status":"requested","target":"%s","current":"%s","requested_by":7,"updated_at":"%s"}\n' \
  dddddddddddddddddddddddddddddddddddddddd aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$agent_request"
chmod 600 "$agent_request"
cat > "$agent/bin/deploy-fail.sh" <<'SCRIPT'
#!/usr/bin/env bash
printf 'private failure details\n' >&2
exit 1
SCRIPT
if ! agent_failure_output=$(env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-fail.sh" bash "$REPO_ROOT/scripts/update-agent.sh" 2>&1) \
   && [[ ! -e "$agent_request" ]] \
   && node -e "const s=require(process.argv[1]);if(s.status!=='failed'||s.error!=='update_failed'||JSON.stringify(s).includes('private'))process.exit(1)" "$agent_state"; then
  ok 'pre-activation agent failures are consumed and expose only generic state'
else not_ok 'pre-activation agent failures are consumed and expose only generic state' 'agent failure state was unsafe'; fi

# Malformed, stale, and hard-linked spool entries are consumed without executing or looping.
printf '{"status":"requested"' > "$agent_request"
chmod 600 "$agent_request"
if ! env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-ok.sh" bash "$REPO_ROOT/scripts/update-agent.sh" >/dev/null 2>&1 \
   && [[ ! -e "$agent_request" ]] \
   && node -e "const s=require(process.argv[1]);if(s.status!=='failed'||s.target!==null||s.error!=='update_failed')process.exit(1)" "$agent_state"; then
  ok 'partial or malformed requests fail safely and are consumed once'
else not_ok 'partial or malformed requests fail safely and are consumed once' 'invalid request was retained or executed'; fi

printf '{"status":"requested","target":"%s","current":"%s","requested_by":7,"updated_at":"2000-01-01T00:00:00Z"}\n' \
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$agent_request"
chmod 600 "$agent_request"
if ! env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-ok.sh" bash "$REPO_ROOT/scripts/update-agent.sh" >/dev/null 2>&1 \
   && [[ ! -e "$agent_request" ]]; then
  ok 'stale requests cannot redeploy after a delayed service start or reboot'
else not_ok 'stale requests cannot redeploy after a delayed service start or reboot' 'stale request was retained or accepted'; fi

linked_source="$agent/data/request/linked-request.json"
printf '{"status":"requested","target":"%s","current":"%s","requested_by":7,"updated_at":"%s"}\n' \
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$linked_source"
chmod 600 "$linked_source"
ln "$linked_source" "$agent_request"
if ! env OUTFLOW_TEST_MODE=1 OUTFLOW_UPDATE_REQUEST_FILE="$agent_request" \
     OUTFLOW_UPDATE_STATE_FILE="$agent_state" OUTFLOW_UPDATE_LOCK_FILE="$agent/agent.lock" \
     OUTFLOW_DEPLOY_SCRIPT="$agent/bin/deploy-ok.sh" bash "$REPO_ROOT/scripts/update-agent.sh" >/dev/null 2>&1 \
   && [[ ! -e "$agent_request" && -e "$linked_source" ]]; then
  ok 'hard-linked spool entries are rejected without touching their target'
else not_ok 'hard-linked spool entries are rejected without touching their target' 'hardlink was accepted or target changed'; fi

unexpected="$ROOT/unexpected"
mkdir -p "$unexpected/opt/outflow"
printf unrelated > "$unexpected/opt/outflow/file"
if ! setup_case "$unexpected" "$source_one" && [[ $(cat "$unexpected/opt/outflow/file") == unrelated ]]; then ok 'unexpected unmarked application directory is rejected'
else not_ok 'unexpected unmarked application directory is rejected' 'unexpected directory changed'; fi

interrupted="$ROOT/interrupted"
if ! setup_case "$interrupted" "$source_one" after_staging \
   && [[ ! -e "$interrupted/opt/outflow/app" && ! -e "$interrupted/etc/outflow/outflow.env" ]] \
   && setup_case "$interrupted" "$source_one"; then ok 'interrupted first install cleans only its staging state and can be retried'
else not_ok 'interrupted first install cleans only its staging state and can be retried' 'retry did not complete safely'; fi

# Dangerous path and symlink escape guards.
safe="$ROOT/path-guards/safe"
outside="$ROOT/path-guards/outside"
mkdir -p "$safe" "$outside"
if [[ ${MSYSTEM:-} ]]; then
  cmd.exe //c mklink //J "$(cygpath -w "$safe/link")" "$(cygpath -w "$outside")" >/dev/null
else
  ln -s "$outside" "$safe/link"
fi
guarded=1
for dangerous in '' / /opt /var /home; do outflow_validate_absolute_path "$dangerous" >/dev/null 2>&1 && guarded=0; done
outflow_validate_absolute_path "$safe/link/child" "$safe" >/dev/null 2>&1 && guarded=0
if (( guarded )); then ok 'dangerous and symlink-escape paths are rejected'; else not_ok 'dangerous and symlink-escape paths are rejected' 'guard accepted unsafe path'; fi

# Backup failure and pre-activation failures leave the old release/database usable.
old_target=$(readlink -f "$fresh/opt/outflow/app")
old_hash=$(hash_file "$runtime_db")
if ! update_case "$fresh" "$source_two" backup && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'backup failure stops before application replacement'
else not_ok 'backup failure stops before application replacement' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" fetch && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'clone or fetch failure preserves the previous release and database'
else not_ok 'clone or fetch failure preserves the previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" after_staging && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'interrupted staged update preserves previous release and database'
else not_ok 'interrupted staged update preserves previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" npm && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'dependency installation failure preserves the previous release and database'
else not_ok 'dependency installation failure preserves the previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" after_validation && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'validation failure preserves previous release and database'
else not_ok 'validation failure preserves previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" startup && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'startup failure rolls back the release and database'
else not_ok 'startup failure rolls back the release and database' 'rollback did not restore prior state'; fi

if ! update_case "$fresh" "$source_two" health && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'health-check failure rolls back release and database'
else not_ok 'health-check failure rolls back release and database' 'rollback did not restore prior state'; fi

if update_case "$fresh" "$source_two" && grep -q 'new' "$fresh/opt/outflow/app/server.js" \
   && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'a legitimate update can run after all injected failures'
else cat "$fresh-update.err" >&2; not_ok 'a legitimate update can run after all injected failures' 'failure state blocked the next update'; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
