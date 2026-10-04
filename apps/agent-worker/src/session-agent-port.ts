// The worker's implementation of the gateway's existing AgentExecutionPort for
// Active Session actions (ADR-0016 Decision 1-3). It wraps an
// AgentRuntimeAdapter and nothing else: no coordinator, queue or conversation
// store. Every attempt is tool-less, runs with fresh context in its own
// ephemeral provider home, stages screenshots in a private directory that is
// removed when the attempt settles, and reports only typed error codes.
//
// Interim wrapper: ships DISABLED (selected by an explicit config flag in
// session-gateway.ts) and is deliberately thin, because PB-0003's shared
// worker executor will replace this body (ADR-0014). Keep the exported shape
// (the port, `sweep`, `purge`) and the tests; swap the internals.
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  AGENT_IMAGE_MAX_BYTES,
  type AgentEvent,
  type AgentProfile,
  type AgentRuntimeAdapter,
  type AgentRunRequest,
  validateAgentProfile,
} from "@omnitech/agent-runtime-contracts";
import type {
  AgentAttachment,
  AiAccessContext,
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  AiFailure,
  AiUsage,
} from "@omnitech/ai-contracts";
import type { AgentExecutionPort, AiProfile } from "@omnitech/ai-runtime";

// Typed codes are the whole session-path error surface: the message is fixed
// per code and never contains provider text, paths or attachment names.
export type SessionAgentErrorCode =
  | "vision-unsupported"
  | "toolless-unsupported"
  | "attachment-refused"
  | "tool-refused"
  | "policy-refused"
  | "cancelled"
  | "timeout"
  | "rate-limit"
  | "output-too-large"
  | "profile-unavailable"
  // Retryable: the session is not active right now (paused, or it never will
  // be again); the dispatcher suppresses without settling the task for good.
  | "session-not-active"
  // Retryable: the standing or a screenshot could not be read (a transient
  // database failure), which is never a policy denial.
  | "read-failed"
  | "provider";

const FAILURES: Readonly<
  Record<
    SessionAgentErrorCode,
    { code: AiFailure["code"]; message: string; retryable: boolean }
  >
> = {
  "vision-unsupported": {
    code: "policy-refused",
    message: "The profile's runtime cannot take image input.",
    retryable: false,
  },
  "toolless-unsupported": {
    code: "policy-refused",
    message: "The profile cannot prove tool-less operation.",
    retryable: false,
  },
  "attachment-refused": {
    code: "policy-refused",
    message: "An attachment was refused.",
    retryable: false,
  },
  "tool-refused": {
    code: "policy-refused",
    message: "A tool-less request attempted to use a tool.",
    retryable: false,
  },
  "policy-refused": {
    code: "policy-refused",
    message: "The session no longer permits this request.",
    retryable: false,
  },
  cancelled: { code: "cancelled", message: "Cancelled.", retryable: false },
  timeout: {
    code: "timeout",
    message: "The attempt timed out.",
    retryable: true,
  },
  "rate-limit": {
    code: "rate-limit",
    message: "The provider is rate limited.",
    retryable: true,
  },
  "output-too-large": {
    code: "invalid-output",
    message: "The output exceeded its bound.",
    retryable: false,
  },
  "profile-unavailable": {
    code: "configuration",
    message: "The agent profile is unavailable.",
    retryable: false,
  },
  "session-not-active": {
    code: "infrastructure",
    message: "The session is not active.",
    retryable: true,
  },
  "read-failed": {
    code: "infrastructure",
    message: "The session state could not be read.",
    retryable: true,
  },
  provider: {
    code: "provider",
    message: "The provider failed.",
    retryable: false,
  },
};

export class SessionAgentError extends Error {
  readonly retryable: boolean;
  readonly failure: AiFailure;
  constructor(readonly sessionCode: SessionAgentErrorCode) {
    super(FAILURES[sessionCode].message);
    this.name = "SessionAgentError";
    this.failure = { ...FAILURES[sessionCode] };
    this.retryable = this.failure.retryable;
  }
  get code(): AiFailure["code"] {
    return this.failure.code;
  }
}

