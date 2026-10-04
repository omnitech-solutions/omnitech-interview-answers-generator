// The build id the host baked in (see apps/web/next.config.ts): a short commit,
// "+" when the tree had uncommitted changes. "dev" when none was set.
export const BUILD_ID: string = process.env["NEXT_PUBLIC_BUILD_ID"] ?? "dev";
