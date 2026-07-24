FROM node:22-alpine

WORKDIR /runner

RUN npm init --yes \
    && npm install --save-dev \
      @testing-library/jest-dom@6 \
      @testing-library/react@16 \
      @testing-library/user-event@14 \
      jsdom@26 \
      react@18 \
      react-dom@18 \
      typescript@5 \
      vitest@4

RUN mkdir -p /workspace \
    && ln -s /runner/node_modules /workspace/node_modules

WORKDIR /workspace
