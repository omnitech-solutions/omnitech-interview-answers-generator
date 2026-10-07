// Line coverage of the Swift cores, measured by running each test harness built
// with LLVM profiling (the Command Line Tools have no XCTest or `swift test
// --enable-code-coverage`, so the harness executables are the tests).
//   node scripts/swift-coverage.mjs
// Each harness builds in its own `.build-cov` scratch path (gitignored) so the
// instrumented build never disturbs the normal `.build`. FAILS when a target's
// line coverage is below THRESHOLD. Skips only off macOS.
//
// Unmeasured by design: the AppKit/WebKit target `apps/studio-shell/Sources/studio-shell`
// (excluding Engine/) has no harness; it is window, menu and WebView wiring with
// no seam a test can drive without a display, so it is neither measured nor faked.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const THRESHOLD = 80;

// Nothing is excluded: the measured sources are everything under the listed
// directories. Known gaps (no harness drives them; real system or WebView
// integration): Engine/SystemCompanionRun.swift 0%, Engine/WebViewOwnerRoutes.swift 0%,
// Engine/EngineBridge.swift ~37%, Engine/StudioWebFetch.swift 50%.

const targets = [
  {
    name: "CaptureCore",
    cwd: "apps/capture-companion/macos",
    product: "capture-core-tests",
    sources: ["Sources/CaptureCore"],
  },
  {
    name: "StudioShellCore + Engine",
    cwd: "apps/studio-shell",
    product: "studio-shell-tests",
    sources: ["Sources/StudioShellCore", "Sources/studio-shell/Engine"],
  },
];

if (process.platform !== "darwin") {
  console.log("swift-coverage skipped: not macOS");
  process.exit(0);
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
  if (result.status !== 0) {
    console.error(`swift-coverage failed: ${command} ${args.slice(0, 3).join(" ")}\n${result.stderr ?? ""}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
};

const swiftFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? swiftFiles(join(dir, entry.name))
      : entry.name.endsWith(".swift")
        ? [join(dir, entry.name)]
        : [],
  );

let failed = false;
for (const target of targets) {
  const cwd = join(root, target.cwd);
  const scratch = join(cwd, ".build-cov");
  const build = ["build", "--scratch-path", ".build-cov", "--product", target.product];
  const instrument = ["-Xswiftc", "-profile-generate", "-Xswiftc", "-profile-coverage-mapping"];
  console.log(`swift-coverage: building ${target.product} instrumented`);
  run("swift", [...build, ...instrument], { cwd, stdio: ["ignore", "ignore", "inherit"] });
  const binary = join(run("swift", [...build.slice(0, 3), "--show-bin-path"], { cwd }).trim(), target.product);

  const profiles = join(scratch, "profiles");
  rmSync(profiles, { recursive: true, force: true });
  mkdirSync(profiles, { recursive: true });
  console.log(`swift-coverage: running ${target.product}`);
  run(binary, [], { cwd, env: { ...process.env, LLVM_PROFILE_FILE: join(profiles, "%p.profraw") }, stdio: ["ignore", "ignore", "inherit"] });
  const profdata = join(profiles, "merged.profdata");
  const raws = readdirSync(profiles).filter((name) => name.endsWith(".profraw")).map((name) => join(profiles, name));
  run("xcrun", ["llvm-profdata", "merge", "-sparse", ...raws, "-o", profdata]);

  const files = target.sources
    .flatMap((dir) => swiftFiles(join(cwd, dir)));

  const summary = JSON.parse(
    run("xcrun", ["llvm-cov", "export", "-summary-only", binary, `-instr-profile=${profdata}`, ...files]),
  ).data[0];

  console.log(`\n${target.name}: per-file line coverage below 100%`);
  for (const file of summary.files.sort((a, b) => a.summary.lines.percent - b.summary.lines.percent)) {
    const { percent, covered, count } = file.summary.lines;
    if (percent < 100) console.log(`  ${percent.toFixed(1).padStart(5)}%  ${covered}/${count}  ${relative(root, file.filename)}`);
  }
  const { percent, covered, count } = summary.totals.lines;
  const ok = percent >= THRESHOLD;
  console.log(`${target.name}: ${percent.toFixed(2)}% lines (${covered}/${count}) ${ok ? "ok" : `FAIL: below ${THRESHOLD}%`}\n`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
