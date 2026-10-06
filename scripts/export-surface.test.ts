// Per-package export surface (ADR-0003: one public entrypoint per runtime
// surface). For every workspace package that publishes an `exports` map this
// records how many entrypoints it has and how many names those entrypoint
// files export, and fails when
//   - a package gains an entrypoint or exports more names than recorded,
//   - an entrypoint adds an `export *` of another module that is not listed
//     (a barrel hides what the package really exposes), or
//   - an entrypoint named by `exports` has no source file.
// The table is configuration, not suppression: raise a count only with the
// review that grows the surface, and lower it when the surface shrinks (a
// recorded count above the real one is stale). Every extra entrypoint and
// every `export *` has a written reason.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { parse, repoRoot, walk } from "./guard-support";

interface SurfaceRow {
  entrypoints: number;
  names: number;
}

// An entrypoint beyond "." and a product's backend, frontend and manifest is a
// separate runtime surface a consumer can reach, so it needs a written reason.
// The key is the package name followed by the subpath.
const extraEntrypointReasons: Record<string, string> = {
  "@omnitech/capture-companion./fixture":
    "test-only: lets product conformance tests drive a real companion against the real backend; package-boundaries.test.ts confines importers to product tests",
  "@omnitech/ai-runtime./config":
    "env-driven model and agent-profile resolution kept apart from the gateway so a host reads configuration without constructing a provider",
  "@omnitech/database./test-support":
    "test-only: the disposable PostgreSQL fixture and its schema helpers; production code never imports it",
  "@omnitech/database./migrate":
    "migrations run from the host and worker start-up, not from request code, so connectivity and migration stay separate surfaces",
  "@omnitech/platform-storage./schema":
    "Drizzle table definitions the database package migrates; kept off the repository entrypoint so schema consumers do not load repositories",
  "@omnitech/platform-storage./worker":
    "cross-tenant agent job repository used only by apps/agent-worker (package-boundaries.test.ts)",
  "@omnitech/product-interview./assistant":
    "the Studio assistant adapter, prompts and workspace, mounted by the host's assistant route",
  "@omnitech/product-interview./session-worker":
    "the Active Session worker entry run inside apps/agent-worker, a separate runtime from the web backend",
  "@omnitech/product-interview./session-testing":
    "test-only today and shipped in dist (audit arch-10): the guard in scripts/test-exclusion.test.ts tracks removing it",
};

