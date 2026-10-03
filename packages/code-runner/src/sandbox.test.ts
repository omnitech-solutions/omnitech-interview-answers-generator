// The sandbox controls of the code runner, verified against the REAL argument
// vectors DockerCodeRunner builds (not mocks of its internals): a stand-in for
// the docker binary records its argv, and every control a sandbox needs is
// asserted on that vector - no network, bounded memory, CPU and processes, a
// read-only root, no new privileges, a no-exec tmpfs, only per-run temp-dir
// mounts (sources read-only, one writable output directory), no host home,
// credential or docker socket, no privilege escalation, and no host
// environment forwarded. Loosening any bound fails a test here. When Docker
// and a runtime image are present, one real container also proves egress is
// refused and a host-home marker is unreadable.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerCodeRunner } from "./index.js";

// ---- the documented resource bounds (a looser value must fail) -------------
const PLAIN_BOUNDS = {
  memory: "128m",
  cpus: "0.5",
  pidsLimit: "64",
  tmpfs: "/tmp:rw,noexec,nosuid,size=16m",
} as const;
const TEST_RUN_BOUNDS = {
  memory: "256m",
  cpus: "1",
  pidsLimit: "128",
  tmpfs: "/tmp:rw,noexec,nosuid,size=32m",
} as const;

// ---- a stand-in docker binary that records its argv ------------------------
let workDirectory = "";
let logFile = "";
let fakeDocker = "";

