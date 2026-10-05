// The owner's commands over a session store. Each one calls its route, replaces
// the session from the server's response (the record is authoritative) and
// answers with a result carrying a fixed error code, never a message.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { clearOwnerPaused, markOwnerPaused } from "./overlay/auto-owner-pause";
import { SessionApiError, type SessionClient } from "./session-client";
import { errorCodeOf } from "./session-codes";
import type { OwnerInputPort } from "./session-deps";
import type {
  CaptureRequestResult,
  CommandResult,
  LiveSnapshot,
  SessionActions,
  SessionCommand,
} from "./session-snapshot";

// What the commands need from the store; nothing else is shared.
export type CommandContext = OwnerInputPort & {
  client: SessionClient;
  snapshot(): LiveSnapshot;
  set(patch: Partial<LiveSnapshot>): void;
  adopt(view: LiveSessionView): void;
  forget(): void;
  // Drop the held finished session and everything read for it.
  clearFinished(): void;
  isOpen(session: LiveSessionView | null): boolean;
  // Raised on every command response: a stream page that began earlier cannot
  // overwrite the newer session record.
  markCommandAnswered(): void;
  // Stop the poll timer and take the next step now.
  restartLoop(): void;
  stopTimer(): void;
  // Waits for any read in flight, then reads the stream once more.
  finalRead(sessionId: string): Promise<void>;
  // A fresh start: failures and purge waits no longer apply.
  resetLoop(): void;
  refresh(): Promise<void>;
  // Make the store follow this session (and no other) until told otherwise.
  bindSession(view: LiveSessionView): void;
  // Raised by every bindSession: what a command captured when it began.
  bindEpoch(): number;
};

// The session and bind epoch a command began under. Its answer is applied only
// while that binding is still the store's: a result for a session the owner has
// since switched away from is dropped, never adopted again.
type Binding = { id: string | null; epoch: number };

