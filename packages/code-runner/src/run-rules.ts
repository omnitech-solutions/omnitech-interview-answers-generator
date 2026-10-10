// The decisions of a run, as pure functions: the source a container is given,
// the isolation flags every container gets, and how its output is read. No
// process, no file.
import type { RunResult } from "@omnitech/interview-contracts";
import { SANDBOX_USER, type SandboxLimits } from "./runtimes";

export function stripPhpTags(source: string): string {
  return source.replace(/<\?php\s*/gi, "").replace(/\?>\s*/g, "");
}

export function buildPhpTestSource(solution: string, tests: string): string {
  const sections = [solution, tests]
    .map(stripPhpTags)
    .filter((section) => section.trim());

  return sections.length ? `<?php\n${sections.join("\n\n")}` : "";
}

// The parts of an answer that have anything in them, as one source file.
export const joinSections = (...sections: string[]): string =>
  sections.filter((section) => section.trim()).join("\n\n");

// [SAFETY] The isolation every container runs under, whatever it runs: no
// network, bounded memory (with no swap beyond it), CPU and processes, an
// unprivileged user, a read-only root with a small non-executable /tmp, and
// no way to gain privileges.
export const sandboxArguments = (limits: SandboxLimits): string[] => [
  "--network",
  "none",
  "--memory",
  limits.memory,
  "--memory-swap",
  limits.memory,
  "--user",
  SANDBOX_USER,
  "--cpus",
  limits.cpus,
  "--pids-limit",
  limits.pids,
  "--read-only",
  "--tmpfs",
  `/tmp:rw,noexec,nosuid,size=${limits.tmpfs}`,
  "--security-opt",
  "no-new-privileges",
];

export function isDockerDaemonUnavailable(stderr: string): boolean {
  const normalized = stderr.toLowerCase();

  return (
    normalized.includes("cannot connect to the docker daemon") ||
    normalized.includes("failed to connect to the docker api") ||
    normalized.includes("is the docker daemon running") ||
    normalized.includes("error during connect")
  );
}

// A framework that exits cleanly having found no tests has verified nothing,
// so the run fails and says why.
export function failWhenNoTestsFound(result: RunResult): RunResult {
  if (
    result.exitCode !== 0 ||
    !/\bNo tests found\b/i.test(`${result.stdout}\n${result.stderr}`)
  )
    return result;
  return {
    ...result,
    stderr: [
      result.stderr.trimEnd(),
      "Test framework completed without discovering any tests.",
    ]
      .filter(Boolean)
      .join("\n"),
    exitCode: 1,
  };
}
