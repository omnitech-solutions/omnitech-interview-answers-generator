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
    "@omnitech-assistant/providers",
    "@omnitech-assistant/server",
    "@omnitech-assistant/storage-postgres",
  ],
  // No line per request: the Studio and the Playground poll constantly, which
  // buried every warning and error in an endless stream. Errors still print.
  logging: { incomingRequests: false },
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
    // The on-device model's runtime lazily imports optional search and speech
    // packages; the assistant only chats, so they resolve to an empty module.
    resolveAlias: {
      "@omnitech/local-search": "./src/platform/optional-module-stub.ts",
      "@omnitech/local-audio": "./src/platform/optional-module-stub.ts",
    },
  },
};

export default config;
