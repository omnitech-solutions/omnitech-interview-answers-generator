// What a Codex or Claude Code process is started with: the installed CLI and
// the part of the worker's environment it may inherit.
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { type AgentRuntimeAdapter, agentRuntime } from "@omnitech/ai-engine";

export type Environment = Readonly<Record<string, string | undefined>>;

// The person's installed Codex CLI (CODEX_PATH, else `codex` on PATH): the
// SDK's bundled binary can lag behind it, and a ChatGPT sign-in then refuses
// current models. Falls back to the bundled binary when none is installed.
function installedCodex(env: Environment): string | undefined {
  if (env["CODEX_PATH"]) return env["CODEX_PATH"];
  for (const directory of (env["PATH"] ?? "").split(delimiter)) {
    const candidate = join(directory, "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

// [SAFETY] What a Codex or Claude Code process may inherit: the account and
// shell basics the CLIs need and their own CODEX_* / ANTHROPIC_* / CLAUDE_*
// settings. The database URL, payload and connected-account secrets and the
// worker's model keys never reach an agent process, except that the Codex
// adapter alone also inherits OPENAI_API_KEY, the key its CLI signs in with.
const AGENT_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TZ",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]);
// Each runtime sees only its own vendor settings; LC_ locale variables are shared.
const AGENT_ENV_PREFIXES: Readonly<
  Record<"codex" | "claude-code" | "none", readonly string[]>
> = {
  codex: ["LC_", "CODEX_"],
  "claude-code": ["LC_", "ANTHROPIC_", "CLAUDE_"],
  none: ["LC_"],
};

const CODEX_ENV_NAMES = new Set(["OPENAI_API_KEY"]);

export function agentEnvironment(
  env: Environment,
  runtime?: "codex" | "claude-code",
): Record<string, string> {
  const allowed: Record<string, string> = {};
  const prefixes = AGENT_ENV_PREFIXES[runtime ?? "none"];
  for (const [name, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      (AGENT_ENV_NAMES.has(name) ||
        (runtime === "codex" && CODEX_ENV_NAMES.has(name)) ||
        prefixes.some((prefix) => name.startsWith(prefix)))
    )
      allowed[name] = value;
  }
  return allowed;
}

export function agentRuntimes(
  env: Environment,
): Readonly<Record<string, AgentRuntimeAdapter>> {
  const codexPath = installedCodex(env);
  return {
    codex: agentRuntime({
      runtime: "codex",
      environment: agentEnvironment(env, "codex"),
      ...(codexPath ? { executable: codexPath } : {}),
    }),
    "claude-code": agentRuntime({
      runtime: "claude-code",
      environment: agentEnvironment(env, "claude-code"),
    }),
  };
}
