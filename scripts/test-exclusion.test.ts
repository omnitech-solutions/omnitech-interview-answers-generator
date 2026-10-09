// Tests stay out of what ships (ADR-0003, test-boundary hygiene; audit
// arch-10). Two mechanical rules for every workspace package:
//   (a) a package built with `tsc -b` excludes `*.test.ts(x)` from its build
//       tsconfig, so tests are not emitted into dist. A package that still
//       emits them is listed with the reason, and the list shrinks as each
//       package gets a build config that excludes tests and a typecheck
//       config that does not (see products/interview for the pattern).
//   (b) no file reachable from a package's runtime entrypoints imports a test
//       framework (vitest, Testing Library, jsdom). The test-only entrypoints
//       a package publishes on purpose are listed with the reason.
// The lists are configuration with reasons, not suppressions; an entry that no
// longer applies fails the test.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  importSites,
  packageNameOf,
  parse,
  repoRoot,
  walk,
} from "./guard-support";

const stillEmitsTests =
  "its build tsconfig still includes src/**/*.test.ts, so tests are emitted into dist; it needs a build config that excludes them plus a typecheck config that does not (pattern: products/interview)";
const emitsTests: readonly string[] = [
  "apps/capture-companion",
  "packages/active-session-contracts",
  "packages/code-runner",
  "packages/database",
  "packages/interview-api-client",
  "packages/interview-contracts",
  "packages/interview-library",
  "packages/interview-storage",
  "packages/platform-api",
  "packages/platform-contracts",
  "packages/platform-integrations",
  "packages/platform-runtime",
  "packages/platform-storage",
  "products/presentation",
];

// Published entrypoints that are test support on purpose.
const testOnlyEntrypoints: ReadonlyArray<{
  package: string;
  subpath: string;
  reason: string;
}> = [
  {
    package: "apps/capture-companion",
    subpath: "./fixture",
    reason:
      "a scripted companion for product conformance tests; only product test files may import it (package-boundaries.test.ts)",
  },
  {
    package: "packages/database",
    subpath: "./test-support",
    reason:
      "the disposable PostgreSQL fixture; production code never imports it",
  },
  {
    package: "products/interview",
    subpath: "./session-testing",
    reason:
      "the in-memory session world the agent worker's end-to-end tests drive; no production host imports it",
  },
];

const testFrameworks = (specifier: string) =>
  specifier === "vitest" ||
  specifier === "jsdom" ||
  packageNameOf(specifier) === "@testing-library/react" ||
  packageNameOf(specifier) === "@testing-library/jest-dom" ||
  packageNameOf(specifier) === "@testing-library/user-event";

interface Pkg {
  dir: string;
  buildsWithTsc: boolean;
  entrypoints: Array<{ subpath: string; source: string }>;
}

const target = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? target(
          (value as Record<string, unknown>)["import"] ??
            (value as Record<string, unknown>)["default"],
        )
      : null;

function packages(): Pkg[] {
  return ["apps", "packages", "products"].flatMap((root) =>
    walk(root, /^package\.json$/)
      .filter((file) => file.split("/").length === 3)
      .map((file) => {
        const dir = file.replace(/\/package\.json$/, "");
        const manifest = JSON.parse(
          readFileSync(join(repoRoot, file), "utf8"),
        ) as {
          scripts?: Record<string, string>;
          exports?: Record<string, unknown>;
        };
        const entrypoints = Object.entries(manifest.exports ?? {}).flatMap(
          ([subpath, value]) => {
            const to = target(value);
            if (!to?.startsWith("./dist/")) return [];
            const source = [".ts", ".tsx"]
              .map(
                (ext) =>
                  `${dir}/${to.slice(2).replace("dist/", "src/").replace(/\.js$/, ext)}`,
              )
              .find((candidate) => existsSync(join(repoRoot, candidate)));
            return source ? [{ subpath, source }] : [];
          },
        );
        return {
          dir,
          buildsWithTsc: manifest.scripts?.["build"] === "tsc -b",
          entrypoints,
        };
      }),
  );
}

