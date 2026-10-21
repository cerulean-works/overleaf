#!/bin/bash
set -euo pipefail

# First source deployments can start without hand-generating signing keys. Keep
# generated values in the app volume; explicitly configured values always win.
DATA_DIR="${OVERLEAF_DATA_DIR:-/var/lib/overleaf}"
ENV_DIR="${OVERLEAF_CONTAINER_ENV_DIR:-/etc/container_environment}"
SECRET_DIR="$DATA_DIR/secrets"
umask 077
mkdir -p "$SECRET_DIR" "$ENV_DIR"
chmod 700 "$SECRET_DIR"

persist_signing_key() {
  local env_name="$1"
  local filename="$2"
  local description="$3"
  local secret_file="$SECRET_DIR/$filename"
  local explicit_value="${!env_name:-}"

  if [[ -n "$explicit_value" ]] || [[ ! -s "$secret_file" ]]; then
    SECRET_TEMP=$(mktemp "$SECRET_DIR/.$filename.XXXXXX")
    trap 'rm -f "$SECRET_TEMP"' EXIT
    if [[ -n "$explicit_value" ]]; then
      printf '%s\n' "$explicit_value" > "$SECRET_TEMP"
    else
      openssl rand -hex 32 > "$SECRET_TEMP"
      echo "Created a persistent $description signing key in the application volume."
    fi
    mv -f "$SECRET_TEMP" "$secret_file"
    trap - EXIT
  fi

  chmod 600 "$secret_file"
  printf '%s\n' "$(cat "$secret_file")" > "$ENV_DIR/$env_name"
  chmod 600 "$ENV_DIR/$env_name"
}

persist_signing_key OVERLEAF_INVITE_TOKEN_SECRET invite-token-secret invitation
persist_signing_key OVERLEAF_SESSION_SECRET session-secret session
