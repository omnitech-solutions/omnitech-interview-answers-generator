// `pnpm boundaries:update`: rewrites scripts/application-boundaries-debt.ts
// from the tree as it is now. It does nothing in an ordinary test run. Review
// the diff it makes: a number that fell is debt paid; a number that rose, or a
// new entry, is a violation someone added and is to be fixed, not accepted.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEBT, renderDebtFile, scanRepository } from "./application-boundaries";
import { repoRoot } from "./guard-support";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: set only by the boundaries:update script; an ordinary run skips this file's one test
const update = process.env.APPLICATION_BOUNDARIES_UPDATE === "1";

it.runIf(update)("rewrites the debt lists from the current tree", () => {
  const source = renderDebtFile(scanRepository());
  writeFileSync(join(repoRoot, DEBT), source);
  expect(source).toContain("export const rawForms");
});

it("renders every rule's list", () => {
  const source = renderDebtFile({ facts: new Map(), stylesheets: [] });
  expect(source.match(/^export const \w+: Debt = \{\};$/gm)).toHaveLength(8);
});