function excludesTests(dir: string): boolean {
  const read = ts.readConfigFile(
    join(repoRoot, dir, "tsconfig.json"),
    ts.sys.readFile,
  );
  const exclude = (read.config?.exclude ?? []) as string[];
  return exclude.some((pattern) => /\.test\.(ts|\*|tsx)/.test(pattern));
}

const resolveRelative = (from: string, specifier: string): string | null => {
  const base = `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`.replace(
    /\/\.\//g,
    "/",
  );
  const normalised = base
    .split("/")
    .reduce<string[]>((parts, part) => {
      if (part === "..") parts.pop();
      else parts.push(part);
      return parts;
    }, [])
    .join("/");
  return (
    [`${normalised}.ts`, `${normalised}.tsx`, `${normalised}/index.ts`].find(
      (candidate) => existsSync(join(repoRoot, candidate)),
    ) ?? null
  );
};

// Every file reachable from `entry` through relative imports.
function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, entry]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const site of importSites(parse(file))) {
      if (!site.specifier.startsWith(".")) continue;
      const next = resolveRelative(file, site.specifier);
      if (next && !seen.has(next)) {
        seen.set(next, file);
        queue.push(next);
      }
    }
  }
  return seen;
}

const all = packages();

it("finds the packages it scans", () => {
  expect(all.map((pkg) => pkg.dir)).toContain("products/interview");
  // Nine fewer since the AI packages went into the AI engine (ADR-0037).
  expect(all.filter((pkg) => pkg.buildsWithTsc).length).toBeGreaterThan(10);
  // The import walk really follows the product's graph.
  expect(
    reachable("products/interview/src/backend/index.ts").size,
  ).toBeGreaterThan(20);
});

it("excludes tests from every tsc build that is not listed", () => {
  const offenders = all
    .filter((pkg) => pkg.buildsWithTsc && !excludesTests(pkg.dir))
    .map((pkg) => pkg.dir)
    .filter((dir) => !emitsTests.includes(dir))
    .map((dir) => `${dir}/tsconfig.json emits its tests into dist`);
  expect(
    offenders,
    "Exclude src/**/*.test.ts(x) from the build tsconfig and type-check with a separate config (pattern: products/interview/tsconfig.typecheck.json)",
  ).toEqual([]);
});

it("keeps the emits-tests list real", () => {
  expect(stillEmitsTests.length).toBeGreaterThan(40);
  for (const dir of emitsTests) {
    const pkg = all.find((candidate) => candidate.dir === dir);
    expect(pkg?.buildsWithTsc, `${dir} no longer builds with tsc -b`).toBe(
      true,
    );
    expect(
      excludesTests(dir),
      `${dir} now excludes tests: delete the entry`,
    ).toBe(false);
  }
});

it("keeps test frameworks unreachable from runtime entrypoints", () => {
  const testOnly = new Set(
    testOnlyEntrypoints.map((entry) => `${entry.package}${entry.subpath}`),
  );
  const violations: string[] = [];
  for (const pkg of all) {
    for (const entry of pkg.entrypoints) {
      if (testOnly.has(`${pkg.dir}${entry.subpath}`)) continue;
      for (const [file, importer] of reachable(entry.source)) {
        for (const site of importSites(parse(file))) {
          if (testFrameworks(site.specifier) && !site.typeOnly)
            violations.push(
              `${file}:${site.line} imports ${site.specifier}, reachable from ${pkg.dir} ${entry.subpath} (via ${importer})`,
            );
        }
      }
    }
  }
  expect(
    violations,
    "A runtime entrypoint reaches test-framework code: move the fixture out of the production import graph",
  ).toEqual([]);
});

it("keeps the test-only entrypoint list real and reasoned", () => {
  for (const entry of testOnlyEntrypoints) {
    expect(entry.reason.length, entry.subpath).toBeGreaterThan(30);
    const pkg = all.find((candidate) => candidate.dir === entry.package);
    expect(
      pkg?.entrypoints.some((candidate) => candidate.subpath === entry.subpath),
      `${entry.package}${entry.subpath} is no longer an entrypoint`,
    ).toBe(true);
  }
});
