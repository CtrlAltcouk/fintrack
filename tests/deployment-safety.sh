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
release_tree_is_safe() {
  local release=$1
  [[ ${MSYSTEM:-} ]] && return 0
  [[ $(stat -c '%a' "$release") == 750 \
     && $(stat -c '%a' "$release/package.json") == 640 \
     && $(stat -c '%a' "$release/server.js") == 640 \
     && -z $(find "$release" -type d ! -perm 0750 -print -quit) \
     && -z $(find "$release" -perm /0022 -print -quit) ]]
}
has_namespace_hardening() {
  grep -Eq '^(PrivateTmp|PrivateDevices|ProtectSystem|ProtectHome|ProtectKernelTunables|ProtectKernelModules|ProtectControlGroups|ReadWritePaths)=' "$1"
}
has_standard_namespace_hardening() {
  local unit=$1 protect_system=$2 writable_paths=$3
  grep -q '^PrivateTmp=true$' "$unit" \
    && grep -q '^PrivateDevices=true$' "$unit" \
    && grep -q "^ProtectSystem=$protect_system$" "$unit" \
    && grep -q '^ProtectHome=true$' "$unit" \
    && grep -q '^ProtectKernelTunables=true$' "$unit" \
    && grep -q '^ProtectKernelModules=true$' "$unit" \
    && grep -q '^ProtectControlGroups=true$' "$unit" \
    && grep -q "^ReadWritePaths=$writable_paths$" "$unit"
}
has_compatible_hardening() {
  grep -q '^NoNewPrivileges=true$' "$1" \
    && grep -q '^LockPersonality=true$' "$1" \
    && grep -q '^RestrictSUIDSGID=true$' "$1" \
    && grep -q '^UMask=0077$' "$1"
}

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
  local base=$1 source=$2 fail=${3:-} profile=${4:-standard} container_type=${5:-}
  env container="$container_type" OUTFLOW_TEST_MODE=1 OUTFLOW_TEST_FAIL_AT="$fail" OUTFLOW_RELEASE_REF="$REF" \
    OUTFLOW_SYSTEMD_PROFILE="$profile" OUTFLOW_SYSTEMD_UNIT_DIR="$base/systemd" \
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

# Config creation must not leak its restrictive umask into later release creation.
umask_case="$ROOT/umask"
mkdir -p "$umask_case"
if (
  umask 0027
  before_umask=$(umask)
  outflow_write_config "$umask_case/outflow.env" /var/lib/outflow/outflow.db /opt/outflow/app
  after_umask=$(umask)
  mkdir "$umask_case/release"
  touch "$umask_case/existing.env"
  before_failure_umask=$(umask)
  ! outflow_write_config "$umask_case/existing.env" /var/lib/outflow/outflow.db /opt/outflow/app >/dev/null 2>&1
  after_failure_umask=$(umask)
  [[ "$before_umask" == "$after_umask" ]] \
    && [[ "$before_failure_umask" == "$after_failure_umask" ]] \
    && mode_is "$umask_case/outflow.env" 600 \
    && mode_is "$umask_case/release" 750
); then ok 'config creation is restrictive without leaking umask to later release directories'
else not_ok 'config creation is restrictive without leaking umask to later release directories' 'caller umask or resulting mode changed'; fi

# Fresh install creates separated code/data/config/log paths and no checkout database.
fresh="$ROOT/fresh"
if setup_case "$fresh" "$source_one" \
   && [[ -e "$fresh/opt/outflow/app" && -f "$fresh/opt/outflow/app/.outflow-installation" ]] \
   && [[ -d "$fresh/var/lib/outflow/backups" && -f "$fresh/etc/outflow/outflow.env" ]] \
   && [[ ! -e "$fresh/opt/outflow/app/data/fintrack.db" ]] \
   && mode_is "$fresh/var/lib/outflow" 700 \
   && mode_is "$fresh/etc/outflow/outflow.env" 600; then ok 'fresh installation uses separated protected paths'
