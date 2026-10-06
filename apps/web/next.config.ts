import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// A visible build id (short commit, "+" when the tree has uncommitted changes),
// so anyone using a host can say which build they are running.
function buildId(): string {
  try {
    const run = (cmd: string) =>
      execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    const sha = run("git rev-parse --short HEAD");
    const dirty = run("git status --porcelain").length > 0 ? "+" : "";
    return `${sha}${dirty}`;
  } catch {
    return "dev";
  }
}

// [SAFETY] NX-SEC-01: a static baseline on every route. The microphone and
// display capture are what the live session uses (dictation, screen share), so
// they stay open to this origin only, which also covers the same-origin overlay
// frame the picture-in-picture window embeds; camera and location are never
// used. `frame-ancestors 'self'` is the only CSP directive on purpose: a full
// policy needs a nonce, dynamic rendering and allowances for the OCR worker,
// wasm and Mermaid, and is deferred.
const noSniff = { key: "X-Content-Type-Options", value: "nosniff" };
const securityHeaders = [
  noSniff,
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), geolocation=(), microphone=(self), display-capture=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
];

// A header set here replaces the same header a route sets itself (verified: the
// screenshot download lost its `sandbox` policy to the baseline's CSP). Two
// routes carry their own stricter policy, so they get only `nosniff` from here:
//   - the stored-screenshot download (CSP `sandbox`),
//   - the native sign-in completion page (its own CSP, no-referrer, DENY).
const NATIVE_COMPLETE = "api/native-auth/complete";
const SCREENSHOTS = "api/interview/t/[^/]+/sessions/[^/]+/screenshots/";
const BASELINE_SOURCE = `/((?!${NATIVE_COMPLETE}|${SCREENSHOTS}).*)`;
const SELF_PROTECTED_SOURCE = `/(${NATIVE_COMPLETE}|${SCREENSHOTS}.*)`;

const config: NextConfig = {
  poweredByHeader: false,
  headers: async () => [
    { source: BASELINE_SOURCE, headers: securityHeaders },
    { source: SELF_PROTECTED_SOURCE, headers: [noSniff] },
  ],
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
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