beforeAll(() => {
  workDirectory = mkdtempSync(join(tmpdir(), "sandbox-test-"));
  logFile = join(workDirectory, "argv.jsonl");
  fakeDocker = join(workDirectory, "docker");
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdin.on("data", () => {});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`,
  );
  chmodSync(fakeDocker, 0o755);
});
afterAll(() => {
  rmSync(workDirectory, { recursive: true, force: true });
});

const runner = () => new DockerCodeRunner({ dockerBinary: fakeDocker });

// Runs one runner call and returns the argv the runner handed to docker.
async function capture(call: (r: DockerCodeRunner) => Promise<unknown>) {
  writeFileSync(logFile, "");
  await call(runner());
  const lines = readFileSync(logFile, "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as string[];
}

// ---- parsing the docker flags (strict: an unknown flag fails the test) -----
const BOOLEAN_FLAGS = new Set([
  "--rm",
  "--interactive",
  "--read-only",
  "--pull=never",
]);
const VALUE_FLAGS = new Set([
  "--name",
  "--cap-drop",
  "--network",
  "--memory",
  "--cpus",
  "--pids-limit",
  "--tmpfs",
  "--security-opt",
  "--volume",
  "--env",
]);
type Parsed = {
  flags: Array<[string, string | true]>;
  image: string;
  command: string[];
};
function parse(argv: string[]): Parsed {
  expect(argv[0]).toBe("run");
  const flags: Parsed["flags"] = [];
  let index = 1;
  while (index < argv.length && (argv[index] as string).startsWith("-")) {
    const flag = argv[index] as string;
    if (BOOLEAN_FLAGS.has(flag)) {
      flags.push([flag, true]);
      index += 1;
    } else if (VALUE_FLAGS.has(flag)) {
      flags.push([flag, argv[index + 1] as string]);
      index += 2;
    } else {
      throw new Error(`unexpected docker flag ${flag}`);
    }
  }
  return {
    flags,
    image: argv[index] as string,
    command: argv.slice(index + 1),
  };
}
const values = (parsed: Parsed, flag: string) =>
  parsed.flags.filter(([name]) => name === flag).map(([, value]) => value);
const has = (parsed: Parsed, flag: string) => values(parsed, flag).length > 0;

// ---- the host material that must never reach a container -------------------
const SECRET_ENV: Record<string, string> = {
  OPENAI_API_KEY: `sentinel-openai-${randomUUID()}`,
  AWS_SECRET_ACCESS_KEY: `sentinel-aws-${randomUUID()}`,
  GITHUB_TOKEN: `sentinel-github-${randomUUID()}`,
  DATABASE_URL: `postgres://sentinel:${randomUUID()}@db.invalid/app`,
  OMNITECH_SESSION_SECRET: `sentinel-session-${randomUUID()}`,
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [name, value] of Object.entries(SECRET_ENV)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});
afterAll(() => {
  for (const name of Object.keys(SECRET_ENV)) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const FORBIDDEN_PATH_PARTS = [
  ".ssh",
  ".aws",
  ".config",
  ".gnupg",
  ".docker",
  ".kube",
  ".npmrc",
  ".netrc",
];

// The controls every container invocation must carry, whatever it runs.
function expectSandboxed(
  argv: string[],
  bounds: typeof PLAIN_BOUNDS | typeof TEST_RUN_BOUNDS,
) {
  const parsed = parse(argv);
  // No network of any kind.
  expect(values(parsed, "--network")).toEqual(["none"]);
  // Bounded resources, exactly as documented.
  expect(values(parsed, "--memory")).toEqual([bounds.memory]);
  expect(values(parsed, "--cpus")).toEqual([bounds.cpus]);
  expect(values(parsed, "--pids-limit")).toEqual([bounds.pidsLimit]);
  // Read-only root and a no-exec, no-setuid tmpfs the only scratch space.
  expect(has(parsed, "--read-only")).toBe(true);
  const tmpfs = values(parsed, "--tmpfs") as string[];
  expect(tmpfs).toContain(bounds.tmpfs);
  for (const mount of tmpfs) {
    expect(mount).toMatch(/:rw,noexec,nosuid,size=\d+m$/);
    expect(mount.split(":")[0]).toMatch(/^\//);
  }
  // Privilege cannot be gained.
  expect(values(parsed, "--security-opt")).toEqual(["no-new-privileges"]);
  expect(has(parsed, "--rm")).toBe(true);
  // Every capability is dropped, images are never pulled, and the container
  // is named so a timeout can kill it rather than only the docker client.
  expect(values(parsed, "--cap-drop")).toEqual(["ALL"]);
  expect(has(parsed, "--pull=never")).toBe(true);
  expect(values(parsed, "--name")).toHaveLength(1);
  expect(values(parsed, "--name")[0]).toMatch(/^interview-run-[0-9a-f-]{36}$/);

  // Escalations are absent by construction: parse() rejects every flag outside
  // the allowlist above, and the vector never names them as values either.
  const flat = argv.join("\u0000");
  for (const forbidden of [
    "--privileged",
    "--cap-add",
    "--device",
    "--pid",
    "--ipc",
    "--uts",
    "--userns",
    "--user",
    "--env-file",
    "--volumes-from",
    "--mount",
    "--add-host",
    "--sysctl",
    "--ulimit",
    "--security-opt=seccomp=unconfined",
    "seccomp=unconfined",
    "apparmor=unconfined",
    "--network=host",
    "host",
  ]) {
    expect(
      parsed.flags.some(
        ([name, value]) => name === forbidden || value === forbidden,
      ),
    ).toBe(false);
    if (forbidden.startsWith("--"))
      expect(argv.slice(0, argv.indexOf(parsed.image))).not.toContain(
        forbidden,
      );
  }
  expect(flat).not.toMatch(/docker\.sock/);
  expect(flat).not.toMatch(/\/var\/run/);

  // No host environment is forwarded: at most the one fixed NO_COLOR=1.
  for (const value of values(parsed, "--env")) expect(value).toBe("NO_COLOR=1");
  for (const secret of Object.values(SECRET_ENV))
    expect(flat).not.toContain(secret);
  for (const name of Object.keys(SECRET_ENV)) expect(flat).not.toContain(name);

  // Every mount is a per-run directory inside the OS temp directory.
  const volumes = values(parsed, "--volume") as string[];
  for (const volume of volumes) {
    const source = volume.slice(0, volume.indexOf(":/"));
    expect(source.startsWith(`${tmpdir()}/`)).toBe(true);
    const home = homedir();
    if (home.length > 1) expect(source.startsWith(`${home}/`)).toBe(false);
    for (const part of FORBIDDEN_PATH_PARTS) expect(source).not.toContain(part);
    expect(source).not.toMatch(/(^|\/)\.\.(\/|$)/);
    expect(volume).not.toContain("docker.sock");
  }
  const home = homedir();
  if (home.length > 1) {
    // The home directory is not named anywhere in the vector except inside
    // the OS temp directory (some systems keep it under home).
    const outside = argv.filter(
      (arg) => arg.includes(`${home}/`) && !arg.startsWith(tmpdir()),
    );
    const mounts = outside.filter((arg) => arg.includes(":/"));
    expect(mounts).toEqual([]);
  }
  return { parsed, volumes };
}

describe("run: the plain execution path", () => {
  for (const language of ["typescript", "php", "ruby"] as const) {
    it(`${language}: carries every sandbox control and mounts nothing`, async () => {
      const argv = await capture((r) =>
        r.run({ language, code: "1 + 1", stdin: "" }),
      );
      const { parsed, volumes } = expectSandboxed(argv, PLAIN_BOUNDS);
      expect(volumes).toEqual([]);
      expect(values(parsed, "--env")).toEqual([]);
      // Interactive stdin is how stdin reaches the container; nothing more.
      expect(has(parsed, "--interactive")).toBe(true);
    });
  }
});

describe("checkSyntax", () => {
  for (const language of ["typescript", "react", "php", "ruby"] as const) {
    it(`${language}: read-only per-run source mount, same controls, no environment`, async () => {
      const argv = await capture((r) =>
        r.checkSyntax({ language, code: "const x = 1;" }),
      );
      const { parsed, volumes } = expectSandboxed(argv, PLAIN_BOUNDS);
      expect(values(parsed, "--env")).toEqual([]);
      expect(volumes).toHaveLength(1);
      expect(volumes[0]).toMatch(/:\/workspace\/solution\.[a-z]+:ro$/);
      expect(volumes.filter((v) => v.endsWith(":rw"))).toEqual([]);
    });
  }
});

describe("runAll with tests", () => {
  for (const language of ["typescript", "react", "php", "ruby"] as const) {
    it(`${language}: tighter-than-host test run with one read-only source and exactly one writable output mount`, async () => {
      const argv = await capture((r) =>
        r.runAll({
          language,
          code: "export const x = 1;",
          usageCode: "",
          testCode: "test('x', () => {})",
          stdin: "",
        }),
      );
      const { parsed, volumes } = expectSandboxed(argv, TEST_RUN_BOUNDS);
      // The only environment variable is the fixed NO_COLOR=1.
      expect(values(parsed, "--env")).toEqual(["NO_COLOR=1"]);
      // Sources are read-only; the output mount is the single writable one.
      const writable = volumes.filter((v) => v.endsWith(":rw"));
      expect(writable).toHaveLength(1);
      expect(writable[0]).toMatch(/\/out:\/out:rw$/);
      const sources = volumes.filter((v) => !v.endsWith(":rw"));
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatch(/:\/workspace\/[^:]+:ro$/);
      expect(volumes).toHaveLength(2);
      // Every writable tmpfs of the framework image is also no-exec.
      for (const mount of values(parsed, "--tmpfs") as string[])
        expect(mount).toContain("noexec,nosuid");
    });
  }

  it("typescript without tests falls back to the plain bounds, not the test bounds", async () => {
    const argv = await capture((r) =>
      r.runAll({
        language: "typescript",
        code: "console.log(1)",
        usageCode: "",
        testCode: "",
        stdin: "",
      }),
    );
    const { volumes } = expectSandboxed(argv, PLAIN_BOUNDS);
    expect(volumes).toEqual([]);
  });

  it("per-run directories are fresh and removed after the run", async () => {
    const first = await capture((r) =>
      r.checkSyntax({ language: "typescript", code: "1" }),
    );
    const second = await capture((r) =>
      r.checkSyntax({ language: "typescript", code: "1" }),
    );
    const source = (argv: string[]) =>
      (
        parse(argv).flags.find(([name]) => name === "--volume")?.[1] as string
      ).split(":/")[0] as string;
    expect(source(first)).not.toBe(source(second));
    const { existsSync } = await import("node:fs");
    expect(existsSync(source(first))).toBe(false);
  });
});

describe("the assertions are not vacuous", () => {
  const good = [
    "run",
    "--name",
    "interview-run-00000000-0000-0000-0000-000000000000",
    "--pull=never",
    "--cap-drop",
    "ALL",
    "--rm",
    "--network",
    "none",
    "--memory",
    "128m",
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    "--read-only",
    "--tmpfs",
    PLAIN_BOUNDS.tmpfs,
    "--security-opt",
    "no-new-privileges",
    "node:22-alpine",
  ];
  it("accepts the documented vector", () => {
    expect(() => expectSandboxed(good, PLAIN_BOUNDS)).not.toThrow();
  });
  const mutate = (replace: (v: string[]) => string[]) => () =>
    expectSandboxed(replace([...good]), PLAIN_BOUNDS);
  it.each([
    [
      "no cap-drop",
      mutate((v) => {
        const i = v.indexOf("--cap-drop");
        return [...v.slice(0, i), ...v.slice(i + 2)];
      }),
    ],
    ["pull allowed", mutate((v) => v.filter((x) => x !== "--pull=never"))],
    ["network host", mutate((v) => v.map((x) => (x === "none" ? "host" : x)))],
    ["more memory", mutate((v) => v.map((x) => (x === "128m" ? "512m" : x)))],
    ["more cpus", mutate((v) => v.map((x) => (x === "0.5" ? "4" : x)))],
    ["more pids", mutate((v) => v.map((x) => (x === "64" ? "4096" : x)))],
    ["writable root", mutate((v) => v.filter((x) => x !== "--read-only"))],
    [
      "exec tmpfs",
      mutate((v) => v.map((x) => x.replace("noexec,nosuid", "exec"))),
    ],
    [
      "privileged",
      mutate((v) => [...v.slice(0, 1), "--privileged", ...v.slice(1)]),
    ],
    [
      "host env",
      mutate((v) => [...v.slice(0, 1), "--env", "HOME=/root", ...v.slice(1)]),
    ],
    [
      "docker socket",
      mutate((v) => [
        ...v.slice(0, 1),
        "--volume",
        `${tmpdir()}/x/docker.sock:/var/run/docker.sock:rw`,
        ...v.slice(1),
      ]),
    ],
    [
      "home mount",
      mutate((v) => [
        ...v.slice(0, 1),
        "--volume",
        `${homedir()}/.ssh:/root/.ssh:ro`,
        ...v.slice(1),
      ]),
    ],
    [
      "secret value in argv",
      mutate((v) => [...v, "-e", String(SECRET_ENV["OPENAI_API_KEY"])]),
    ],
  ])("fails when the vector has %s", (_, run) => {
    expect(run).toThrow();
  });
});

// ---- a real container, when Docker and a runtime image are present ---------
function dockerAvailable(): boolean {
  const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeout: 5_000,
  });
  return info.status === 0;
}
function imagePresent(image: string): boolean {
  return (
    spawnSync("docker", ["image", "inspect", image], { timeout: 5_000 })
      .status === 0
  );
}
// node:22-alpine is the TypeScript runtime image; when only the PHP runtime
// image is present locally the same sandbox is exercised through it. Nothing
// is ever pulled.
const real = (() => {
  if (!dockerAvailable()) return null;
  if (imagePresent("node:22-alpine")) return "typescript" as const;
  if (imagePresent("php:8.3-cli-alpine")) return "php" as const;
  return null;
})();

describe("a real container", () => {
  it.skipIf(real === null)(
    "refuses network egress and cannot read a host-home marker file",
    async () => {
      const marker = join(homedir(), `.sandbox-marker-${randomUUID()}`);
      const secret = `sentinel-marker-${randomUUID()}`;
      writeFileSync(marker, secret, { mode: 0o600 });
      try {
        const code =
          real === "typescript"
            ? `const net = require('node:net');
const fs = require('node:fs');
try { console.log('MARKER-READ:' + fs.readFileSync(${JSON.stringify(marker)}, 'utf8')); }
catch { console.log('marker-unreadable'); }
const socket = net.connect({ host: '1.1.1.1', port: 53, timeout: 3000 });
socket.on('connect', () => { console.log('EGRESS-OPEN'); process.exit(0); });
socket.on('timeout', () => { console.log('egress-refused'); process.exit(0); });
socket.on('error', () => { console.log('egress-refused'); process.exit(0); });`
            : `$s = @fsockopen('1.1.1.1', 53, $e, $m, 3);
echo $s ? "EGRESS-OPEN\\n" : "egress-refused\\n";
$f = @file_get_contents(${JSON.stringify(marker)});
echo $f === false ? "marker-unreadable\\n" : "MARKER-READ:" . $f . "\\n";`;
        const result = await new DockerCodeRunner({
          timeoutMs: 60_000,
        }).run({
          language: real as "typescript" | "php",
          code: code,
          stdin: "",
        });
        expect(result.timedOut).toBe(false);
        expect(result.stdout).toContain("egress-refused");
        expect(result.stdout).not.toContain("EGRESS-OPEN");
        expect(result.stdout).toContain("marker-unreadable");
        expect(result.stdout).not.toContain("MARKER-READ");
        expect(result.stdout + result.stderr).not.toContain(secret);
      } finally {
        rmSync(marker, { force: true });
      }
    },
    90_000,
  );
});

// ---- a timed-out run must not leave its container behind --------------------
describe("timeout cleanup", () => {
  it("kills and removes the named container, not only the docker client", async () => {
    const hanging = join(workDirectory, "docker-hang");
    const hangLog = join(workDirectory, "hang.jsonl");
    writeFileSync(
      hanging,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(hangLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "run") setInterval(() => {}, 1000);
`,
    );
    chmodSync(hanging, 0o755);
    const result = await new DockerCodeRunner({
      dockerBinary: hanging,
      timeoutMs: 300,
    }).run({ language: "typescript", code: "1", stdin: "" });
    expect(result.timedOut).toBe(true);
    const calls = readFileSync(hangLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const run = calls.find((argv) => argv[0] === "run") as string[];
    const name = run[run.indexOf("--name") + 1] as string;
    expect(name).toMatch(/^interview-run-/);
    expect(calls).toContainEqual(["kill", name]);
    expect(calls).toContainEqual(["rm", "-f", name]);
  });

  const names = () =>
    spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], {
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter((name) => name.startsWith("interview-run-"));

  it.skipIf(real === null)(
    "leaves no container running after a real timeout",
    async () => {
      const before = new Set(names());
      const result = await new DockerCodeRunner({ timeoutMs: 3_000 }).run({
        language: real as "typescript" | "php",
        code:
          real === "typescript" ? "setTimeout(() => {}, 60000);" : "sleep(60);",
        stdin: "",
      });
      expect(result.timedOut).toBe(true);
      expect(names().filter((name) => !before.has(name))).toEqual([]);
    },
    60_000,
  );
});