else cat "$fresh-setup.err" >&2; not_ok 'fresh installation uses separated persistent paths' 'layout was not created safely'; fi

fresh_release=$(readlink -f "$fresh/opt/outflow/app")
if mode_is "$fresh/opt/outflow" 750 && mode_is "$fresh/opt/outflow/releases" 750 \
   && release_tree_is_safe "$fresh_release" \
   && [[ -r "$fresh_release/package.json" && -r "$fresh_release/server.js" ]]; then
  ok 'managed release is traversable and readable by its group but application code is not group-writable'
else not_ok 'managed release is traversable and readable by its group but application code is not group-writable' 'release ownership modes are unsafe'; fi

normal_service="$fresh/systemd/outflow.service"
if grep -q '^User=outflow$' "$normal_service" \
   && grep -q '^Group=outflow$' "$normal_service" \
   && grep -q '^WorkingDirectory=/opt/outflow/app$' "$normal_service" \
   && has_standard_namespace_hardening "$normal_service" strict '/var/lib/outflow /var/log/outflow' \
   && has_compatible_hardening "$normal_service"; then
  ok 'normal managed installation retains the stronger application service sandbox'
else not_ok 'normal managed installation retains the stronger application service sandbox' 'normal service hardening is incomplete'; fi

lxc="$ROOT/lxc"
if setup_case "$lxc" "$source_one" '' auto lxc \
   && lxc_service="$lxc/systemd/outflow.service" \
   && grep -q '^User=outflow$' "$lxc_service" \
   && grep -q '^Group=outflow$' "$lxc_service" \
   && grep -q '^WorkingDirectory=/opt/outflow/app$' "$lxc_service" \
   && grep -q '^EnvironmentFile=/etc/outflow/outflow.env$' "$lxc_service" \
   && grep -q '^# OutflowSystemdProfile=lxc$' "$lxc_service" \
   && has_compatible_hardening "$lxc_service" \
   && ! has_namespace_hardening "$lxc_service"; then
  ok 'simulated LXC install omits namespace directives but retains compatible application hardening'
else cat "$lxc-setup.err" >&2; not_ok 'simulated LXC install omits namespace directives but retains compatible application hardening' 'LXC application profile is unsafe'; fi

dropin="$ROOT/dropin"
mkdir -p "$dropin/systemd/outflow.service.d"
printf '[Service]\nPrivateTmp=false\n' > "$dropin/systemd/outflow.service.d/local.conf"
dropin_hash=$(hash_file "$dropin/systemd/outflow.service.d/local.conf")
if setup_case "$dropin" "$source_one" '' auto lxc \
   && env container=lxc OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=auto \
     OUTFLOW_SYSTEMD_UNIT_DIR="$dropin/systemd" OUTFLOW_SERVICE_USER=outflow \
     bash "$REPO_ROOT/scripts/install-outflow-service.sh" \
   && env container=lxc OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=auto \
     OUTFLOW_SYSTEMD_UNIT_DIR="$dropin/systemd" OUTFLOW_SERVICE_USER=outflow \
     bash "$REPO_ROOT/scripts/install-outflow-service.sh" \
   && [[ $(hash_file "$dropin/systemd/outflow.service.d/local.conf") == "$dropin_hash" ]]; then
  ok 'application service installation is idempotent and preserves operator-created systemd drop-ins'
else not_ok 'application service installation is idempotent and preserves operator-created systemd drop-ins' 'local drop-in was changed'; fi

app_unit_target="$dropin/systemd/unrelated-root-file"
printf 'do-not-overwrite' > "$app_unit_target"
rm "$dropin/systemd/outflow.service"
ln "$app_unit_target" "$dropin/systemd/outflow.service"
if ! env container=lxc OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=auto \
     OUTFLOW_SYSTEMD_UNIT_DIR="$dropin/systemd" OUTFLOW_SERVICE_USER=outflow \
     bash "$REPO_ROOT/scripts/install-outflow-service.sh" >/dev/null 2>&1 \
   && [[ $(cat "$app_unit_target") == do-not-overwrite ]]; then
  ok 'application service installation rejects linked unit files without overwriting their target'