export function createSessionActions(context: CommandContext): SessionActions {
  const { client } = context;
  const inFlight = new Map<string, Promise<CommandResult>>();
  // Every operation in flight; a null binding is a global one (start, switch).
  type Operation = { command: SessionCommand; binding: Binding | null };
  const operations = new Set<Operation>();
  // The binding each companion capture request was made under, so its status is
  // read for that session and its answer ignored once another is bound.
  const captureOrigins = new Map<string, Binding>();
  let switchToken = 0;

  const binding = (): Binding => ({
    id: context.snapshot().session?.id ?? null,
    epoch: context.bindEpoch(),
  });
  const live = (bound: Binding): boolean =>
    context.bindEpoch() === bound.epoch &&
    (context.snapshot().session?.id ?? null) === bound.id;
  const sessionIdOf = (bound: Binding): string => {
    if (!bound.id) throw new SessionApiError("not_found", 0);
    return bound.id;
  };
  // Pending shows only what belongs to the session on screen.
  function publishPending(extra: Partial<LiveSnapshot> = {}) {
    context.set({
      ...extra,
      pending: [...operations]
        .filter((op) => op.binding === null || live(op.binding))
        .map((op) => op.command),
    });
  }
  function begin(command: SessionCommand, bound: Binding | null): Operation {
    const op: Operation = { command, binding: bound };
    operations.add(op);
    publishPending({ commandError: null });
    return op;
  }
  function finish(op: Operation) {
    operations.delete(op);
    publishPending();
  }

  // The same command pressed twice on the same session shares one request;
  // different commands, or the same one on another session, run side by side,
  // so End is never queued behind anything.
  function run(
    command: SessionCommand,
    work: (bound: Binding) => Promise<void>,
    scope: "session" | "global" = "session",
  ): Promise<CommandResult> {
    const bound = binding();
    const key =
      scope === "global"
        ? command
        : `${command}|${bound.id ?? ""}|${bound.epoch}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = (async (): Promise<CommandResult> => {
      const op = begin(command, scope === "global" ? null : bound);
      try {
        await work(bound);
        return { ok: true };
      } catch (error) {
        const code = errorCodeOf(error);
        // [SAFETY] A failure of the session left behind says nothing about this one.
        if (scope === "global" || live(bound))
          context.set({ commandError: code });
        return { ok: false, code };
      } finally {
        inFlight.delete(key);
        finish(op);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }
  // Show the new status at once and reconcile with the server's answer: the
  // record that comes back replaces it, and a refusal puts the old one back.
  async function optimistically(
    bound: Binding,
    status: LiveSessionView["status"],
    work: () => Promise<void>,
  ): Promise<void> {
    const before = context.snapshot().session;
    if (
      before &&
      live(bound) &&
      context.isOpen(before) &&
      before.status !== status
    ) {
      // A stream page already in flight must not put the old status back.
      context.markCommandAnswered();
      context.set({ session: { ...before, status } });
    }
    try {
      await work();
    } catch (error) {
      const now = context.snapshot().session;
      if (
        before &&
        live(bound) &&
        now?.id === before.id &&
        now.status === status
      )
        context.set({ session: before });
      throw error;
    }
  }
  // Adopt the server's record only for the binding that asked. True when applied.
  const applied = (bound: Binding, view: LiveSessionView): boolean => {
    if (!live(bound)) return false;
    context.markCommandAnswered();
    context.adopt(view);
    return true;
  };
  const restartIfLive = (bound: Binding) => {
    if (live(bound)) context.restartLoop();
  };

  return {
    start: (request) =>
      run(
        "start",
        async () => {
          const started = await client.start(request);
          context.markCommandAnswered();
          context.forget();
          context.adopt(started.session);
          context.set({
            pairing: started.credential,
            hydration: "ready",
            streamError: null,
          });
          context.resetLoop();
          context.restartLoop();
        },
        "global",
      ),
    pause: () =>
      run("pause", async (bound) => {
        // The owner pressed it: Auto never resumes this one (ADR-0022).
        if (bound.id) markOwnerPaused(bound.id);
        await optimistically(bound, "paused", async () => {
          applied(bound, await client.control(sessionIdOf(bound), "pause"));
        });
        restartIfLive(bound);
      }),
    resume: () =>
      run("resume", async (bound) => {
        if (bound.id) clearOwnerPaused(bound.id);
        await optimistically(bound, "active", async () => {
          applied(bound, await client.control(sessionIdOf(bound), "resume"));
        });
        restartIfLive(bound);
      }),
    stopWork: () =>
      run("stop-work", async (bound) => {
        applied(bound, await client.control(sessionIdOf(bound), "stop-work"));
      }),
    end: () =>
      run("end", async (bound) => {
        const id = sessionIdOf(bound);
        if (!applied(bound, await client.control(id, "end"))) return;
        context.stopTimer();
        // The last transcript lines and results, once, before polling stops.
        await context.finalRead(id);
      }),
    renewCredential: () =>
      run("renew", async (bound) => {
        const credential = await client.renewCredential(sessionIdOf(bound));
        if (live(bound)) context.set({ pairing: credential });
      }),
    revokeCredential: () =>
      run("revoke", async (bound) => {
        const id = sessionIdOf(bound);
        await client.revokeCredential(id);
        // Revoking pauses a live session: read the record, not guess it.
        if (applied(bound, await client.get(id))) context.restartLoop();
      }),
    tightenLocality: () =>
      run("tighten", async (bound) => {
        applied(
          bound,
          await client.tightenPolicy(sessionIdOf(bound), "device-only"),
        );
      }),
    shortenRetention: (retention) =>
      run("shorten", async (bound) => {
        applied(
          bound,
          await client.shortenRetention(sessionIdOf(bound), retention),
        );
      }),
    deleteSession: () =>
      run("delete", async (bound) => {
        if (!applied(bound, await client.deleteSession(sessionIdOf(bound))))
          return;
        context.resetLoop();
        context.restartLoop();
      }),
    analyzeLatestCapture: (target, hints, snapshot) =>
      run("analyze", async (bound) => {
        const send = context.analyzeLatestCapture;
        if (!send) throw new SessionApiError("unavailable", 0);
        await send(sessionIdOf(bound), target, hints, snapshot);
        restartIfLive(bound);
      }),
    analyzeCapture: (input) =>
      run("analyze", async (bound) => {
        const send = context.analyzeCapture;
        if (!send) throw new SessionApiError("unavailable", 0);
        await send(sessionIdOf(bound), input);
        restartIfLive(bound);
      }),
    async requestCapture(input) {
      const bound = binding();
      const op = begin("capture-request", bound);
      try {
        const send = context.requestCapture;
        if (!send) throw new SessionApiError("unavailable", 0);
        const state = await send(sessionIdOf(bound), input);
        if (state.status === "pending")
          captureOrigins.set(state.requestId, bound);
        restartIfLive(bound);
        return { ok: true, state } satisfies CaptureRequestResult;
      } catch (error) {
        const code = errorCodeOf(error);
        if (live(bound)) context.set({ commandError: code });
        return { ok: false, code } satisfies CaptureRequestResult;
      } finally {
        finish(op);
      }
    },
    // A status read is a poll, not a command: its failure is the caller's to
    // handle and does not become the session's command error. It reads the
    // session that made the request; once another session is bound the request
    // is no longer ours to follow ("not_found" stops the caller's poll).
    async captureStatus(requestId) {
      const origin = captureOrigins.get(requestId) ?? binding();
      try {
        const read = context.captureStatus;
        if (!read) throw new SessionApiError("unavailable", 0);
        if (!live(origin)) {
          captureOrigins.delete(requestId);
          throw new SessionApiError("not_found", 0);
        }
        const state = await read(sessionIdOf(origin), requestId);
        if (!live(origin)) {
          captureOrigins.delete(requestId);
          throw new SessionApiError("not_found", 0);
        }
        if (state.status !== "pending") captureOrigins.delete(requestId);
        return { ok: true, state };
      } catch (error) {
        return { ok: false, code: errorCodeOf(error) };
      }
    },
    submitFollowUp: (text, target, hints) =>
      run("follow-up", async (bound) => {
        const send = context.submitFollowUp;
        if (!send) throw new SessionApiError("unavailable", 0);
        // [GUARD] Nothing empty is sent; the text goes to the route only.
        const trimmed = text.trim();
        if (trimmed === "") throw new SessionApiError("invalid_input", 0);
        await send(sessionIdOf(bound), trimmed, target, hints);
        restartIfLive(bound);
      }),
    solveTask: (target, hints) =>
      run("solve", async (bound) => {
        const send = context.solveTask;
        if (!send) throw new SessionApiError("unavailable", 0);
        await send(sessionIdOf(bound), target, hints);
        restartIfLive(bound);
      }),
    // Not a `run` command: phrases arrive back to back and each is its own
    // request, so none may share another's in-flight call, and heard speech
    // is not shown as a pending command.
    async submitHeard(text, requestId) {
      const bound = binding();
      try {
        const send = context.submitHeard;
        if (!send) throw new SessionApiError("unavailable", 0);
        const trimmed = text.trim();
        if (trimmed === "") throw new SessionApiError("invalid_input", 0);
        await send(sessionIdOf(bound), trimmed, requestId);
        return { ok: true } satisfies CommandResult;
      } catch (error) {
        return { ok: false, code: errorCodeOf(error) } satisfies CommandResult;
      }
    },
    dismissPairing: () => {
      if (context.snapshot().pairing) context.set({ pairing: null });
    },
    dismissFinished: () => {
      const held = context.snapshot().session;
      if (held && !context.isOpen(held)) context.clearFinished();
    },
    async openSession(id) {
      const held = context.snapshot().session;
      // A running or paused session is never displaced by a lookup.
      if (context.isOpen(held) || held?.id === id) return;
      try {
        const view = await client.get(id);
        context.adopt(view);
        context.set({ hydration: "ready", streamError: null });
        context.restartLoop();
      } catch (error) {
        const code = errorCodeOf(error);
        if (code === "not_found")
          context.set({ notFoundSessionId: id, hydration: "ready" });
        else context.set({ streamError: code });
      }
    },
    refresh: () => context.refresh(),
    async listSessions() {
      try {
        const page = await client.list({ limit: 20 });
        return { ok: true, sessions: page.sessions };
      } catch (error) {
        return { ok: false, code: errorCodeOf(error) };
      }
    },
    // Only the latest request wins: a second request made while the first is
    // still reading supersedes it, whatever order the answers arrive in. Nothing
    // is sent to the session left behind; this is only reads.
    async switchSession(id) {
      const token = ++switchToken;
      const op = begin("switch", null);
      try {
        if (context.snapshot().session?.id === id) return { ok: true };
        const view = await client.get(id);
        if (token !== switchToken) return { ok: true };
        context.markCommandAnswered();
        context.bindSession(view);
        return { ok: true };
      } catch (error) {
        const code = errorCodeOf(error);
        if (token !== switchToken) return { ok: true };
        context.set({ commandError: code });
        return { ok: false, code };
      } finally {
        // The binding may have moved: what was pending for the old session goes.
        finish(op);
      }
    },
  };
}
