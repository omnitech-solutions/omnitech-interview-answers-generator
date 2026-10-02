import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  // The dev badge would sit over Interview Studio's sidebar footer.
  devIndicators: false,
  // Server-only packages Node loads as they ship, rather than bundled.
  serverExternalPackages: [
    "esbuild",
    "pg",
    "pg-boss",
    "@omnitech-assistant/contracts",
    "@omnitech-assistant/server",
    "@omnitech-assistant/storage-postgres",
  ],
  // The open Playground polls its control channel twice a second; logging each
  // poll buries every other request in the terminal.
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/v1\/playground-control(?:[/?]|$)/],
    },
  },
  transpilePackages: [
    "@omnitech/platform-api",
    "@omnitech/platform-contracts",
    "@omnitech/platform-integrations",
    "@omnitech/platform-runtime",
    "@omnitech/platform-storage",
    "@omnitech/product-interview",
  ],
  turbopack: {
    // Watch this repository only; shared UI ships as a vendored package.
    root: new URL("../..", import.meta.url).pathname,
  },
};

export default config;
