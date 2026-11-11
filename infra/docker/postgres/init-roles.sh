#!/usr/bin/env bash
# Runs once, on the first start of the local PostgreSQL container (empty data volume).
# Creates the least-privilege roles and the CRM databases. Table-level grants are applied by migrations.
# See docs/security/database-roles.md.
set -euo pipefail

: "${CRM_MIGRATOR_PASSWORD:?CRM_MIGRATOR_PASSWORD is required}"
: "${CRM_APP_PASSWORD:?CRM_APP_PASSWORD is required}"
: "${CRM_WORKER_PASSWORD:?CRM_WORKER_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$CRM_MIGRATOR_PASSWORD" \
  -v app_pw="$CRM_APP_PASSWORD" \
  -v worker_pw="$CRM_WORKER_PASSWORD" <<'SQL'
-- Login roles
CREATE ROLE crm_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE crm_app      LOGIN PASSWORD :'app_pw'      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE crm_worker   LOGIN PASSWORD :'worker_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

-- Owner of the outbox scheduling function. Cannot log in.
CREATE ROLE crm_outbox_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

-- Lets migrations assign crm_outbox_owner as the function owner, without inheriting its rights.
GRANT crm_outbox_owner TO crm_migrator WITH INHERIT FALSE, SET TRUE;

-- Application database and the template used to create per-test databases.
CREATE DATABASE crm OWNER crm_migrator;
CREATE DATABASE crm_test_template OWNER crm_migrator;

REVOKE ALL ON DATABASE crm FROM PUBLIC;
REVOKE ALL ON DATABASE crm_test_template FROM PUBLIC;
GRANT CONNECT ON DATABASE crm TO crm_app, crm_worker;
GRANT CONNECT ON DATABASE crm_test_template TO crm_app, crm_worker;
SQL
