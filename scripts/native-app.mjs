// Keeps the native Mac app (Interview Studio, apps/studio-shell) up to date
// with its Swift sources. `pnpm dev` runs this beside the servers through
// scripts/dev-native.mjs; `pnpm dev:native` runs it once by hand.
//
// Two steps with different risks:
//   compile  `swift build` into .build/release. Slow (seconds to a minute),
//            and safe at any time: nothing a running app uses is touched.
//   apply    bundle, sign and copy over the installed app. About a second, and
//            it replaces the files of the app, so it never happens while the
//            app is running (the person may be in a live call).
// A fingerprint of everything the bundle is made from is kept in a stamp
// (.dev-local/native-app/stamp.json), so a run with nothing changed reads the
// sources once and stops.
//
// The decisions are plain functions over injected effects, so they are tested
// without Swift, a bundle or a running app (scripts/native-app.test.ts).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What is built, from what, and where it lands. Paths are repository-relative. */
export const nativeApp = {
  name: "Interview Studio",
  // Everything the bundle is made from. The shell compiles the capture
  // companion's modules by path (Package.swift), so its sources count; tests
  // are not part of the product and do not.
  inputs: [
    "apps/studio-shell/Package.swift",
    "apps/studio-shell/Package.resolved",
    "apps/studio-shell/Sources",
    "apps/studio-shell/scripts/bundle-app.sh",
    "apps/capture-companion/macos/Package.swift",
    "apps/capture-companion/macos/Sources",
  ],
  // Folders watched during a dev session (a change only triggers a new
  // fingerprint, so watching too much costs nothing), less the build output.
  watch: ["apps/studio-shell", "apps/capture-companion/macos"],
  unwatched: /^(\.build|\.build-cov|Tests)(\/|$)/,
  packageDir: "apps/studio-shell",
  // Only the app's product: a broken test target must not stop the app.
  // `nice` leaves the processors to the web build that runs beside it.
  compile: [
    "nice",
    ["-n", "10", "swift", "build", "-c", "release", "--product", "studio-shell"],
  ],
  binary: "apps/studio-shell/.build/release/studio-shell",
  // Bundles and signs with the stable designated requirement that keeps the
  // macOS privacy grants across rebuilds (see the script).
  bundleCommand: ["sh", ["scripts/bundle-app.sh"]],
  bundle: "apps/studio-shell/.build/InterviewStudioShell.app",
  // The copy the person opens. Refreshed only when it is already there: the
  // task never puts an app on a machine that did not install one.
  installed: join(homedir(), "Applications", "Interview Studio.app"),
  // The process name of the app, wherever its bundle was opened from.
  processName: "studio-shell",
  stamp: ".dev-local/native-app/stamp.json",
  log: ".dev-local/native-app/build.log",
  rerun: "pnpm dev:native",
};

const files = (path) => {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) return [path];
  return readdirSync(path)
    .filter((name) => name !== ".DS_Store")
    .sort()
    .flatMap((name) => files(join(path, name)));
};

/**
 * A hash of the inputs' paths and contents, and of the build recipe. Contents,
 * not modification times: a checkout or a formatter that rewrites a file with
 * the same bytes is not a change. A missing input is simply absent.
 */
export function fingerprint(root, app = nativeApp) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([app.compile, app.bundleCommand]));
  for (const input of app.inputs)
    for (const file of files(join(root, input))) {
      hash.update(`\0${file.slice(root.length)}\0`);
      hash.update(readFileSync(file));
    }
  return hash.digest("hex");
}

/** Why this host does no native work at all, or undefined when it may. */
export function skipReason(environment, platform) {
  if ((environment.DEV_NATIVE_BUILD ?? "").trim().toLowerCase() === "off")
    return "switched off (DEV_NATIVE_BUILD=off)";
  if (platform !== "darwin") return "not macOS";
  return undefined;
}

/**
 * What a run has to do. `compiled` and `applied` are the fingerprints the
 * stamp recorded for each step.
 */
export function plan({ current, stamp, binaryExists, bundleExists }) {
  const compile = stamp.compiled !== current || !binaryExists;
  return {
    compile,
    apply: compile || stamp.applied !== current || !bundleExists,
  };
}

/**
 * One pass: compile if the sources changed, then apply unless the app is
 * running. Never throws for a failed build and never stops or starts the app.
 * Returns `{ outcome, lines }`; the caller prints the lines.
 *   off | skipped | current | applied | restart-needed | failed
 */
