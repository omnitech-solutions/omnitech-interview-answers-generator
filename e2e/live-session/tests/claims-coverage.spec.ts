// The rule of this suite, enforced: every interactive control of the live
// session is in the claims inventory (src/claims/claims.ts), and every inventory
// entry marked covered names a spec that exists. Pending entries are the
// worklist; they fail the run only with E2E_STRICT=1.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAIMS, findClaim, SPEC_DISAGREEMENTS } from "../src/claims/claims";
import {
  type Sightings,
  scanNative,
  scanSignIn,
  scanWeb,
} from "../src/claims/scan-states";
import { expect, test } from "../src/fixtures/test";

function specTitles(): string[] {
  const dir = join(import.meta.dirname, ".");
  const titles: string[] = [];
  for (const file of readdirSync(dir).filter((name) =>
    name.endsWith(".spec.ts"),
  ))
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(
      /\btest(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g,
    ))
      titles.push(match[2] as string);
  return titles;
}

function uninventoried(found: Sightings): string[] {
  const missing = new Map<string, Set<string>>();
  for (const control of found.found) {
    if (findClaim(found.surface, control.role, control.name)) continue;
    const key = `${found.surface}: ${control.role} "${control.name}"`;
    if (!missing.has(key)) missing.set(key, new Set());
    missing.get(key)?.add(control.state);
  }
  return [...missing].map(
    ([key, states]) => `${key} [${[...states].join(", ")}]`,
  );
}

test("claims inventory: every covered claim names a spec that exists", () => {
  const titles = specTitles();
  const broken = CLAIMS.filter(
    (claim) =>
      claim.status === "covered" &&
      !titles.some((title) => title.includes(claim.spec ?? "\u0000")),
  ).map((claim) => `${claim.id} -> "${claim.spec}"`);
  expect(broken, "covered claims whose spec title is missing").toEqual([]);
  expect(CLAIMS.filter((c) => c.status === "pending" && c.spec)).toEqual([]);
  expect(
    SPEC_DISAGREEMENTS,
    "a row's own spec and its COVERED_BY entry name different specs: keep one",
  ).toEqual([]);
  const ids = CLAIMS.map((claim) => claim.id);
  expect(new Set(ids).size, "claim ids are unique").toBe(ids.length);
});

test("claims inventory: pending claims are visible, and fail under E2E_STRICT=1", () => {
  const pending = CLAIMS.filter((claim) => claim.status === "pending");
  const bySurface = (surface: string) =>
    pending.filter((claim) => claim.surface === surface).length;
  console.log(
    `[claims] ${CLAIMS.length - pending.length}/${CLAIMS.length} covered; pending web ${bySurface("web")}, native ${bySurface("native")}`,
  );
  test.info().annotations.push({
    type: "pending-claims",
    description: `${pending.length}`,
  });
  if (process.env["E2E_STRICT"] === "1")
    expect(pending.map((claim) => claim.id)).toEqual([]);
});

test("claims inventory: every web control on the sign-in, setup, live and ended pages is inventoried", async ({
  page,
  browser,
  stack,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext();
  const signIn = await scanSignIn(context, stack);
  await context.close();
  const web = await scanWeb(page);
  expect(
    uninventoried({ surface: "web", found: [...signIn.found, ...web.found] }),
    "controls with no claim: add them to src/claims/claims.ts",
  ).toEqual([]);
});

test("claims inventory: every native panel control is inventoried", async ({
  browser,
  stack,
  control,
}) => {
  test.setTimeout(90_000);
  const native = await scanNative(browser, stack, control);
  expect(
    uninventoried(native),
    "controls with no claim: add them to src/claims/claims.ts",
  ).toEqual([]);
});