// Resolves a task attachment reference (an observation id; the product's
// loader owns the owner-session join, media re-detection and digest check) to
// the frozen bytes. The port never reads a path the caller supplied.
export type AttachmentSource = (
  context: AiAccessContext,
  attachment: AgentAttachment,
  signal: AbortSignal | undefined,
) => Promise<Uint8Array>;

export interface SessionAgentPortOptions {
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>;
  // Gateway profile id -> the typed, versioned, bounded agent profile it runs.
  profiles: ReadonlyMap<string, AgentProfile>;
  attachmentSource?: AttachmentSource;
  // Private base for per-attempt directories. Owned by this worker process:
  // `sweep` removes everything in it.
  stagingBase?: string;
  // Provider attempts this port runs at once, across all sessions (one slot is
  // one attempt). Each session already holds at most two (assist and coding),
  // so this is the worker-wide bound beside AGENT_WORKER_CONCURRENCY, which
  // bounds agent JOBS; the two do not share a count.
  maxSessionAttempts?: number;
  maxLiveStreak?: number;
  isBackground?: (request: AiExecutionRequest, profile: AiProfile) => boolean;
  // Re-checks session standing and locality after any capacity wait. `true`
  // permits; `false` is a real policy denial (final); "not-active" and
  // "read-failed" are retryable and refuse the attempt before a provider is
  // touched.
  stillPermitted?: (
    request: AiExecutionRequest,
    profile: AiProfile,
  ) => StandingVerdict | Promise<StandingVerdict>;
}

export type StandingVerdict = boolean | "not-active" | "read-failed";

export interface SessionAgentPort extends AgentExecutionPort {
  // Startup sweep: removes every staging directory left by a previous process.
  sweep(): Promise<void>;
  // Purge hook: cancels in-flight attempts and removes all staged content now.
  purge(): Promise<void>;
  // After a session purge: removes staged content no running attempt owns
  // (leftovers), without touching attempts of other sessions.
  sweepIdle(): Promise<void>;
}

// "Live first, background not starved" (see createAdmission): two attempts at
// once, and a background attempt goes next after eight live admissions in a
// row while background work waits.
export const DEFAULT_MAX_CONCURRENT = 2;
export const DEFAULT_MAX_LIVE_STREAK = 8;

const STAGING_PREFIX = "omnitech-session-agent-";

// The staging base of this process unless the host names one.
export const defaultStagingBase = (): string =>
  join(tmpdir(), `${STAGING_PREFIX}${process.pid}`);

// [SAFETY] The base lives in a shared temp directory, so before anything is
// read or removed it must be a real directory (never a link) that this user
// owns and nobody else can enter; anything else is refused, never followed.
async function ensurePrivateBase(base: string): Promise<void> {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const info = await lstat(base);
  const uid = process.getuid?.();
  if (
    !info.isDirectory() ||
    // Ownership and mode bits are POSIX facts: without a uid (Windows) the
    // directory check alone applies.
    (uid !== undefined && (info.uid !== uid || (info.mode & 0o077) !== 0))
  )
    throw new SessionAgentError("profile-unavailable");
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

// Removes a staging base's content, and (for the default per-process layout)
// the staging directories of processes that no longer exist. It needs no model
// and no runtime: the worker runs it at startup and after every purge even
// when no language model is configured.
export async function sweepStagingBase(base: string): Promise<void> {
  await ensurePrivateBase(base);
  for (const entry of await readdir(base))
    await rm(join(base, entry), { recursive: true, force: true });
  // Only the default per-process layout has siblings of dead processes.
  if (!basename(base).startsWith(STAGING_PREFIX)) return;
  const parent = join(base, "..");
  for (const entry of await readdir(parent).catch(() => [] as string[])) {
    if (!entry.startsWith(STAGING_PREFIX)) continue;
    const pid = Number(entry.slice(STAGING_PREFIX.length));
    if (!Number.isInteger(pid) || pid === process.pid || processAlive(pid))
      continue;
    // [SAFETY] Only a real directory of this user is removed; a planted link
    // is left alone, never followed.
    const info = await lstat(join(parent, entry)).catch(() => undefined);
    const uid = process.getuid?.();
    if (info?.isDirectory() && (uid === undefined || info.uid === uid))
      await rm(join(parent, entry), { recursive: true, force: true });
  }
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

type Waiter = { grant(): void };

// A counter, not a scheduler: two FIFO lists and a live streak.
function createAdmission(maxAttempts: number, maxLiveStreak: number) {
  let running = 0;
  let liveStreak = 0;
  const live: Waiter[] = [];
  const background: Waiter[] = [];

  function next(): void {
    while (
      running < maxAttempts &&
      (live.length > 0 || background.length > 0)
    ) {
      // [STRATEGY] Live first; background jumps ahead only after a full streak.
      const takeBackground =
        background.length > 0 &&
        (live.length === 0 || liveStreak >= maxLiveStreak);
      if (takeBackground) liveStreak = 0;
      else if (background.length > 0) liveStreak += 1;
      const waiter = (takeBackground ? background : live).shift();
      running += 1;
      waiter?.grant();
    }
  }

  return {
    // Resolves with a release function; rejects when the signal aborts while
    // waiting, without ever holding a slot.
    acquire(
      isBackground: boolean,
      signal: AbortSignal | undefined,
    ): Promise<() => void> {
      return new Promise((resolve, reject) => {
        // [GUARD] Already cancelled: settle now; nothing is queued, so no
        // later abort event could ever settle it.
        if (signal?.aborted) return reject(new SessionAgentError("cancelled"));
        const queue = isBackground ? background : live;
        let released = false;
        const waiter: Waiter = {
          grant: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve(() => {
              if (released) return;
              released = true;
              running -= 1;
              next();
            });
          },
        };
        const onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(new SessionAgentError("cancelled"));
        };
        queue.push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        next();
      });
    },
  };
}

