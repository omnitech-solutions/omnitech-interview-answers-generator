#!/bin/sh
# Runs once, on an EMPTY data volume only (the postgres image skips
# /docker-entrypoint-initdb.d when data exists). It creates the database and
# applies the same idempotent role step `pnpm dev` runs against an existing
# volume, so a fresh and an upgraded database end up identical.
set -e
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -c "CREATE DATABASE omnitech"
psql -v ON_ERROR_STOP=1 --single-transaction --username postgres --dbname omnitech \
  -f /docker/postgres/ensure-roles.sql