const surfaces: Record<string, SurfaceRow> = {
  "@omnitech/capture-companion": { entrypoints: 2, names: 75 },
  "@omnitech/active-session-contracts": { entrypoints: 1, names: 79 },
  "@omnitech/agent-job-service": { entrypoints: 1, names: 12 },
  "@omnitech/agent-runtime-claude": { entrypoints: 1, names: 2 },
  "@omnitech/agent-runtime-codex": { entrypoints: 1, names: 2 },
  "@omnitech/agent-runtime-contracts": { entrypoints: 1, names: 17 },
  "@omnitech/ai-contracts": { entrypoints: 1, names: 34 },
  "@omnitech/ai-provider-anthropic": { entrypoints: 1, names: 2 },
  "@omnitech/ai-provider-images": { entrypoints: 1, names: 11 },
  "@omnitech/ai-provider-openai": { entrypoints: 1, names: 4 },
  "@omnitech/ai-runtime": { entrypoints: 2, names: 13 },
  "@omnitech/code-runner": { entrypoints: 1, names: 3 },
  // +5 (T40): the boot-time pending-migration check, next to verifyDatabaseRole
  // (verifyMigrations, MigrationMismatchError, migrationStatus,
  // currentMigrationStatus, MigrationStatus).
  "@omnitech/database": { entrypoints: 3, names: 31 },
  "@omnitech/interview-api-client": { entrypoints: 1, names: 32 },
  "@omnitech/interview-answers-cli": { entrypoints: 1, names: 28 },
  // +2 (T24): liveCaptureDisplaySchema and LiveCaptureDisplay, the stored display label of a screenshot.
  // +8 (T22a, D35): the per-session "Screenshots to the model" setting
  // (LIVE_SCREENSHOT_SEND_MODES, liveScreenshotSendSchema, LiveScreenshotSend,
  // liveSessionScreenshotSendRequestSchema for its route body), what left the
  // device per screenshot (LIVE_SCREENSHOT_SENT, liveScreenshotSentSchema,
  // LiveScreenshotSent) and the bounded text-coverage numbers the shell
  // measures (liveOcrMetricsSchema; the metrics types ride with them).
  // +2 (T33): HIT_REGION_LIMITS and HitRegion (hit regions); recorded here by T32.
  // +2 (T32): STUDIO_HOST_FRONT_APP_MAX and StudioHostCaptureIntent (capture intent and the front app name).
  // The remaining growth of this release (T37 gives every name a reason):
  // - live-session.ts: LIVE_CODE_LIMITS, LiveCodeTest/liveCodeTestSchema and
  //   LiveCodeDiagnostic(+Schema) bound what a stored solve-code result keeps of
  //   the runner's report; LIVE_OCR_LIMITS, liveOcrBlockSchema/LiveOcrBlock bound
  //   and shape the on-device text of one image; LiveRevisionReason(+Schema) says
  //   why an owner-made task revision exists; liveTaskIdSchema is the one task-id
  //   alphabet every route accepts; liveTaskScreenshotsResponseSchema is the
  //   screenshots-of-a-task reply the client parses.
  // - studio-host.ts: the StudioHostDisplay* family (id, list and select
  //   results, isStudioHostDisplay/isStudioHostDisplayId), StudioHostImage and
  //   StudioHostOcr are the wire shapes of display choice and image/text
  //   capture, shared by the shell bridge and the browser host; displayLabel
  //   and isStudioHostDisplay turn a host display into the closed stored label
  //   and validate one off the wire.
  // - Four host types nothing outside the package used (StudioHostPinFallback,
  //   StudioHostOcrMetrics, StudioHostDisplayPreview,
  //   StudioHostTextRecognitionResult) are no longer exported: -4 (T37).
  // - LIVE_SCREENSHOT_SENT stays exported with its schema; no consumer outside
  //   the package reads the tuple yet (live-session.ts is another worker's file).
  "@omnitech/interview-contracts": { entrypoints: 1, names: 373 },
  "@omnitech/interview-library": { entrypoints: 1, names: 5 },
  "@omnitech/interview-playground-control": { entrypoints: 1, names: 16 },
  "@omnitech/interview-storage": { entrypoints: 1, names: 8 },
  "@omnitech/platform-api": { entrypoints: 1, names: 2 },
  "@omnitech/platform-contracts": { entrypoints: 1, names: 23 },
  "@omnitech/platform-integrations": { entrypoints: 1, names: 12 },
  "@omnitech/platform-runtime": { entrypoints: 1, names: 7 },
  "@omnitech/platform-storage": { entrypoints: 3, names: 38 },
  "@omnitech/product-interview": { entrypoints: 6, names: 83 },
  "@omnitech/product-presentation": { entrypoints: 3, names: 11 },
};

// Entrypoint source files that re-export whole modules with `export *`, and
// the modules they re-export, each with the reason a barrel is acceptable.
const exportStarReasons: ReadonlyArray<{
  file: string;
  modules: readonly string[];
  reason: string;
}> = [
  {
    file: "packages/database/src/test-support/index.ts",
    modules: ["./postgres", "./schema"],
    reason:
      "test-only entrypoint: the fixture's two modules are its whole surface",
  },
  {
    file: "packages/platform-api/src/index.ts",
    modules: ["./router"],
    reason: "the package is one router module; the barrel is that module",
  },
  {
    file: "packages/platform-integrations/src/index.ts",
    modules: ["./oauth"],
    reason: "the package is one OAuth module; the barrel is that module",
  },
  {
    file: "packages/platform-storage/src/index.ts",
    modules: [
      "./connected-account-vault",
      "./agent-job-repository",
      "./platform-repository",
      "./document-artifact-repository",
    ],
    reason:
      "the repository entrypoint is the union of its four repository modules; the counted names follow the barrel so growth still fails",
  },
  {
    file: "packages/platform-storage/src/schema/index.ts",
    modules: ["./ai", "./platform"],
    reason: "the schema entrypoint is the union of the two schema files",
  },
  {
    file: "products/interview/src/backend/assistant-entry.ts",
    modules: [
      "./assistant/adapter",
      "./assistant/prompt",
      "./assistant/workspace",
    ],
    reason: "the assistant entrypoint is the union of its three modules",
  },
  {
    file: "products/interview/src/backend/session-worker-entry.ts",
    modules: ["./live-session/worker-entry"],
    reason: "the worker entrypoint is the live-session worker module",
  },
];

