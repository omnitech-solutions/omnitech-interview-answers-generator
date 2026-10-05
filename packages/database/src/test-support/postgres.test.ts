import { beforeEach, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

beforeEach(() => {
  vi.resetModules();
  execFile.mockReset();
});

// promisify(execFile) calls the mock with a Node-style callback.
const failWith = (error: Error & { code?: string | number; stderr?: string }) =>
  execFile.mockImplementation(
    (
      _command: string,
      _args: string[],
      callback: (error: Error | null) => void,
    ) => callback(error),
  );

it("names Docker and the way around it when the docker command is missing", async () => {
  failWith(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
  const { startDisposablePostgres } = await import("./postgres");
  await expect(startDisposablePostgres()).rejects.toThrow(
    /These tests need Docker.*not installed or not on PATH.*pnpm test:no-docker/,
  );
  // One preflight, no container start attempted.
  expect(execFile).toHaveBeenCalledTimes(1);
});

it("names the daemon when docker is installed but not running", async () => {
  failWith(
    Object.assign(new Error("exit 1"), {
      code: 1,
      stderr:
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    }),
  );
  const { startDisposablePostgres } = await import("./postgres");
  await expect(startDisposablePostgres()).rejects.toThrow(
    /These tests need Docker.*Docker daemon did not answer \(Cannot connect/,
  );
});
