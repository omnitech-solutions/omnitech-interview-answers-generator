import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentEnvironment } from "./agent-environment";
import { sweepStagingBase } from "./session-agent-port";
import {
  runWorkerLoops,
  sessionLoop,
  sessionSweepLoop,
  sweepStagingAtStartup,
} from "./worker-loops";

const CANARY = "canary-question-text";
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("worker loops", () => {
  it("keeps the other loop running and closes the shared database only after both settle", async () => {
    const order: string[] = [];
    const sessionDone = gate();
    const lines: string[] = [];
    const outcome = runWorkerLoops(
      [
        {
          name: "agent-job",
          run: async () => {
            order.push("job-rejected");
            throw new RangeError(CANARY);
          },
        },
        {
          name: "session",
          run: async () => {
            await sessionDone.promise;
            order.push("session-ended");
          },
        },
      ],
      new AbortController().signal,
      {
        close: async () => {
          order.push("closed");
        },
      },
      (line) => lines.push(line),
    ).catch((error: Error) => error);
    await pause();
    // The job loop failed but the session loop still runs: nothing closed.
    expect(order).toEqual(["job-rejected"]);
    sessionDone.open();
    const error = await outcome;
    expect(order).toEqual(["job-rejected", "session-ended", "closed"]);
    expect((error as Error).message).toBe("Worker loops failed: agent-job.");
    expect(lines.join("")).toContain("agent-job (RangeError)");
    expect(lines.join("")).not.toContain(CANARY);
  });

  it("a failing session loop does not stop the job loop", async () => {
    const order: string[] = [];
    const jobDone = gate();
    const run = runWorkerLoops(
      [
        {
          name: "agent-job",
          run: async () => {
            await jobDone.promise;
            order.push("job-ended");
          },
        },
        {
          name: "session",
          run: async () => {
            throw new Error("down");
          },
        },
      ],
      new AbortController().signal,
      { close: async () => void order.push("closed") },
      () => undefined,
    ).catch(() => order.push("reported"));
    await pause();
    expect(order).toEqual([]);
    jobDone.open();
    await run;
    expect(order).toEqual(["job-ended", "closed", "reported"]);
  });

  it("closes the shared database and resolves when every loop ends cleanly", async () => {
    const order: string[] = [];
    await runWorkerLoops(
      [{ name: "a", run: async () => void order.push("a") }],
      new AbortController().signal,
      { close: async () => void order.push("closed") },
    );
    expect(order).toEqual(["a", "closed"]);
  });
});

describe("agent runtime environment", () => {
  it("passes the CLI basics and its own settings, never database or secrets", () => {
    const allowed = agentEnvironment({
      PATH: "/bin",
      HOME: "/h",
      LC_ALL: "C",
      CODEX_HOME: "/c",
      ANTHROPIC_API_KEY: "a",
      CLAUDE_CONFIG_DIR: "/cl",
      DATABASE_URL: "postgres://x",
      AGENT_PAYLOAD_SECRET: "s",
      CONNECTED_ACCOUNT_SECRET: "s",
      OPENAI_API_KEY: "o",
      AI_API_KEY: "k",
    });
    expect(Object.keys(allowed).sort()).toEqual(["HOME", "LC_ALL", "PATH"]);
  });
});

describe("agent runtime environment per adapter", () => {
  it("gives only the codex adapter OPENAI_API_KEY", () => {
    const env = { PATH: "/bin", OPENAI_API_KEY: "o", DATABASE_URL: "x" };
    expect(Object.keys(agentEnvironment(env, "codex")).sort()).toEqual([
      "OPENAI_API_KEY",
      "PATH",
    ]);
    expect(Object.keys(agentEnvironment(env, "claude-code"))).toEqual(["PATH"]);
    expect(Object.keys(agentEnvironment(env))).toEqual(["PATH"]);
  });
});

describe("agent runtime environment scoping", () => {
  const env = {
    PATH: "/bin",
    LC_ALL: "C",
    CODEX_HOME: "/c",
    OPENAI_API_KEY: "o",
    ANTHROPIC_API_KEY: "a",
    CLAUDE_CONFIG_DIR: "/cl",
    DATABASE_URL: "postgres://x",
    AGENT_PAYLOAD_SECRET: "s",
  };
  it("gives codex no ANTHROPIC_ or CLAUDE_ keys", () => {
    expect(Object.keys(agentEnvironment(env, "codex")).sort()).toEqual([
      "CODEX_HOME",
      "LC_ALL",
      "OPENAI_API_KEY",
      "PATH",
    ]);
  });
  it("gives claude-code no CODEX_ or OPENAI_ keys", () => {
    expect(Object.keys(agentEnvironment(env, "claude-code")).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "CLAUDE_CONFIG_DIR",
      "LC_ALL",
      "PATH",
    ]);
  });
});

describe("session loop registration", () => {
  it("is not started, with a content-free line, when no model is configured", () => {
    const lines: string[] = [];
    expect(sessionLoop({}, {} as never, (line) => lines.push(line))).toBeNull();
    expect(lines).toEqual([
      "session loop disabled: no language model configured",
    ]);
  });

  // DEFECT in apps/agent-worker/src/session-engine.ts (createSessionEngine):
  // a remote endpoint with no API key is given the placeholder key
  // "not-needed" and no longer throws, so sessionLoop in main.ts starts the
  // loop. The deleted ai-provider-openai adapter refused a keyless endpoint
  // that was not loopback, which main.ts turned into this disabled line.
  it("is not started when the configured model is unusable", () => {
    const lines: string[] = [];
    const env = {
      AI_BASE_URL: "https://models.example.test/v1",
      AI_MODEL: "m",
    };
    expect(
      sessionLoop(env, {} as never, (line) => lines.push(line)),
    ).toBeNull();
    expect(lines).toEqual(["session loop disabled: language model unusable"]);
  });

  it("is started for a configured model", () => {
    const env = {
      AI_BASE_URL: "https://models.example.test/v1",
      AI_MODEL: "m",
      AI_API_KEY: "test-key",
    };
    expect(sessionLoop(env, {} as never, () => undefined)?.name).toBe(
      "session",
    );
  });
});

describe("session sweep loop (no model configured)", () => {
  it("is a named loop that claims nothing, so ended sessions are still purged", () => {
    expect(sessionSweepLoop({}, {} as never, () => undefined).name).toBe(
      "session-sweep",
    );
  });
});

describe("startup staging sweep", () => {
  it("logs a content-free line, naming no path, when the staging directory is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "loops-staging-"));
    try {
      const open = join(root, `${CANARY}-staging`);
      await mkdir(open, { mode: 0o755 });
      await chmod(open, 0o755);
      const lines: string[] = [];
      await sweepStagingAtStartup(
        () => sweepStagingBase(open),
        (line) => lines.push(line),
      );
      expect(lines).toEqual([
        "session staging sweep refused: staging directory is not private",
      ]);
      expect(lines.join("\n")).not.toContain(CANARY);
      expect(lines.join("\n")).not.toContain(root);
      // A private directory sweeps silently.
      const quiet: string[] = [];
      await sweepStagingAtStartup(
        () => sweepStagingBase(join(root, "fresh")),
        (line) => quiet.push(line),
      );
      expect(quiet).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
