FROM node:22-alpine
WORKDIR /runner
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN mkdir -p /workspace && ln -s /runner/node_modules /workspace/node_modules
WORKDIR /workspace
