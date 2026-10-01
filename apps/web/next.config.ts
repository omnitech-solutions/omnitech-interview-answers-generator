import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  serverExternalPackages: ["esbuild"],
  transpilePackages: [
    "@oc-tech/omni-ui-components",
    "@omnitech/platform-api",
    "@omnitech/platform-contracts",
    "@omnitech/platform-integrations",
    "@omnitech/platform-runtime",
    "@omnitech/platform-storage",
    "@omnitech/product-interview",
  ],
  turbopack: {
    // The shared UI package is a sibling of this repository.
    root: new URL("../../..", import.meta.url).pathname,
  },
};

export default config;
