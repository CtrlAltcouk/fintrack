#!/usr/bin/env bash
# Root-owned narrow update agent. It accepts no command or path from HTTP.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REQUEST_FILE=${OUTFLOW_UPDATE_REQUEST_FILE:-/var/lib/outflow-update/request/request.json}
STATE_FILE=${OUTFLOW_UPDATE_STATE_FILE:-/var/lib/outflow-update/state/state.json}
LOCK_FILE=${OUTFLOW_UPDATE_LOCK_FILE:-/run/lock/outflow-update.lock}
DEPLOY_SCRIPT=${OUTFLOW_DEPLOY_SCRIPT:-/opt/outflow/app/scripts/deploy-update.sh}
TEST_MODE=${OUTFLOW_TEST_MODE:-0}
REQUEST_GUARD_FILE="${REQUEST_FILE}.lock"

if [[ "$TEST_MODE" != 1 ]]; then
  [[ $(id -u) -eq 0 ]] || { printf '[ERROR] update agent must run as root\n' >&2; exit 1; }
  [[ "$REQUEST_FILE" == /var/lib/outflow-update/request/request.json \
     && "$STATE_FILE" == /var/lib/outflow-update/state/state.json \
     && "$LOCK_FILE" == /run/lock/outflow-update.lock \
     && "$DEPLOY_SCRIPT" == /opt/outflow/app/scripts/deploy-update.sh ]] \
    || { printf '[ERROR] update agent paths are fixed in production\n' >&2; exit 1; }
fi

[[ -f "$REQUEST_FILE" ]] || exit 0
lock_directory=
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
elif [[ "$TEST_MODE" == 1 ]]; then
  lock_directory="${LOCK_FILE}.directory"
  mkdir "$lock_directory" 2>/dev/null || exit 0
else
  printf '[ERROR] flock is required by the update agent\n' >&2
  exit 1
fi

finish() {
  rm -f -- "$REQUEST_FILE"
  rm -f -- "$REQUEST_GUARD_FILE"
  [[ -z "$lock_directory" ]] || rmdir -- "$lock_directory"
}
trap finish EXIT

expected_uid=
if [[ "$TEST_MODE" != 1 ]]; then
  expected_uid=$(id -u outflow)
  expected_gid=$(id -g outflow)
  request_directory=$(dirname -- "$REQUEST_FILE")
  state_directory=$(dirname -- "$STATE_FILE")
  [[ ! -L "$request_directory" && ! -L "$state_directory" \
     && $(stat -c '%u:%g:%a' "$request_directory") == "0:$expected_gid:730" \
     && $(stat -c '%u:%g:%a' "$state_directory") == "0:$expected_gid:750" ]] || {
    printf '[security-audit] {"action":"update.failed","outcome":"rejected","reason":"unsafe_spool_permissions"}\n' >&2
    exit 1
  }
fi
if ! request_fields=$(node "$SCRIPT_DIR/update-state.js" read-request "$REQUEST_FILE" "$expected_uid" 900); then
  node "$SCRIPT_DIR/update-state.js" write-rejection "$STATE_FILE"
  printf '[security-audit] {"action":"update.failed","outcome":"rejected","reason":"invalid_or_stale_request"}\n' >&2
  exit 1
fi
IFS=$'\t' read -r target current requested_by <<<"$request_fields"
[[ "$target" =~ ^[0-9a-f]{40}$ && "$current" =~ ^[0-9a-f]{40}$ \
   && "$requested_by" =~ ^[1-9][0-9]*$ ]] || { printf '[ERROR] invalid update request\n' >&2; exit 1; }

write_state() {
  node "$SCRIPT_DIR/update-state.js" write-state "$STATE_FILE" "$1" \
    "$target" "$current" "$requested_by" "${2:-}"
}
audit() {
  printf '[security-audit] {"timestamp":"%s","action":"update.%s","outcome":"%s","user_id":%s,"current_commit":"%s","requested_commit":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$requested_by" "$current" "$target"
}

write_state in_progress
audit started attempted
if deploy_output=$(bash "$DEPLOY_SCRIPT" "$target" 2>&1); then
  printf '%s\n' "$deploy_output"
  write_state succeeded
  audit succeeded succeeded
else
  deploy_status=$?
  printf '%s\n' "$deploy_output" >&2
  if grep -q '^\[INFO\] OUTFLOW_UPDATE_RESULT=rolled_back$' <<<"$deploy_output"; then
    write_state rolled_back update_rolled_back
    audit rolled_back succeeded
  else
    write_state failed update_failed
    audit failed failed
  fi
  exit "$deploy_status"
fi
