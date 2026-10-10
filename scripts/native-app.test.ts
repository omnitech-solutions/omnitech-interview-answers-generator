// `pnpm dev` keeps the native Mac app up to date beside the servers
// (scripts/native-app.mjs, run by scripts/dev-native.mjs). The decisions are
// tested here with invented effects: no Swift, no bundle and no running app.
// scripts/dev.mjs starts Docker and servers at import, so its wiring is read
// as source, the way dev-log.test.ts reads it.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  failureDetail,
  fingerprint,
  nativeApp,
  plan,
  runOnce,
  skipReason,
  // @ts-expect-error: a plain .mjs launcher helper without types.
} from "./native-app.mjs";

interface Stamp {
  compiled?: string;
  applied?: string;
}
interface Result {
  outcome: string;
  lines: string[];
}

const scratch = mkdtempSync(join(tmpdir(), "omnitech-native-app-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const app = {
  ...nativeApp,
  inputs: ["shell/Package.swift", "shell/Sources", "shell/Missing.resolved"],
};
function sources(name: string) {
  const root = join(scratch, name);
  mkdirSync(join(root, "shell/Sources/Core"), { recursive: true });
  writeFileSync(join(root, "shell/Package.swift"), "// package\n");
  writeFileSync(join(root, "shell/Sources/Core/A.swift"), "let a = 1\n");
  return root;
}

describe("the fingerprint of the native sources", () => {
  it("is the same for the same files, wherever the checkout is", () => {
    expect(fingerprint(sources("one"), app)).toBe(
      fingerprint(sources("two"), app),
    );
  });

  it("changes when a source changes, appears or is renamed", () => {
    const root = sources("changes");
    const before = fingerprint(root, app);
    writeFileSync(join(root, "shell/Sources/Core/A.swift"), "let a = 2\n");
    const edited = fingerprint(root, app);
    writeFileSync(join(root, "shell/Sources/Core/B.swift"), "");
    const added = fingerprint(root, app);
    expect(new Set([before, edited, added]).size).toBe(3);
  });

  it("ignores files that are not inputs, and a rewrite with the same bytes", () => {
    const root = sources("ignores");
    const before = fingerprint(root, app);
    mkdirSync(join(root, "shell/Tests"), { recursive: true });
    writeFileSync(join(root, "shell/Tests/T.swift"), "let t = 1\n");
    writeFileSync(join(root, "shell/Sources/.DS_Store"), "finder");
    writeFileSync(join(root, "shell/Sources/Core/A.swift"), "let a = 1\n");
    expect(fingerprint(root, app)).toBe(before);
  });

  it("changes with the build recipe", () => {
    const root = sources("recipe");
    expect(
      fingerprint(root, { ...app, compile: ["swift", ["build"]] }),
    ).not.toBe(fingerprint(root, app));
  });

  it("covers the real sources, the bundle script and the companion's modules", () => {
    expect(nativeApp.inputs).toEqual([
      "apps/studio-shell/Package.swift",
      "apps/studio-shell/Package.resolved",
      "apps/studio-shell/Sources",
      "apps/studio-shell/scripts/bundle-app.sh",
      "apps/capture-companion/macos/Package.swift",
      "apps/capture-companion/macos/Sources",
    ]);
    expect(nativeApp.stamp.startsWith(".dev-local/")).toBe(true);
  });
});

describe("whether this host does native work", () => {
  it("is switched off with DEV_NATIVE_BUILD=off", () => {
    expect(skipReason({ DEV_NATIVE_BUILD: "off" }, "darwin")).toContain(
      "DEV_NATIVE_BUILD=off",
    );
    expect(skipReason({ DEV_NATIVE_BUILD: " OFF " }, "darwin")).toBeDefined();
    expect(skipReason({}, "darwin")).toBeUndefined();
    expect(skipReason({ DEV_NATIVE_BUILD: "on" }, "darwin")).toBeUndefined();
  });

  it("skips off macOS", () => {
    expect(skipReason({}, "linux")).toBe("not macOS");
  });
});

describe("what a run has to do", () => {
  const present = { binaryExists: true, bundleExists: true };
  it("does nothing when both steps saw these sources", () => {
    expect(
      plan({
        current: "a",
        stamp: { compiled: "a", applied: "a" },
        ...present,
      }),
    ).toEqual({ compile: false, apply: false });
  });
  it("compiles and applies after a change, or with no stamp", () => {
    for (const stamp of [{}, { compiled: "old", applied: "old" }])
      expect(plan({ current: "a", stamp, ...present })).toEqual({
        compile: true,
        apply: true,
      });
  });
  it("only applies a build that is compiled but was held back", () => {
    expect(
      plan({
        current: "a",
        stamp: { compiled: "a", applied: "old" },
        ...present,
      }),
    ).toEqual({ compile: false, apply: true });
  });
  it("rebuilds what was deleted", () => {
    const stamp = { compiled: "a", applied: "a" };
    expect(
      plan({ current: "a", stamp, binaryExists: false, bundleExists: true }),
    ).toEqual({ compile: true, apply: true });
    expect(
      plan({ current: "a", stamp, binaryExists: true, bundleExists: false }),
    ).toEqual({ compile: false, apply: true });
  });
});

// A machine made of plain values: what the sources hash to, whether the app is
// running, whether the compiler succeeds. It records what was done.
function machine(over: Record<string, unknown> = {}) {
  const did: string[] = [];
  const said: string[] = [];
  const state = {
    stamp: {} as Stamp,
    hash: "h1",
    running: false,
    compileOk: true,
    applyOk: true,
    swift: true,
    installed: "/Users/x/Applications/Interview Studio.app" as
      | string
      | undefined,
    ...over,
  };
  const effects = {
    environment: {},
    platform: "darwin",
    say: (line: string) => said.push(line),
    fingerprint: () => state.hash,
    exists: () => true,
    readStamp: () => state.stamp,
    writeStamp: (stamp: Stamp) => {
      state.stamp = stamp;
    },
    hasSwift: () => state.swift,
    appRunning: () => state.running,
    compile: async () => {
      did.push("compile");
      return state.compileOk
        ? { ok: true, seconds: "24.0", detail: [] }
        : { ok: false, detail: ["A.swift:3:1: error: cannot find 'x'"] };
    },
    apply: async () => {
      did.push("apply");
      return state.applyOk
        ? { ok: true, installed: state.installed }
        : { ok: false, detail: ["codesign: failed"] };
    },
    ...((over["effects"] as object) ?? {}),
  };
  const run = (): Promise<Result> => runOnce(effects, nativeApp);
  return { did, said, state, run };
}

describe("one pass of the native task", () => {
  it("builds and installs the first time, and skips the second", async () => {
    const m = machine();
    const first = await m.run();
    expect(first.outcome).toBe("applied");
    expect(first.lines.join("\n")).toContain("built in 24.0 s");
    expect(first.lines.join("\n")).toContain("Interview Studio.app");
    expect(m.said.join("\n")).toContain("building Interview Studio");
    expect(m.state.stamp).toEqual({ compiled: "h1", applied: "h1" });

    const second = await m.run();
    expect(second).toEqual({
      outcome: "current",
      lines: ["Interview Studio is up to date."],
    });
    expect(m.did).toEqual(["compile", "apply"]);
  });

  it("builds again when a source changed", async () => {
    const m = machine({ stamp: { compiled: "h0", applied: "h0" } });
    expect((await m.run()).outcome).toBe("applied");
    expect(m.did).toEqual(["compile", "apply"]);
  });

  it("reports a failed build with the error and the command to rerun, and throws nothing", async () => {
    const m = machine({
      compileOk: false,
      stamp: { compiled: "h0", applied: "h0" },
    });
    const result = await m.run();
    expect(result.outcome).toBe("failed");
    const text = result.lines.join("\n");
    expect(text).toContain("build FAILED; pnpm dev carries on");
    expect(text).toContain("error: cannot find 'x'");
    expect(text).toContain("rerun: pnpm dev:native");
    expect(text).toContain(".dev-local/native-app/build.log");
    expect(result.lines.length).toBeLessThanOrEqual(12);
    // Nothing was bundled or installed, and the next run tries again.
    expect(m.did).toEqual(["compile"]);
    expect(m.state.stamp).toEqual({ compiled: "h0", applied: "h0" });
    expect((await m.run()).outcome).toBe("failed");
  });

  it("leaves a running app alone and says a restart is needed, once the build is done", async () => {
    const m = machine({ running: true });
    const result = await m.run();
    expect(result.outcome).toBe("restart-needed");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toContain(
      "Interview Studio is running and was left alone: quit and reopen it",
    );
    // Compiled, but the app's files were not touched.
    expect(m.did).toEqual(["compile"]);
    expect(m.state.stamp).toEqual({ compiled: "h1" });

    // Still running: no second compile, the same single line.
    const again = await m.run();
    expect(again.outcome).toBe("restart-needed");
    expect(again.lines).toHaveLength(1);
    expect(m.did).toEqual(["compile"]);

    // The app has quit: the held build is installed without compiling again.
    m.state.running = false;
    expect((await m.run()).outcome).toBe("applied");
    expect(m.did).toEqual(["compile", "apply"]);
    expect(m.state.stamp).toEqual({ compiled: "h1", applied: "h1" });
  });

  it("reports a failed bundle or install the same way", async () => {
    const m = machine({ applyOk: false });
    const result = await m.run();
    expect(result.outcome).toBe("failed");
    expect(result.lines.join("\n")).toContain("bundle FAILED");
    expect(m.state.stamp).toEqual({ compiled: "h1" });
  });

  it("says where the bundle is when no installed copy exists", async () => {
    const m = machine({ installed: undefined });
    const result = await m.run();
    expect(result.outcome).toBe("applied");
    expect(result.lines.at(-1)).toContain(
      "apps/studio-shell/.build/InterviewStudioShell.app",
    );
  });

  it("does nothing at all when switched off or off macOS", async () => {
    for (const effects of [
      { environment: { DEV_NATIVE_BUILD: "off" } },
      { platform: "linux" },
    ]) {
      const m = machine({ effects });
      const result = await m.run();
      expect(result.outcome).toBe("off");
      expect(result.lines).toHaveLength(1);
      expect(m.did).toEqual([]);
    }
  });

  it("skips with one line on a Mac without Swift, only when a build is needed", async () => {
    const m = machine({ swift: false });
    const result = await m.run();
    expect(result.outcome).toBe("skipped");
    expect(result.lines).toEqual([
      "skipped: no swift toolchain on PATH (xcode-select --install).",
    ]);
    expect(m.did).toEqual([]);
  });
});

describe("the detail of a failure", () => {
  it("is the compiler's error lines with paths from the repository, not the whole log", () => {
    const log = [
      "[1/9] Compiling A",
      "/repo dir/apps/x/A.swift:3:1: error: cannot find 'x' in scope",
      "1 | let y = x",
      "  |         `- error: cannot find 'x' in scope",
      "/repo dir/apps/x/B.swift:9:2: error: missing return",
      "error: fatalError",
    ].join("\n");
    expect(failureDetail(log, "/repo dir")).toEqual([
      "apps/x/A.swift:3:1: error: cannot find 'x' in scope",
      "apps/x/B.swift:9:2: error: missing return",
      "error: fatalError",
    ]);
  });
  it("falls back to the end of the log, and cuts a very long line", () => {
    expect(failureDetail("a\nb\nc\n", "", 2)).toEqual(["b", "c"]);
    expect(failureDetail("x".repeat(500))[0]).toHaveLength(240);
  });
});

describe("the dev launcher and the native task", () => {
  const dev = readFileSync(join(import.meta.dirname, "dev.mjs"), "utf8");
  const start = dev.indexOf("const nativeBuild = spawn(");
  const statement = dev
    .slice(start, dev.indexOf(");", start))
    .replace(/\s+/g, " ");

  it("starts it as its own process before the first blocking step", () => {
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(dev.indexOf("spawnSync("));
    expect(statement).toContain('new URL("./dev-native.mjs", import.meta.url)');
    expect(statement).toContain('"--watch"');
  });

  it("gives it the terminal directly: nothing is piped through the blocked launcher", () => {
    expect(statement).toContain('stdio: ["ignore", "inherit", "inherit"]');
    expect(statement).toContain("env: localEnvironment");
  });

  it("never waits for it or exits with it, and stops it on the way out", () => {
    // The only listeners on it: a failed start is one line, and the exit hook.
    expect(dev.match(/nativeBuild\.[a-z]+\(/gi)).toEqual([
      "nativeBuild.once(",
      "nativeBuild.kill(",
    ]);
    expect(dev).toContain('nativeBuild.once("error"');
    expect(dev).toContain('process.once("exit", () => nativeBuild.kill());');
  });

  it("has the rerun command the failure names", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts["dev:native"]).toBe("node scripts/dev-native.mjs");
    expect(nativeApp.rerun).toBe("pnpm dev:native");
  });
});
