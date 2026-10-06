#!/bin/sh
# Starts the loopback forwarder to LM Studio on the host (see forward.mjs) when the
# compose file asks for one, then runs the service's own command.
set -eu
if [ -n "${LM_STUDIO_FORWARD:-}" ]; then
  node /app/docker/app/forward.mjs &
fi
exec "$@"
