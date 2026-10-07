// The dev build tag: short SHA and branch, shown ONLY on a build that is not
// packaged. The shell says what it was built from (studioHost.build); a shell
// that says nothing leaves the page's own build id (build-id.ts), which is
// treated as unpackaged, as the old footer showed it. Pure apart from the hook.
import {
  isStudioHostBuild,
  type StudioHostBuild,
} from "@omnitech/interview-contracts";
import { studioHostInfo } from "../host-adapter";
import { BUILD_ID } from "./build-id";

export const SHORT_SHA_LENGTH = 7;

export type BuildTag = {
  sha: string;
  branch: string | null;
  // "a1b2c3d · native-swap", or just the sha with no branch.
  label: string;
};

// A sha cut to its short form; a trailing "+" (uncommitted changes) is kept.
export function shortSha(sha: string): string {
  const dirty = sha.endsWith("+");
  const body = dirty ? sha.slice(0, -1) : sha;
  return `${body.slice(0, SHORT_SHA_LENGTH)}${dirty ? "+" : ""}`;
}

// The tag to draw, or null (a packaged build, or nothing known).
export function buildTagOf(
  build: StudioHostBuild | null,
  pageBuildId: string = BUILD_ID,
): BuildTag | null {
  const info: StudioHostBuild = build ?? {
    sha: pageBuildId,
    branch: null,
    isPackaged: false,
  };
  if (info.isPackaged) return null;
  const sha = shortSha(info.sha);
  return {
    sha,
    branch: info.branch,
    label: info.branch ? `${sha} · ${info.branch}` : sha,
  };
}

// The shell's build info, believed only when well formed.
export function hostBuild(): StudioHostBuild | null {
  const build = studioHostInfo()?.host.build;
  return isStudioHostBuild(build) ? build : null;
}