// The loader's typed failure, by its code only: a closed session and a failed
// read are retryable, a cancelled read is a cancel, and every other refusal
// (digest, media type, size, reference) is final.
function loadFailureCode(error: unknown): SessionAgentErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "session_closed") return "session-not-active";
  if (code === "read_failed") return "read-failed";
  if (code === "aborted") return "cancelled";
  return "attachment-refused";
}

// The per-attempt provider home: provider homes and config roots point at an
// empty private directory, so no history or credentials file is read or kept.
function ephemeralEnvironment(home: string): Record<string, string> {
  return {
    HOME: home,
    CODEX_HOME: home,
    CLAUDE_CONFIG_DIR: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
  };
}

export function createSessionAgentPort(
  options: SessionAgentPortOptions,
): SessionAgentPort {
  const base = options.stagingBase ?? defaultStagingBase();
  const admission = createAdmission(
    options.maxSessionAttempts ?? DEFAULT_MAX_CONCURRENT,
    options.maxLiveStreak ?? DEFAULT_MAX_LIVE_STREAK,
  );
  const active = new Map<
    string,
    { tenantId: string; controller: AbortController }
  >();
  // Attempt directories of running attempts, so a purge sweep never removes
  // the staging of another session's attempt.
  const owned = new Set<string>();

  async function clearBase(): Promise<void> {
    await sweepStagingBase(base);
  }

  async function clearIdle(): Promise<void> {
    await ensurePrivateBase(base);
    for (const entry of await readdir(base))
      if (!owned.has(join(base, entry)))
        await rm(join(base, entry), { recursive: true, force: true });
  }

  // [GUARD] Refusals that need no capacity: profile, tool-less proof, vision.
  function resolveRuntime(
    request: AiExecutionRequest,
    profile: AiProfile,
  ): { agent: AgentProfile; runtime: AgentRuntimeAdapter } {
    const agent = options.profiles.get(profile.id);
    const runtime = agent && options.runtimes[agent.runtime];
    if (!agent || !runtime) throw new SessionAgentError("profile-unavailable");
    try {
      validateAgentProfile(agent);
    } catch {
      throw new SessionAgentError("profile-unavailable");
    }
    // [SAFETY] A runtime that cannot prove tool-less operation, or a profile
    // that grants tools, is refused for session use.
    if (
      !runtime.capabilities.toolless ||
      agent.tools.length > 0 ||
      agent.sessionPersistence ||
      agent.webSearch ||
      agent.sandbox !== "read-only"
    )
      throw new SessionAgentError("toolless-unsupported");
    // [SAFETY] Screenshots fail closed: never answered text-only.
    const attachments = request.task.attachments ?? [];
    if (attachments.length > 0) {
      if (!runtime.capabilities.imageInput)
        throw new SessionAgentError("vision-unsupported");
      if (!options.attachmentSource)
        throw new SessionAgentError("attachment-refused");
    }
    return { agent, runtime };
  }

  // Writes each frozen image into the private directory (exclusive create,
  // never through a link) and returns attachments that name only staged files.
  async function stage(
    request: AiExecutionRequest,
    directory: string,
  ): Promise<AgentAttachment[]> {
    const staged: AgentAttachment[] = [];
    const attachments = request.task.attachments ?? [];
    for (const [index, attachment] of attachments.entries()) {
      const extension = IMAGE_EXTENSIONS[attachment.mimeType ?? ""];
      if (attachment.kind !== "image" || extension === undefined)
        throw new SessionAgentError("attachment-refused");
      let bytes: Uint8Array;
      try {
        bytes = await (options.attachmentSource as AttachmentSource)(
          request.context,
          attachment,
          request.signal,
        );
      } catch (error) {
        throw new SessionAgentError(loadFailureCode(error));
      }
      if (bytes.byteLength === 0 || bytes.byteLength > AGENT_IMAGE_MAX_BYTES)
        throw new SessionAgentError("attachment-refused");
      const path = join(directory, `image-${index}.${extension}`);
      const handle = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      staged.push({
        id: attachment.id,
        kind: "image",
        name: `image-${index}.${extension}`,
        reference: path,
        mimeType: attachment.mimeType as string,
      });
    }
    return staged;
  }

  async function* attempt(
    request: AiExecutionRequest,
    profile: AiProfile,
    executionId: string,
  ): AsyncIterable<AiEvent> {
    const controller = new AbortController();
    const forward = () => controller.abort();
    request.signal?.addEventListener("abort", forward, { once: true });
    if (request.signal?.aborted) controller.abort();
    active.set(executionId, { tenantId: request.context.tenantId, controller });
    let release: (() => void) | undefined;
    let directory: string | undefined;
    try {
      const { agent, runtime } = resolveRuntime(request, profile);
      if (controller.signal.aborted) throw new SessionAgentError("cancelled");
      release = await admission.acquire(
        options.isBackground?.(request, profile) ?? false,
        controller.signal,
      );
      // [SAFETY] After any capacity wait the session may have tightened or
      // ended: re-check before staging or touching a provider.
      const standing = await (options.stillPermitted?.(request, profile) ??
        true);
      if (standing === "not-active")
        throw new SessionAgentError("session-not-active");
      if (standing === "read-failed")
        throw new SessionAgentError("read-failed");
      if (!standing) throw new SessionAgentError("policy-refused");
      if (controller.signal.aborted) throw new SessionAgentError("cancelled");

      await ensurePrivateBase(base);
      directory = await mkdtemp(join(base, "attempt-"));
      owned.add(directory);
      const home = join(directory, "home");
      const work = join(directory, "work");
      const stagingRoot = join(directory, "stage");
      for (const path of [home, work, stagingRoot])
        await mkdir(path, { mode: 0o700 });
      const attachments = await stage(request, stagingRoot);

      // A timeout or cancel ends the attempt even if the runtime is slow to
      // answer its own cancel: the pull below races this promise.
      let stop: SessionAgentErrorCode | undefined;
      let halt: () => void = () => undefined;
      const halted = new Promise<"halted">((resolve) => {
        halt = () => resolve("halted");
      });
      const stopWith = (code: SessionAgentErrorCode) => {
        stop ??= code;
        void runtime.cancel(executionId).catch(() => undefined);
        halt();
      };
      const timer = setTimeout(() => stopWith("timeout"), agent.timeoutMs);
      const onCancel = () => stopWith("cancelled");
      controller.signal.addEventListener("abort", onCancel, { once: true });
      let iterator: AsyncIterator<AgentEvent> | undefined;
      try {
        const outputSchema = request.task.schema ?? agent.outputSchema;
        const run: AgentRunRequest = {
          runId: executionId,
          profile: agent,
          prompt: request.task.prompt,
          workingDirectory: work,
          additionalDirectories: [],
          attachments,
          attachmentRoot: stagingRoot,
          toolless: true,
          environment: ephemeralEnvironment(home),
          timeoutMs: agent.timeoutMs,
          ...(request.task.system === undefined
            ? {}
            : { systemPrompt: request.task.system }),
          ...(outputSchema === undefined ? {} : { outputSchema }),
        };
        yield { type: "started", executionId };
        let outputBytes = 0;
        iterator = runtime.run(run)[Symbol.asyncIterator]();
        while (true) {
          const pulled = await Promise.race([iterator.next(), halted]);
          if (pulled === "halted" || pulled.done) break;
          const event = pulled.value;
          if (event.type === "tool-started") {
            // [SAFETY] Defence in depth beside the adapter's own check.
            stop = "tool-refused";
            await runtime.cancel(executionId);
            break;
          }
          if (event.type === "text-delta") {
            outputBytes += Buffer.byteLength(event.text);
            if (outputBytes > agent.maximumOutputBytes) {
              stop = "output-too-large";
              await runtime.cancel(executionId);
              break;
            }
            yield event;
          } else if (event.type === "usage") {
            yield event;
          } else if (event.type === "completed") {
            yield { type: "completed", result: event.result.output };
            return;
          } else if (event.type === "failed") {
            // Provider text is dropped; only the code maps across.
            stop ??= codeFor(event.error);
            break;
          } else if (event.type === "awaiting-input") {
            // A tool-less single turn never asks the owner for input.
            stop = "provider";
            await runtime.cancel(executionId);
            break;
          }
        }
        throw new SessionAgentError(stop ?? "provider");
      } finally {
        // Closing the runtime's iterator ends it; never awaited, since a
        // runtime that ignores cancel must not hold this attempt open.
        void iterator?.return?.().catch(() => undefined);
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onCancel);
      }
    } catch (error) {
      const failure =
        error instanceof SessionAgentError
          ? error.failure
          : FAILURES["provider"];
      yield { type: "failed", error: { ...failure } };
    } finally {
      request.signal?.removeEventListener("abort", forward);
      active.delete(executionId);
      release?.();
      // [SAFETY] Staged screenshots and the provider home go on every exit:
      // success, failure, cancel, and an abandoned stream.
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        owned.delete(directory);
      }
    }
  }

  function codeFor(error: AiFailure): SessionAgentErrorCode {
    if (error.code === "cancelled") return "cancelled";
    if (error.code === "timeout") return "timeout";
    if (error.code === "rate-limit") return "rate-limit";
    if (error.code === "policy-refused") {
      // The adapter's own typed refusals keep their meaning.
      return error.message === FAILURES["attachment-refused"].message
        ? "attachment-refused"
        : error.message === FAILURES["tool-refused"].message
          ? "tool-refused"
          : "policy-refused";
    }
    return "provider";
  }

  // Maps a failed event's AiFailure back to its session code by its fixed
  // message, so execute() throws the same typed error stream() reports.
  function sessionCodeOf(error: AiFailure): SessionAgentErrorCode {
    for (const [code, failure] of Object.entries(FAILURES))
      if (failure.message === error.message)
        return code as SessionAgentErrorCode;
    return "provider";
  }

  return {
    sweep: clearBase,
    sweepIdle: clearIdle,
    async purge() {
      for (const { controller } of active.values()) controller.abort();
      await clearBase();
    },
    async execute(request, profile): Promise<AiExecution> {
      const executionId = crypto.randomUUID();
      let usage: AiUsage | undefined;
      for await (const event of attempt(request, profile, executionId)) {
        if (event.type === "usage") usage = event.usage;
        if (event.type === "completed")
          return {
            executionId,
            family: "agent-runtime",
            targetId: profile.targetId,
            result: event.result,
            ...(usage === undefined ? {} : { usage }),
          };
        if (event.type === "failed")
          throw new SessionAgentError(sessionCodeOf(event.error));
      }
      throw new SessionAgentError("provider");
    },
    stream: (request, profile) =>
      attempt(request, profile, crypto.randomUUID()),
    async cancel(context: AiAccessContext, executionId: string) {
      // [SAFETY] An execution id never reaches across tenants.
      const entry = active.get(executionId);
      if (entry?.tenantId === context.tenantId) entry.controller.abort();
    },
    // Session actions are single-turn; there is nothing to resume.
    async *resume() {
      yield {
        type: "failed",
        error: { ...FAILURES["profile-unavailable"] },
      };
    },
  };
}