interface Entrypoint {
  subpath: string;
  source: string | null;
}

interface PackageSurface {
  name: string;
  dir: string;
  entrypoints: Entrypoint[];
}

const target = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return target(record["import"] ?? record["default"] ?? record["types"]);
  }
  return null;
};

function packages(): PackageSurface[] {
  return ["apps", "packages", "products"].flatMap((root) =>
    walk(root, /^package\.json$/)
      .filter((file) => file.split("/").length === 3)
      .flatMap((file) => {
        const dir = file.replace(/\/package\.json$/, "");
        const manifest = JSON.parse(
          readFileSync(join(repoRoot, file), "utf8"),
        ) as { name: string; exports?: Record<string, unknown> };
        if (!manifest.exports) return [];
        const entrypoints = Object.entries(manifest.exports).flatMap(
          ([subpath, value]): Entrypoint[] => {
            const to = target(value);
            if (!to || !/\.(js|ts|tsx)$/.test(to)) return [];
            const candidates = to.startsWith("./dist/")
              ? [".ts", ".tsx"].map(
                  (ext) =>
                    `${dir}/${to.slice(2).replace("dist/", "src/").replace(/\.js$/, ext)}`,
                )
              : [`${dir}/${to.slice(2)}`];
            return [
              {
                subpath,
                source:
                  candidates.find((c) => existsSync(join(repoRoot, c))) ?? null,
              },
            ];
          },
        );
        return [{ name: manifest.name, dir, entrypoints }];
      }),
  );
}

interface FileSurface {
  names: Set<string>;
  // Modules the entrypoint file re-exports whole with `export *`.
  starModules: string[];
}

