import type { LibraryItemInput } from "@omnitech/interview-contracts";

import { coreInterviewLibrarySeed } from "./seed";
import { laravelLibrarySeed } from "./seed-laravel";
import { phpLibrarySeed } from "./seed-php";
import { symfonyLibrarySeed } from "./seed-symfony";
import { withSeedUsageExample } from "./seed-usage";
import { webStackLibrarySeed } from "./seed-web-stack";

export const interviewLibrarySeed: LibraryItemInput[] = [
  ...coreInterviewLibrarySeed,
  ...phpLibrarySeed,
  ...laravelLibrarySeed,
  ...symfonyLibrarySeed,
  ...webStackLibrarySeed,
].map((item) =>
  withSeedUsageExample(
    ["react", "dsa"].includes(item.collection) &&
      !item.tags.includes("typescript")
      ? { ...item, tags: [...item.tags, "typescript"] }
      : item,
  ),
);
