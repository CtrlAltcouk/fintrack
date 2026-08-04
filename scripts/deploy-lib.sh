#!/usr/bin/env bash

# Shared deployment safety helpers. This file performs no work when sourced.
outflow_die() { printf '[ERROR] %s\n' "$*" >&2; return 1; }
outflow_info() { printf '[INFO] %s\n' "$*"; }

outflow_canonical_path() {
  local candidate=${1:-}
  [[ -n "$candidate" ]] || outflow_die 'Path must not be empty.' || return 1
  realpath -m -- "$candidate"
}

outflow_validate_absolute_path() {
  local candidate=${1:-} expected_root=${2:-} resolved root
  [[ "$candidate" == /* ]] || outflow_die "Path must be absolute: ${candidate:-<empty>}" || return 1
  resolved=$(outflow_canonical_path "$candidate") || return 1
  case "$resolved" in
    /|/opt|/var|/home|/etc|/usr|/root) outflow_die "Refusing dangerous deployment path: $resolved" || return 1 ;;
  esac
  [[ ${#resolved} -ge 8 ]] || outflow_die "Deployment path is too broad: $resolved" || return 1
  if [[ -n "$expected_root" ]]; then
    root=$(outflow_canonical_path "$expected_root") || return 1
    [[ "$resolved" == "$root" || "$resolved" == "$root"/* ]] \
      || outflow_die "Path escapes the expected root $root: $resolved" || return 1
  fi
  printf '%s\n' "$resolved"
}

outflow_reject_symlink() {
  [[ ! -L "$1" ]] || outflow_die "Refusing symlink path: $1"
}

outflow_safe_remove_staging() {
  local candidate=${1:-} releases_root=${2:-} resolved root
  resolved=$(outflow_validate_absolute_path "$candidate" "$releases_root") || return 1
  root=$(outflow_canonical_path "$releases_root") || return 1
  [[ "$resolved" == "$root"/.staging-* ]] \
    || outflow_die "Refusing to clean a non-staging path: $resolved" || return 1
  outflow_reject_symlink "$resolved" || return 1
  [[ -f "$resolved/.outflow-staging" ]] \
    || outflow_die "Refusing to clean staging path without marker: $resolved" || return 1
  find "$resolved" -depth -mindepth 1 -delete
  rmdir -- "$resolved"
}

outflow_validate_release_ref() {
  local ref=${1:-}
  [[ "$ref" =~ ^[0-9a-fA-F]{40}$ || "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
    || outflow_die 'Release must be a full 40-character commit SHA or semantic version tag (vX.Y.Z).'
}

outflow_verify_release_metadata() {
  local release_dir=$1 release_ref=$2
  if [[ "$release_ref" == v* ]]; then
    (cd "$release_dir" && env GITHUB_REF_TYPE=tag GITHUB_REF_NAME="$release_ref" node scripts/verify-release-metadata.js)
  else
    (cd "$release_dir" && node scripts/verify-release-metadata.js)
  fi
}

outflow_path_is_within() {
  local candidate root
  candidate=$(outflow_canonical_path "$1") || return 1
  root=$(outflow_canonical_path "$2") || return 1
  [[ "$candidate" == "$root" || "$candidate" == "$root"/* ]]
}

outflow_detect_layout() {
  local app_root=$1 data_dir=$2 config_dir=$3 legacy_root=$4
  local new_db="$data_dir/outflow.db" legacy_db="$legacy_root/data/fintrack.db"
  local has_new=0 has_legacy=0
  [[ -e "$app_root/app" || -e "$app_root/current" || -e "$app_root/.outflow-installation" \
     || -e "$new_db" || -e "$config_dir/outflow.env" ]] && has_new=1
  [[ -e "$legacy_root" || -e "$legacy_db" ]] && has_legacy=1
  if (( has_new && has_legacy )); then printf 'conflict\n'
  elif (( has_legacy )); then printf 'legacy\n'
  elif (( has_new )); then printf 'existing\n'
  else printf 'fresh\n'; fi
}

outflow_verify_database_path() {
  local db_path=$1 data_root=$2 app_root=$3 resolved
  resolved=$(outflow_validate_absolute_path "$db_path" "$data_root") || return 1
  outflow_reject_symlink "$db_path" || return 1
  if outflow_path_is_within "$resolved" "$app_root"; then
    outflow_die "Database must not be stored beneath replaceable application code: $resolved" || return 1
  fi
  printf '%s\n' "$resolved"
}

outflow_non_overwriting_path() {
  local directory=$1 stem=$2 extension=${3:-backup}
  local candidate="$directory/$stem.$extension" suffix=1
  while [[ -e "$candidate" ]]; do candidate="$directory/$stem.$suffix.$extension"; suffix=$((suffix + 1)); done
  printf '%s\n' "$candidate"
}

outflow_write_config() {
  local config_file=$1 db_path=$2 app_dir=$3
  [[ ! -e "$config_file" ]] || outflow_die "Refusing to overwrite existing configuration: $config_file" || return 1
  umask 077
  {
    printf 'NODE_ENV=production\nOUTFLOW_DB_PATH=%s\nOUTFLOW_APP_DIR=%s\nPORT=3000\n' "$db_path" "$app_dir"
  } > "$config_file"
  chmod 600 "$config_file"
}

outflow_atomic_link() {
  local target=$1 link_path=$2 next_link="${2}.next.$$"
  ln -s -- "$target" "$next_link"
  mv -Tf -- "$next_link" "$link_path"
}
