import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["esbuild"],
  transpilePackages: ["@omnitech/omni-ui-core"],
  turbopack: {
    // The shared UI package is a sibling of this repository.
    root: new URL("../../..", import.meta.url).pathname,
  },
};

export default config;
