#!/bin/sh
# Run once on the VPS in /opt/nmp: writes .env with fresh random secrets. Never overwrites an existing .env,
# because changing POSTGRES_PASSWORD or SECRET_ENCRYPTION_KEY after the first start breaks the database or MFA secrets.
#   sh deploy/bootstrap.sh <domain> <registry image>     e.g. phoyev.com ghcr.io/owner/repo
set -eu
cd "$(dirname "$0")/.."
DOMAIN="${1:?usage: sh deploy/bootstrap.sh <domain> <registry image>}"
REGISTRY_IMAGE="${2:?usage: sh deploy/bootstrap.sh <domain> <registry image>}"
if [ -e .env ]; then echo ".env exists; leaving it unchanged" >&2; exit 0; fi
umask 077
cat > .env <<EOF
DOMAIN=$DOMAIN
REGISTRY_IMAGE=$REGISTRY_IMAGE
WEB_PORT=6600
POSTGRES_PASSWORD=$(openssl rand -hex 32)
NMP_APP_PASSWORD=$(openssl rand -hex 32)
SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
echo "wrote .env for $DOMAIN (mode 600); back it up somewhere safe"
