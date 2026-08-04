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
    bash "$REPO_ROOT/scripts/deploy-update.sh" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >/dev/null 2>&1
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
printf 'secret-sentinel' >> "$fresh/etc/outflow/outflow.env"
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

if ! update_case "$fresh" "$source_two" after_staging && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'interrupted staged update preserves previous release and database'
else not_ok 'interrupted staged update preserves previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" after_validation && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'validation failure preserves previous release and database'
else not_ok 'validation failure preserves previous release and database' 'old release or database changed'; fi

if ! update_case "$fresh" "$source_two" health && [[ $(readlink -f "$fresh/opt/outflow/app") == "$old_target" ]] && [[ $(hash_file "$runtime_db") == "$old_hash" ]]; then ok 'health-check failure rolls back release and database'
else not_ok 'health-check failure rolls back release and database' 'rollback did not restore prior state'; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
