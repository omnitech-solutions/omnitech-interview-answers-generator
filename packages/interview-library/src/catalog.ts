import type { LibraryItemInput } from "@omnitech/interview-contracts";

import { coreInterviewLibrarySeed } from "./seed.js";
import { laravelLibrarySeed } from "./seed-laravel.js";
import { phpLibrarySeed } from "./seed-php.js";
import { symfonyLibrarySeed } from "./seed-symfony.js";
import { withSeedUsageExample } from "./seed-usage.js";

export const interviewLibrarySeed: LibraryItemInput[] = [
  ...coreInterviewLibrarySeed,
  ...phpLibrarySeed,
  ...laravelLibrarySeed,
  ...symfonyLibrarySeed,
].map((item) =>
  withSeedUsageExample(
    ["react", "dsa"].includes(item.collection) &&
      !item.tags.includes("typescript")
      ? { ...item, tags: [...item.tags, "typescript"] }
      : item,
  ),
);