export async function runOnce(effects, app = nativeApp) {
  const off = skipReason(effects.environment, effects.platform);
  if (off) return { outcome: "off", lines: [`skipped: ${off}.`] };

  const current = effects.fingerprint();
  const stamp = effects.readStamp();
  const todo = plan({
    current,
    stamp,
    binaryExists: effects.exists(app.binary),
    bundleExists: effects.exists(app.bundle),
  });
  if (!todo.apply)
    return { outcome: "current", lines: [`${app.name} is up to date.`] };

  const lines = [];
  const failed = (step, detail) => ({
    outcome: "failed",
    lines: [
      ...lines,
      `${step} FAILED; pnpm dev carries on and ${app.name} stays as it was.`,
      ...detail.map((line) => `  ${line}`),
      `full output: ${app.log}; fix the Swift error, then rerun: ${app.rerun}`,
    ],
  });

  if (todo.compile) {
    if (!effects.hasSwift())
      return {
        outcome: "skipped",
        lines: ["skipped: no swift toolchain on PATH (xcode-select --install)."],
      };
    effects.say(
      `Swift sources changed: building ${app.name} in the background (${app.log}).`,
    );
    const built = await effects.compile();
    if (!built.ok) return failed("build", built.detail);
    effects.writeStamp({ ...stamp, compiled: current });
    lines.push(`built in ${built.seconds} s.`);
  }

  // The last moment the app can be seen running before its files are replaced.
  if (effects.appRunning())
    return {
      outcome: "restart-needed",
      lines: [
        ...lines,
        `${app.name} is running and was left alone: quit and reopen it to pick up the new build (installed once it has quit: at once while pnpm dev runs, else by ${app.rerun}).`,
      ],
    };

  const applied = await effects.apply();
  if (!applied.ok) return failed("bundle", applied.detail);
  effects.writeStamp({ compiled: current, applied: current });
  return {
    outcome: "applied",
    lines: [
      ...lines,
      applied.installed
        ? `installed the fresh build: ${applied.installed}`
        : `fresh bundle: ${app.bundle} (no installed copy at ${app.installed} to refresh).`,
    ],
  };
}

// ---------------------------------------------------------------------------
// The real effects.

const lastLines = (text, count) => text.trimEnd().split("\n").slice(-count);

/**
 * The compiler's own error lines when it gave any (`file:line:col: error: …`,
 * or a bare `error: …`), else the end of the log. Paths are shown from `root`.
 */
export function failureDetail(output, root = "", count = 8) {
  const all = output.split("\n");
  const errors = all.filter((line) => /^(error:|\S.*: error:)/.test(line));
  const lines = errors.length > 0 ? errors.slice(0, count) : lastLines(output, count);
  return lines
    .map((line) => (root ? line.split(`${root}/`).join("") : line))
    .map((line) => (line.length > 240 ? `${line.slice(0, 239)}…` : line));
}

function logged(root, app, [command, args], { append }) {
  const logFile = join(root, app.log);
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, append ? "a" : "w");
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd: join(root, app.packageDir),
      stdio: ["ignore", fd, fd],
    });
    running.add(child);
    const finish = (ok) => {
      running.delete(child);
      closeSync(fd);
      done({
        ok,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
        detail: ok ? [] : failureDetail(readFileSync(logFile, "utf8"), root),
      });
    };
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

// Builds in flight, so a launcher that stops can stop them too.
const running = new Set();
export const stopBuilds = () => {
  for (const child of running) child.kill();
};

/** Bundle and sign in .build, then swap the installed copy when there is one. */
async function apply(root, app) {
  const bundled = await logged(root, app, app.bundleCommand, { append: true });
  if (!bundled.ok || !existsSync(app.installed)) return bundled;
  // Copy beside the installed app, check the signature, then swap by rename:
  // the installed app is never a half-written bundle.
  const fresh = `${app.installed}.new`;
  const old = `${app.installed}.old`;
  rmSync(fresh, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  for (const [command, args] of [
    ["ditto", [join(root, app.bundle), fresh]],
    ["codesign", ["--verify", "--strict", fresh]],
  ]) {
    const step = spawnSync(command, args, { encoding: "utf8" });
    if (step.status !== 0) {
      rmSync(fresh, { recursive: true, force: true });
      return {
        ok: false,
        detail: lastLines(`${command}: ${step.stderr ?? step.error}`, 4),
      };
    }
  }
  renameSync(app.installed, old);
  renameSync(fresh, app.installed);
  rmSync(old, { recursive: true, force: true });
  return { ok: true, installed: app.installed };
}

/** The effects `runOnce` needs, on this machine. */
export function realEffects(root, say, app = nativeApp) {
  const stampFile = join(root, app.stamp);
  return {
    environment: process.env,
    platform: process.platform,
    say,
    fingerprint: () => fingerprint(root, app),
    exists: (path) => existsSync(join(root, path)),
    readStamp: () => {
      try {
        return JSON.parse(readFileSync(stampFile, "utf8"));
      } catch {
        return {};
      }
    },
    writeStamp: (stamp) => {
      mkdirSync(dirname(stampFile), { recursive: true });
      writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`);
    },
    hasSwift: () =>
      spawnSync("swift", ["--version"], { stdio: "ignore" }).status === 0,
    appRunning: () =>
      spawnSync("pgrep", ["-x", app.processName], { stdio: "ignore" })
        .status === 0,
    compile: () => logged(root, app, app.compile, { append: false }),
    apply: () => apply(root, app),
  };
}
