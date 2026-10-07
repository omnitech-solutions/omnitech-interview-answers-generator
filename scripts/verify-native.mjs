// The native half of `pnpm verify`: builds the Swift packages and runs their
// test harnesses (the Command Line Tools toolchain has no XCTest, so each suite
// is an executable), after the swift-format and SwiftLint gates. Skips with a
// clear message off macOS or without `swift`; a failed gate, build or test
// exits non-zero.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["apps/studio-shell", ["build"]],
  ["apps/studio-shell", ["run", "studio-shell-tests"]],
  ["apps/capture-companion/macos", ["build"]],
  ["apps/capture-companion/macos", ["run", "capture-core-tests"]],
];

if (process.platform !== "darwin") {
  console.log("verify-native skipped: not macOS");
  process.exit(0);
}
if (spawnSync("swift", ["--version"], { stdio: "ignore" }).status !== 0) {
  console.log("verify-native skipped: no swift toolchain on PATH");
  process.exit(0);
}

// Style gates first: they are quick and fail before the slow builds.
for (const gate of ["swift-format.mjs", "swiftlint.mjs"]) {
  console.log(`verify-native: node scripts/${gate}`);
  const run = spawnSync("node", [join(root, "scripts", gate)], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`verify-native failed: scripts/${gate}`);
    process.exit(run.status ?? 1);
  }
}

for (const [dir, args] of steps) {
  console.log(`verify-native: (cd ${dir} && swift ${args.join(" ")})`);
  const run = spawnSync("swift", args, { cwd: join(root, dir), stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`verify-native failed: swift ${args.join(" ")} in ${dir}`);
    process.exit(run.status ?? 1);
  }
}
console.log("verify-native: ok");
