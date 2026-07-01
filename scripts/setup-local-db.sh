#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Local Postgres WITHOUT Docker (dev / verification helper).
#
# Creates a self-contained Postgres 16 cluster under ./.pgdata, the owner role
# `ergane`, the database `ergane`, and the least-privileged `app_user` (via the
# same init SQL that Docker uses). Idempotent: safe to re-run.
#
# Docker (docker-compose.yml) remains the canonical path; this exists only for
# machines without Docker.
#
# Env overrides: PGBIN, PGDATA, PGPORT.
# -----------------------------------------------------------------------------
set -euo pipefail

# macOS with a non-C locale (e.g. German) can make the postmaster fail with
# "postmaster became multithreaded during startup" unless LC_ALL is set.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Find the Postgres 16 binaries (Homebrew keg-only install, or whatever is on PATH).
if [ -z "${PGBIN:-}" ]; then
  if [ -d "/opt/homebrew/opt/postgresql@16/bin" ]; then
    PGBIN="/opt/homebrew/opt/postgresql@16/bin"
  elif [ -d "/usr/local/opt/postgresql@16/bin" ]; then
    PGBIN="/usr/local/opt/postgresql@16/bin"
  else
    PGBIN="$(dirname "$(command -v initdb)")"
  fi
fi
export PATH="$PGBIN:$PATH"

PGDATA="${PGDATA:-$SCRIPT_DIR/.pgdata}"
PGPORT="${PGPORT:-5432}"
DB_NAME="ergane"
OWNER_ROLE="ergane"
OWNER_PW="ergane"

echo "Using initdb: $(command -v initdb)"
echo "PGDATA=$PGDATA  PGPORT=$PGPORT"

# 0. Make sure the pgvector extension is installed for THIS Postgres install.
#    (Docker users get it from the pgvector/pgvector:pg16 image; a Homebrew
#    postgresql@16 keg does not ship it, so we build it from source against the
#    exact server binaries. Idempotent: skipped when vector.control exists.)
PGVECTOR_VERSION="v0.8.4"
SHAREDIR="$(pg_config --sharedir)"
if [ ! -f "$SHAREDIR/extension/vector.control" ]; then
  echo "pgvector not found in $SHAREDIR/extension — building ${PGVECTOR_VERSION} from source…"
  BUILD_DIR="$(mktemp -d)"
  trap 'rm -rf "$BUILD_DIR"' EXIT
  git clone --quiet --depth 1 --branch "$PGVECTOR_VERSION" \
    https://github.com/pgvector/pgvector.git "$BUILD_DIR/pgvector"
  make -C "$BUILD_DIR/pgvector" PG_CONFIG="$PGBIN/pg_config" >/dev/null
  make -C "$BUILD_DIR/pgvector" install PG_CONFIG="$PGBIN/pg_config" >/dev/null
  echo "pgvector installed into $SHAREDIR/extension."
fi

# 1. Initialize the cluster (trust auth — local dev only).
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" -U postgres -A trust >/dev/null
fi

# 2. Start the server if it is not already running.
if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -o "-p $PGPORT" -l "$PGDATA/server.log" -w start
fi

PSQL="psql -h localhost -p $PGPORT -U postgres"

# 3. Owner role + database.
$PSQL -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
    CREATE ROLE ${OWNER_ROLE} LOGIN SUPERUSER PASSWORD '${OWNER_PW}';
  END IF;
END
\$\$;
SQL

if ! $PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  createdb -h localhost -p "$PGPORT" -U postgres -O "${OWNER_ROLE}" "${DB_NAME}"
fi

# 4. Least-privileged app_user — the SAME init SQL that Docker runs.
$PSQL -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f docker/postgres/init/01-app-user.sql

echo "✅ Local Postgres ready on localhost:${PGPORT} (db=${DB_NAME}, owner=${OWNER_ROLE}, app role=app_user)."
echo "   Stop it with:  $PGBIN/pg_ctl -D \"$PGDATA\" stop"
