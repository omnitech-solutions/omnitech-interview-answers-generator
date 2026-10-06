#!/bin/sh
# The agent worker for the Docker stack, run on THIS Mac.
#
# Claude Code (and Codex) are signed-in command-line tools: the credentials live
# in your login Keychain, so they cannot work inside a container, and ADR-0007
# keeps agents out of the web process. The Docker stack therefore runs Postgres,
# the web app and the terminal gateway; this script runs the one process that
# launches agents, against the same database and shared secrets.
#
#   scripts/docker-host-worker.sh start | stop | status
set -eu
cd "$(dirname "$0")/.."

state=".dev-local/host-worker"
mkdir -p .dev-local

[ -f .env ] && { set -a; . ./.env; set +a; }

case "${1:-status}" in
  start)
    if [ -f "$state.pid" ] && kill -0 "$(cat "$state.pid")" 2>/dev/null; then
      echo "host worker already running (pid $(cat "$state.pid"))"; exit 0
    fi
    command -v claude >/dev/null || { echo "claude CLI not found on PATH: install Claude Code and sign in" >&2; exit 1; }
    # A fresh checkout has no build yet: build the worker and what it uses.
    [ -f apps/agent-worker/dist/main.js ] || pnpm --filter "@omnitech/agent-worker..." run build
    # Same values compose.yaml gives the web service, so payloads verify.
    DATABASE_URL="postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech" \
    AGENT_PAYLOAD_SECRET="${AGENT_PAYLOAD_SECRET:-docker-local-agent-payload-secret-change-me}" \
    AGENT_SERVICE_TOKEN="${AGENT_SERVICE_TOKEN:-docker-local-agent-service-token}" \
    PLATFORM_HTTP_URL="http://127.0.0.1:3000" \
    ACTIVE_SESSION_AGENT_PORT=on \
    ACTIVE_SESSION_AGENT_PROFILE="${ACTIVE_SESSION_AGENT_PROFILE:-claude}" \
    NODE_ENV=production \
      nohup pnpm --filter @omnitech/agent-worker run start >"$state.log" 2>&1 &
    echo $! >"$state.pid"
    echo "host worker started (pid $!), log: $state.log"
    ;;
  stop)
    if [ -f "$state.pid" ] && kill -0 "$(cat "$state.pid")" 2>/dev/null; then
      kill "$(cat "$state.pid")"; echo "host worker stopped"
    else echo "host worker not running"; fi
    rm -f "$state.pid"
    ;;
  status)
    if [ -f "$state.pid" ] && kill -0 "$(cat "$state.pid")" 2>/dev/null; then
      echo "host worker running (pid $(cat "$state.pid"))"
    else echo "host worker not running"; fi
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
