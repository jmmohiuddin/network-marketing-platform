#!/usr/bin/env bash
# Runs ON the VPS in /opt/nmp, as the forced command of the GitHub Actions deploy key:
#   command="/opt/nmp/deploy/deploy.sh",restrict ssh-ed25519 AAAA... nmp-github-actions
# The key can do nothing else; the image tag (a git sha) arrives as the SSH command line.
# Pulls the image, migrates, restarts, checks health and rolls back to the previous tag if it does not come up.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE_TAG="${SSH_ORIGINAL_COMMAND:-${1:-}}"
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy: expected a 40-char git sha, got '$IMAGE_TAG'" >&2; exit 2; }
STATE_FILE=.deployed-tag
previous="$(cat "$STATE_FILE" 2>/dev/null || true)"
export IMAGE_TAG
compose() { docker compose "$@"; }

# Web up, and /v1/me answering 401 proves web -> api -> database.
healthy() {
  local port; port="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"; port="${port:-6600}"
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://172.16.1.1:$port/v1/me")" = 401 ] && return 0
    sleep 5
  done
  return 1
}

echo "deploy: ${previous:-<none>} -> $IMAGE_TAG"
compose pull api
compose --profile tools run --rm migrate
compose up -d --remove-orphans db api web
if healthy; then
  printf '%s\n' "$IMAGE_TAG" > "$STATE_FILE"
  echo "deploy: healthy, recorded $IMAGE_TAG"
  exit 0
fi
echo "deploy: $IMAGE_TAG did not become healthy" >&2
if [ -n "$previous" ]; then
  IMAGE_TAG="$previous" compose up -d --remove-orphans api web
  healthy && echo "deploy: rolled back to $previous" >&2
fi
exit 1
