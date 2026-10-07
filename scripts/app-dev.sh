#!/bin/sh
# Hot-reload mode for the Docker stack: `pnpm app:dev`.
#
# Stops only the Docker `web` container and runs the web app with `next dev` on the
# host, on the same 127.0.0.1:3000 the native shell loads. Postgres, the terminal
# gateway and the host services (agent worker, code runner) keep running as
# `pnpm app:up` left them. Unlike `pnpm dev` it starts no gateway or worker of its
# own (they would clash with those) and never touches LM Studio or loads a model.
# Ctrl-C stops it; `pnpm app:up` puts the Docker web container back.
#
# Settings mirror compose.yaml's `x-app-environment`, so sessions and data signed in
# under Docker keep working. Documents the web app stores go to .dev-local/data
# (the Docker volume is not reachable from the host).
set -eu
cd "$(dirname "$0")/.."

docker compose --profile app stop web
mkdir -p .dev-local/data

# The web app loads every workspace package (and the interview product) from its
# dist: build the graph once, then keep it current while you edit.
pnpm --filter "@omnitech/interview-web^..." build
pnpm exec tsc -b tsconfig.json --watch --preserveWatchOutput &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT INT TERM

NODE_ENV=development \
DATABASE_URL="postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech" \
AUTH_SECRET="${AUTH_SECRET:-docker-local-auth-secret-change-before-sharing-0123456789}" \
AGENT_PAYLOAD_SECRET="${AGENT_PAYLOAD_SECRET:-docker-local-agent-payload-secret-change-me}" \
AGENT_SERVICE_TOKEN="${AGENT_SERVICE_TOKEN:-docker-local-agent-service-token}" \
FAKE_AUTH_ENABLED="${FAKE_AUTH_ENABLED:-true}" \
NEXT_PUBLIC_FAKE_AUTH_ENABLED="${NEXT_PUBLIC_FAKE_AUTH_ENABLED:-true}" \
AUTH_ASSUME_LOOPBACK_CLIENTS=true \
INTERVIEW_ASSISTANT_DEFAULT_MODEL="${INTERVIEW_ASSISTANT_DEFAULT_MODEL:-agent/claude-code}" \
CLAUDE_ASSISTANT_MODEL="${CLAUDE_ASSISTANT_MODEL:-claude-sonnet-5-5}" \
CODE_RUNNER_URL=http://127.0.0.1:3002 \
CODE_RUNNER_TOKEN="${CODE_RUNNER_TOKEN:-docker-local-code-runner-token-change-me}" \
INTERVIEW_DATA_DIR="$PWD/.dev-local/data" \
PLATFORM_HTTP_URL=http://127.0.0.1:3000 \
TERMINAL_GATEWAY_PORT=3001 \
TERMINAL_GATEWAY_ALLOWED_ORIGINS="http://127.0.0.1:3000,http://localhost:3000" \
  pnpm --filter @omnitech/interview-web run dev --port 3000