const sourceCandidates = (from: string, specifier: string) => {
  const base = `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
};

// Names a file exports, following relative `export *` so a barrel's real
// surface is counted rather than hidden.
function surfaceOf(file: string, seen = new Set<string>()): FileSurface {
  const source = parse(file);
  const names = new Set<string>();
  const starModules: string[] = [];
  seen.add(file);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!clause && statement.moduleSpecifier) {
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
        starModules.push(specifier);
        const resolved = specifier.startsWith(".")
          ? sourceCandidates(file, specifier).find((candidate) =>
              existsSync(join(repoRoot, candidate)),
            )
          : undefined;
        if (resolved && !seen.has(resolved))
          for (const name of surfaceOf(resolved, seen).names) names.add(name);
      } else if (clause && ts.isNamedExports(clause))
        for (const element of clause.elements) names.add(element.name.text);
      else if (clause && ts.isNamespaceExport(clause))
        names.add(clause.name.text);
    } else if (ts.isExportAssignment(statement)) names.add("default");
    else if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name))
            names.add(declaration.name.text);
        }
      else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name
      )
        names.add(statement.name.text);
    }
  }
  return { names, starModules };
}

const all = packages();
const measured = () =>
  all.map((pkg) => {
    const files = pkg.entrypoints.flatMap((entry) =>
      entry.source ? [{ entry, ...surfaceOf(entry.source) }] : [],
    );
    return {
      pkg,
      files,
      row: {
        entrypoints: pkg.entrypoints.length,
        names: new Set(files.flatMap((file) => [...file.names])).size,
      },
    };
  });

const standardSubpaths = new Set([
  ".",
  "./backend",
  "./frontend",
  "./manifest",
]);
const rounded = (value: number) => Math.max(3, Math.ceil(value * 0.1));

it("finds the packages with an exports map", () => {
  const names = all.map((pkg) => pkg.name);
  expect(names).toContain("@omnitech/database");
  expect(names).toContain("@omnitech/product-interview");
});

it("records every package, with no package left out and none removed", () => {
  expect(all.map((pkg) => pkg.name).sort()).toEqual(
    Object.keys(surfaces).sort(),
  );
});

it("gives every entrypoint a source file", () => {
  const missing = all.flatMap((pkg) =>
    pkg.entrypoints
      .filter((entry) => !entry.source)
      .map((entry) => `${pkg.name}${entry.subpath}: no source file`),
  );
  expect(missing).toEqual([]);
});

it("keeps each package's entrypoints and exported names within the record", () => {
  const violations = measured().flatMap(({ pkg, row }) => {
    const recorded = surfaces[pkg.name];
    if (!recorded) return [`${pkg.name}: not recorded`];
    return [
      ...(row.entrypoints > recorded.entrypoints
        ? [
            `${pkg.name}: ${row.entrypoints} entrypoints, ${recorded.entrypoints} recorded`,
          ]
        : []),
      ...(row.names > recorded.names
        ? [
            `${pkg.name}: ${row.names} exported names, ${recorded.names} recorded`,
          ]
        : []),
    ];
  });
  expect(
    violations,
    `A public surface grew. Narrow it, or raise the record in scripts/export-surface.test.ts in the change that grows it:\n${violations.join("\n")}`,
  ).toEqual([]);
});

it("keeps the record tight so a shrinking surface lowers it", () => {
  const stale = measured().flatMap(({ pkg, row }) => {
    const recorded = surfaces[pkg.name];
    if (!recorded) return [];
    return [
      ...(recorded.entrypoints > row.entrypoints
        ? [
            `${pkg.name}: record says ${recorded.entrypoints} entrypoints, found ${row.entrypoints}`,
          ]
        : []),
      ...(recorded.names > row.names + rounded(row.names)
        ? [
            `${pkg.name}: record says ${recorded.names} names, found ${row.names}`,
          ]
        : []),
    ];
  });
  expect(stale).toEqual([]);
});

it("explains every entrypoint beyond the standard ones", () => {
  const extra = all.flatMap((pkg) =>
    pkg.entrypoints
      .filter((entry) => !standardSubpaths.has(entry.subpath))
      .map((entry) => `${pkg.name}${entry.subpath}`),
  );
  expect(extra.filter((key) => !(key in extraEntrypointReasons))).toEqual([]);
  for (const key of Object.keys(extraEntrypointReasons)) {
    expect(extra, `${key} is no longer an entrypoint (stale reason)`).toContain(
      key,
    );
    expect(extraEntrypointReasons[key]?.length, key).toBeGreaterThan(30);
  }
});

it("lets an entrypoint re-export whole modules only where listed", () => {
  const found = measured().flatMap(({ files }) =>
    files
      .filter((file) => file.starModules.length > 0)
      .map((file) => ({
        file: file.entry.source ?? "",
        modules: file.starModules,
      })),
  );
  const unlisted = found.filter(
    (entry) =>
      !exportStarReasons.some(
        (allowed) =>
          allowed.file === entry.file &&
          entry.modules.every((module) => allowed.modules.includes(module)),
      ),
  );
  expect(
    unlisted.map(
      (entry) => `${entry.file}: export * from ${entry.modules.join(", ")}`,
    ),
    "Name the exports instead of `export *`, or list the barrel with a reason in scripts/export-surface.test.ts",
  ).toEqual([]);
  for (const allowed of exportStarReasons) {
    expect(allowed.reason.length, allowed.file).toBeGreaterThan(30);
    const live = found.find((entry) => entry.file === allowed.file);
    expect(
      live,
      `${allowed.file} no longer re-exports whole modules`,
    ).toBeDefined();
    expect(
      allowed.modules.every((module) => live?.modules.includes(module)),
      `${allowed.file} allowlist names a module it no longer re-exports`,
    ).toBe(true);
  }
});
