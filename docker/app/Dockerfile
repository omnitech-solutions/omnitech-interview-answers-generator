# syntax=docker/dockerfile:1
#
# Interview Studio's web app, agent worker and terminal gateway in ONE image,
# started with a different command per compose service (compose.yaml, profile
# `app`). Built from the repository root:
#
#   docker compose --profile app build
#
# It is a development-grade image: it keeps dev dependencies (the migration and
# bootstrap commands run through tsx) and runs a production build of the web app.
# Nothing secret is baked in (.dockerignore); every setting arrives at run time.

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/opt/corepack \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
    NEXT_TELEMETRY_DISABLED=1

# psql: the one-shot setup step applies docker/postgres/ensure-roles.sql with it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10.33.3 --activate \
 && mkdir -p /app /data /pnpm \
 && chown -R node:node /app /data /pnpm /opt/corepack

USER node
WORKDIR /app

COPY --chown=node:node . .

# The lockfile is the source of truth: a drifting manifest fails the build.
# --ignore-scripts: the only script that would run is the root `prepare`
# (`lefthook install`), which needs a git checkout; the repository already
# denies every dependency's build script (pnpm-workspace.yaml).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --ignore-scripts

# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so the
# local sign-in flag the sign-in page reads must be fixed here.
ARG NEXT_PUBLIC_FAKE_AUTH_ENABLED=true
ENV NEXT_PUBLIC_FAKE_AUTH_ENABLED=$NEXT_PUBLIC_FAKE_AUTH_ENABLED
RUN pnpm build

# The JSON answer repository and the library records live on a volume.
ENV INTERVIEW_DATA_DIR=/data
VOLUME /data
EXPOSE 3000 3001
CMD ["pnpm", "--filter", "@omnitech/interview-web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
