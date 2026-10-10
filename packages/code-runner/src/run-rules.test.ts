import { expect, it } from "vitest";
import {
  buildPhpTestSource,
  failWhenNoTestsFound,
  isDockerDaemonUnavailable,
  joinSections,
  sandboxArguments,
  stripPhpTags,
} from "./run-rules";
import { SANDBOX_LIMITS } from "./runtimes";

const result = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 1,
  timedOut: false,
};

it("builds one PHP source from the parts that have anything in them", () => {
  expect(stripPhpTags("<?php\necho 1; ?>\n")).toBe("echo 1; ");
  expect(buildPhpTestSource("<?php\nfunction a() {}", "<?PHP it('x');")).toBe(
    "<?php\nfunction a() {}\n\nit('x');",
  );
  expect(buildPhpTestSource("<?php ", "  ")).toBe("");
  expect(joinSections("a", "  ", "b")).toBe("a\n\nb");
});

it("gives every container the same isolation, sized by the kind of run", () => {
  expect(sandboxArguments(SANDBOX_LIMITS.run)).toEqual([
    "--network",
    "none",
    "--memory",
    "128m",
    "--memory-swap",
    "128m",
    "--user",
    "65534:65534",
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--security-opt",
    "no-new-privileges",
  ]);
  const test = sandboxArguments(SANDBOX_LIMITS.test);
  expect(test.filter((flag) => /^\d|size=/.test(flag))).toEqual([
    "256m",
    "256m",
    "65534:65534",
    "1",
    "128",
    "/tmp:rw,noexec,nosuid,size=32m",
  ]);
});

it("recognises a Docker daemon that cannot be reached", () => {
  expect(
    isDockerDaemonUnavailable("Cannot connect to the Docker daemon at unix://"),
  ).toBe(true);
  expect(isDockerDaemonUnavailable("error during connect: ...")).toBe(true);
  expect(isDockerDaemonUnavailable("syntax error")).toBe(false);
});

it("fails a clean run that found no tests, and leaves any other run alone", () => {
  expect(
    failWhenNoTestsFound({
      ...result,
      stdout: "no tests found",
      stderr: "x\n",
    }),
  ).toEqual({
    ...result,
    stdout: "no tests found",
    stderr: "x\nTest framework completed without discovering any tests.",
    exitCode: 1,
  });
  expect(
    failWhenNoTestsFound({ ...result, stderr: "No tests found" }).stderr,
  ).toBe(
    "No tests found\nTest framework completed without discovering any tests.",
  );
  const failed = { ...result, stdout: "No tests found", exitCode: 2 };
  expect(failWhenNoTestsFound(failed)).toBe(failed);
  const passed = { ...result, stdout: "3 passed" };
  expect(failWhenNoTestsFound(passed)).toBe(passed);
});
