#!/bin/sh
# First start of an empty volume only: the runtime role, with LOGIN, before migration 0001 grants it privileges.
# Migration 0001 refuses the role if it is superuser, BYPASSRLS, CREATEDB or CREATEROLE.
set -eu
psql -v ON_ERROR_STOP=1 -v pw="$NMP_APP_PASSWORD" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
CREATE ROLE nmp_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'pw';
SQL
