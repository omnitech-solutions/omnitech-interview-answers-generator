// The build the host baked in (see apps/web/next.config.ts). Next inlines each
// NEXT_PUBLIC_* reference literally, so every name is written out in full.
//   id        short commit, "+" when the tree had uncommitted changes ("dev" if none)
//   sha       the full commit (the footer tag's tooltip and what it copies)
//   branch    the branch the build came from ("" when unknown)
//   packaged  a packaged app build: no developer tag is shown there
export const BUILD_ID: string = process.env["NEXT_PUBLIC_BUILD_ID"] ?? "dev";

export const BUILD: {
  id: string;
  sha: string;
  branch: string;
  packaged: boolean;
} = {
  id: BUILD_ID,
  sha: process.env["NEXT_PUBLIC_BUILD_SHA"] || BUILD_ID,
  branch: process.env["NEXT_PUBLIC_BUILD_BRANCH"] ?? "",
  packaged: process.env["NEXT_PUBLIC_BUILD_PACKAGED"] === "1",
};