else not_ok 'application service installation rejects linked unit files without overwriting their target' 'linked unit target changed'; fi

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
mkdir -p "$agent/data" "$agent/units/outflow-update.service.d" "$agent/bin"
printf '[Service]\nPrivateDevices=false\n' > "$agent/units/outflow-update.service.d/local.conf"
agent_dropin_hash=$(hash_file "$agent/units/outflow-update.service.d/local.conf")
if env OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=standard OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
     OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh" \
   && env OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=standard OUTFLOW_UPDATE_ROOT="$agent/data" OUTFLOW_SYSTEMD_UNIT_DIR="$agent/units" \
     OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh" \
   && [[ -f "$agent/units/outflow-update.path" && -f "$agent/units/outflow-update.service" ]] \
   && grep -q '^PathExists=/var/lib/outflow-update/request/request.json$' "$agent/units/outflow-update.path" \
   && grep -q '^ExecStart=/usr/bin/bash /opt/outflow/app/scripts/update-agent.sh$' "$agent/units/outflow-update.service" \
   && ! grep -q '^Restart=' "$agent/units/outflow-update.service" \
   && has_standard_namespace_hardening "$agent/units/outflow-update.service" full \
     '/opt/outflow /var/lib/outflow /var/lib/outflow-update /run/lock' \
   && has_compatible_hardening "$agent/units/outflow-update.service" \
   && [[ $(hash_file "$agent/units/outflow-update.service.d/local.conf") == "$agent_dropin_hash" ]] \
   && mode_is "$agent/data" 755 && mode_is "$agent/data/request" 730 && mode_is "$agent/data/state" 750; then
  ok 'normal managed update agent is idempotent, preserves drop-ins, and retains its stronger fixed service sandbox'
else not_ok 'normal managed update agent is idempotent, preserves drop-ins, and retains its stronger fixed service sandbox' 'unit installation failed'; fi

lxc_agent="$ROOT/lxc-agent"
mkdir -p "$lxc_agent/data" "$lxc_agent/units"
if env container=lxc OUTFLOW_TEST_MODE=1 OUTFLOW_SYSTEMD_PROFILE=auto OUTFLOW_UPDATE_ROOT="$lxc_agent/data" \
     OUTFLOW_SYSTEMD_UNIT_DIR="$lxc_agent/units" OUTFLOW_SERVICE_USER=outflow \
     bash "$REPO_ROOT/scripts/install-update-agent.sh" \
   && grep -q '^User=root$' "$lxc_agent/units/outflow-update.service" \
   && grep -q '^ExecStart=/usr/bin/bash /opt/outflow/app/scripts/update-agent.sh$' "$lxc_agent/units/outflow-update.service" \
   && grep -q '^# OutflowSystemdProfile=lxc$' "$lxc_agent/units/outflow-update.service" \
   && has_compatible_hardening "$lxc_agent/units/outflow-update.service" \
   && ! has_namespace_hardening "$lxc_agent/units/outflow-update.service"; then
  ok 'LXC update agent omits namespace directives while preserving the fixed privileged boundary'
else not_ok 'LXC update agent omits namespace directives while preserving the fixed privileged boundary' 'LXC updater profile is unsafe'; fi

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
  OUTFLOW_SYSTEMD_PROFILE=standard OUTFLOW_SERVICE_USER=outflow bash "$REPO_ROOT/scripts/install-update-agent.sh"

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
old_mode=$(stat -c '%a' "$runtime_db")
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
   && [[ $(hash_file "$runtime_db") == "$old_hash" && $(stat -c '%a' "$runtime_db") == "$old_mode" ]] \
   && release_tree_is_safe "$(readlink -f "$fresh/opt/outflow/app")"; then ok 'a legitimate update preserves database mode and activates non-writable application code after all injected failures'
else cat "$fresh-update.err" >&2; not_ok 'a legitimate update can run after all injected failures' 'failure state blocked the next update'; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
