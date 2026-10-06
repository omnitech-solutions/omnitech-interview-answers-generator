#!/bin/sh
# The two host-side services of the Docker stack, run on THIS Mac:
#
#  - the agent worker. Claude Code (and Codex) are signed-in command-line tools: the
#    credentials live in your login Keychain, so they cannot work inside a container,
#    and ADR-0007 keeps agents out of the web process.
#  - the code runner. Running tests needs Docker, which a container cannot reach (no
#    Docker socket is mounted, on purpose). The web app calls this service instead.
#
# Both use the same database and shared secrets as the containers.
#
#   scripts/docker-host-services.sh start | stop | status
set -eu
cd "$(dirname "$0")/.."

state=".dev-local/host"
mkdir -p .dev-local

[ -f .env ] && { set -a; . ./.env; set +a; }
RUNNER_TOKEN="${CODE_RUNNER_TOKEN:-docker-local-code-runner-token-change-me}"

# Stop a process AND its children: the pnpm wrapper does not reliably stop the node
# process it started, and an orphaned worker keeps claiming sessions with old code.
kill_tree() { for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done; kill "$1" 2>/dev/null || true; }

alive() { [ -f "$1.pid" ] && kill -0 "$(cat "$1.pid")" 2>/dev/null; }

start_worker() {
  alive "$state-worker" && { echo "worker already running (pid $(cat "$state-worker.pid"))"; return; }
  command -v claude >/dev/null || { echo "claude CLI not found on PATH: install Claude Code and sign in" >&2; exit 1; }
  # Always build first (turbo skips what is unchanged): a worker started from an old
  # bundle runs old prompts and an old question gate.
  pnpm --filter "@omnitech/agent-worker..." run build >/dev/null
  # Same values compose.yaml gives the web service, so payloads verify. The worker
  # runs session tests in Docker directly, as it is on the host.
  DATABASE_URL="postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech" \
  AGENT_PAYLOAD_SECRET="${AGENT_PAYLOAD_SECRET:-docker-local-agent-payload-secret-change-me}" \
  AGENT_SERVICE_TOKEN="${AGENT_SERVICE_TOKEN:-docker-local-agent-service-token}" \
  PLATFORM_HTTP_URL="http://127.0.0.1:3000" \
  ACTIVE_SESSION_AGENT_PORT=on \
  ACTIVE_SESSION_AGENT_PROFILE="${ACTIVE_SESSION_AGENT_PROFILE:-claude}" \
  ACTIVE_SESSION_CODE_RUNNER="${ACTIVE_SESSION_CODE_RUNNER:-docker}" \
  ACTIVE_SESSION_RUNNER_DEVICE_LOCAL=true \
  NODE_ENV=production \
    nohup pnpm --filter @omnitech/agent-worker run start >"$state-worker.log" 2>&1 &
  echo $! >"$state-worker.pid"
  echo "worker started (pid $!), log: $state-worker.log"
}

start_runner() {
  alive "$state-runner" && { echo "runner already running (pid $(cat "$state-runner.pid"))"; return; }
  command -v docker >/dev/null || { echo "docker not found: the code runner needs Docker Desktop" >&2; return; }
  # Plain Node cannot load the workspace sources, so the service is bundled like the
  # worker (with the worker's esbuild), into the ignored .dev-local folder.
  (cd apps/agent-worker && node ../../scripts/bundle-node-app.mjs \
    ../../packages/code-runner/src/host-main.ts ../../.dev-local/host-runner.mjs) >/dev/null
  CODE_RUNNER_TOKEN="$RUNNER_TOKEN" nohup node .dev-local/host-runner.mjs >"$state-runner.log" 2>&1 &
  echo $! >"$state-runner.pid"
  echo "runner started (pid $!), log: $state-runner.log"
}

stop_one() {
  if alive "$state-$1"; then kill_tree "$(cat "$state-$1.pid")"; echo "$1 stopped"; else echo "$1 not running"; fi
  rm -f "$state-$1.pid"
}

show() { if alive "$state-$1"; then echo "$1 running (pid $(cat "$state-$1.pid"))"; else echo "$1 not running"; fi; }

case "${1:-status}" in
  start) start_worker; start_runner ;;
  stop) stop_one worker; stop_one runner ;;
  status) show worker; show runner ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
