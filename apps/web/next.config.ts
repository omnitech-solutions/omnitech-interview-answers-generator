import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["esbuild"],
  transpilePackages: [
    "@oc-tech/omni-ui-components",
    "@omnitech/platform-api",
    "@omnitech/platform-contracts",
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
