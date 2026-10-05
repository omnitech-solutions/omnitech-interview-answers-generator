// apps/web stays a thin shell (AGENTS.md rule 3, ADR-0004): it wires the
// platform, the registered products and Next.js routes together, and owns no
// domain logic. Three mechanical limits, seeded with today's sizes:
//   (a) a file may not exceed MAX_FILE_LINES unless it is in the size
//       exemptions, each with a ceiling and the reason it is larger,
//   (b) no file imports a database driver or query builder, and
//   (c) no provider HTTP call (`fetch(...)`) is made in the shell except in
//       the files listed, each with a ceiling and a reason.
// The lists are configuration, not suppression: a new file over the limit, a
// grown ceiling or a new fetch call fails; a ceiling more than 25 percent
// above the real size, or an entry that matches nothing, is reported stale so
// the list shrinks as the shell does.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  importSites,
  isTestSupportPath,
  parse,
  repoRoot,
  walk,
} from "./guard-support.js";

const MAX_FILE_LINES = 150;

interface Ceiling {
  file: string;
  max: number;
  reason: string;
}

const sizeExemptions: readonly Ceiling[] = [
  {
    file: "apps/web/src/platform/ai.ts",
    max: 640,
    reason:
      "composes the AiExecutionGateway: model profiles, usage budgets and the image-provider adapters that still live in the shell; the audit schedules moving them behind ai-provider-images",
  },
  {
    file: "apps/web/src/platform/agent-api.ts",
    max: 290,
    reason:
      "the platform agent-job HTTP routes (profiles, create, events, cancel, resume); they resolve the tenant member and delegate to agent-job-service",
  },
  {
    file: "apps/web/src/platform/agent-models.ts",
    max: 250,
    reason:
      "maps the assistant's model parts to agent job requests; the one adapter between @omnitech-assistant/contracts and the agent job service",
  },
];

const fetchCeilings: readonly Ceiling[] = [
  {
    file: "apps/web/src/platform/ai.ts",
    max: 6,
    reason:
      "FAL, Together and ComfyUI image generation calls awaiting a move into packages/ai-provider-images; no new provider call may be added to the shell",
  },
  {
    file: "apps/web/src/platform/platform-shell.tsx",
    max: 2,
    reason:
      "the shell's client calls the platform's own same-origin API (preferences, context), never a provider",
  },
];

const forbiddenModules = new Set(["pg", "drizzle-orm", "drizzle-kit"]);

const webFiles = [
  ...walk("apps/web/src", /\.(ts|tsx)$/),
  ...walk("apps/web/app", /\.(ts|tsx)$/),
  ...["auth.ts", "instrumentation.ts", "instrumentation-node.ts"].map(
    (name) => `apps/web/${name}`,
  ),
].filter((file) => !isTestSupportPath(file));

const lines = (file: string) =>
  readFileSync(join(repoRoot, file), "utf8").trimEnd().split("\n").length;

function fetchCalls(file: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        (ts.isIdentifier(callee) && callee.text === "fetch") ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "fetch" &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "globalThis")
      )
        count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return count;
}

it("scans the shell's production files", () => {
  expect(webFiles).toContain("apps/web/src/platform/api.ts");
  expect(webFiles).toContain("apps/web/app/api/[[...route]]/route.ts");
  expect(webFiles.some((file) => file.endsWith(".test.ts"))).toBe(false);
});

it("keeps each shell file under the size limit unless exempted", () => {
  const ceilings = new Map(sizeExemptions.map((e) => [e.file, e.max]));
  const violations = webFiles
    .map((file) => [file, lines(file)] as const)
    .filter(([file, size]) => size > (ceilings.get(file) ?? MAX_FILE_LINES))
    .map(
      ([file, size]) =>
        `${file}: ${size} lines, ${ceilings.get(file) ?? MAX_FILE_LINES} allowed`,
    );
  expect(
    violations,
    `Move domain logic into a package or product (apps/web is a thin shell), or add a size exemption with a reason in scripts/web-thinness.test.ts:\n${violations.join("\n")}`,
  ).toEqual([]);
});

it("imports no database driver or query builder in the shell", () => {
  const violations = webFiles.flatMap((file) =>
    importSites(parse(file))
      .filter((site) => forbiddenModules.has(site.specifier))
      .map((site) => `${file}:${site.line} imports ${site.specifier}`),
  );
  expect(
    violations,
    "Data access belongs to a domain package's repository, not apps/web",
  ).toEqual([]);
});

it("makes no provider HTTP call in the shell beyond the recorded ones", () => {
  const ceilings = new Map(fetchCeilings.map((e) => [e.file, e.max]));
  const violations = webFiles
    .map((file) => [file, fetchCalls(file)] as const)
    .filter(([file, count]) => count > (ceilings.get(file) ?? 0))
    .map(
      ([file, count]) =>
        `${file}: ${count} fetch calls, ${ceilings.get(file) ?? 0} allowed`,
    );
  expect(
    violations,
    `Provider calls belong in an ai-provider-* package behind AiExecutionGateway:\n${violations.join("\n")}`,
  ).toEqual([]);
});

it("keeps every exemption real, reasoned and close to the real size", () => {
  const sized = (file: string) => lines(file);
  for (const entry of sizeExemptions) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(40);
    expect(webFiles, `${entry.file} no longer exists`).toContain(entry.file);
    expect(
      sized(entry.file),
      `${entry.file} is under the limit`,
    ).toBeGreaterThan(MAX_FILE_LINES);
    expect(
      entry.max,
      `${entry.file} ceiling is stale: lower it to about ${sized(entry.file)}`,
    ).toBeLessThanOrEqual(Math.ceil(sized(entry.file) * 1.25));
  }
  for (const entry of fetchCeilings) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(40);
    expect(
      fetchCalls(entry.file),
      `${entry.file} makes no fetch call: delete the entry`,
    ).toBeGreaterThan(0);
    expect(
      entry.max,
      `${entry.file} fetch ceiling is stale: lower it to ${fetchCalls(entry.file)}`,
    ).toBeLessThanOrEqual(fetchCalls(entry.file) + 1);
  }
});
