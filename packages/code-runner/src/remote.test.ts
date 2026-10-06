import type {
  RunAllRequest,
  RunRequest,
  RunResult,
  SyntaxCheckRequest,
} from "@omnitech/interview-contracts";
import { describe, expect, it, vi } from "vitest";

import type { CodeRunner } from "./index";
import { RemoteCodeRunner } from "./remote";
import { createRunnerHandler } from "./serve";

const TOKEN = "t".repeat(32);
const result = (stdout: string): RunResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  durationMs: 5,
  timedOut: false,
});

function stub() {
  const calls: string[] = [];
  const runner: CodeRunner = {
    run: vi.fn(async (input: RunRequest) => {
      calls.push(`run:${input.language}`);
      return result("ran");
    }),
    runAll: vi.fn(async (input: RunAllRequest) => {
      calls.push(`runAll:${input.language}`);
      return result("tests");
    }),
    checkSyntax: vi.fn(async (input: SyntaxCheckRequest) => {
      calls.push(`syntax:${input.language}`);
      return result("ok");
    }),
  };
  return { runner, calls };
}

// The host service and its client, wired without a network.
function wired(token = TOKEN) {
  const { runner, calls } = stub();
  const handle = createRunnerHandler(runner, TOKEN);
  const remote = new RemoteCodeRunner({
    baseUrl: "http://runner.test",
    token,
    fetch: (url, init) => handle(new Request(url, init)),
  });
  return { remote, runner, calls, handle };
}

describe("the host code runner service", () => {
  it("refuses to start without a real token", () => {
    expect(() => createRunnerHandler(stub().runner, "")).toThrow();
    expect(() => createRunnerHandler(stub().runner, "short")).toThrow();
  });

  it("answers the three runner calls through the remote client, as the local runner would", async () => {
    const { remote, calls } = wired();
    await expect(
      remote.run({ language: "typescript", code: "1", stdin: "" }),
    ).resolves.toMatchObject({ stdout: "ran", exitCode: 0 });
    await expect(
      remote.runAll({
        language: "ruby",
        code: "x",
        usageCode: "",
        testCode: "t",
        stdin: "",
      }),
    ).resolves.toMatchObject({ stdout: "tests" });
    await expect(
      remote.checkSyntax({ language: "php", code: "<?php" }),
    ).resolves.toMatchObject({ stdout: "ok" });
    expect(calls).toEqual(["run:typescript", "runAll:ruby", "syntax:php"]);
  });

  it("refuses a caller without the token, and runs nothing", async () => {
    const { remote, runner } = wired("w".repeat(32));
    await expect(
      remote.run({ language: "typescript", code: "1", stdin: "" }),
    ).rejects.toThrow(/unavailable/i);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("answers only POST to its three paths, with a valid body", async () => {
    const { handle } = wired();
    const auth = { authorization: `Bearer ${TOKEN}` };
    const post = (path: string, body: unknown) =>
      handle(
        new Request(`http://runner.test${path}`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await post("/nope", {})).status).toBe(404);
    expect((await post("/run", { language: "cobol", code: "x" })).status).toBe(
      400,
    );
    expect(
      (
        await handle(
          new Request("http://runner.test/run", {
            method: "GET",
            headers: auth,
          }),
        )
      ).status,
    ).toBe(405);
  });

  it("refuses a body over its limit", async () => {
    const { handle } = wired();
    const response = await handle(
      new Request("http://runner.test/run", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          language: "typescript",
          code: "x".repeat(1_100_000),
        }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("reports a failing runner as unavailable, never as a result", async () => {
    const { runner } = stub();
    runner.run = vi.fn(async () => {
      throw new Error("docker is not running");
    });
    const handle = createRunnerHandler(runner, TOKEN);
    const remote = new RemoteCodeRunner({
      baseUrl: "http://runner.test",
      token: TOKEN,
      fetch: (url, init) => handle(new Request(url, init)),
    });
    await expect(
      remote.run({ language: "typescript", code: "1", stdin: "" }),
    ).rejects.toThrow(/unavailable/i);
  });
});
