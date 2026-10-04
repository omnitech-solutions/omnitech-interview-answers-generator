// The owner's commands over a session store. Each one calls its route, replaces
// the session from the server's response (the record is authoritative) and
// answers with a result carrying a fixed error code, never a message.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { SessionApiError, type SessionClient } from "./session-client";
import type {
  CommandResult,
  LiveSnapshot,
  SessionActions,
  SessionCommand,
} from "./session-snapshot";
import { errorCodeOf } from "./session-codes";

// What the commands need from the store; nothing else is shared.
export type CommandContext = {
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
  // The deps' owner-input methods; absent until the server route ships.
  analyzeLatestCapture?(sessionId: string): Promise<void>;
  submitFollowUp?(sessionId: string, text: string): Promise<void>;
};

export function createSessionActions(context: CommandContext): SessionActions {
  const { client } = context;
  const inFlight = new Map<SessionCommand, Promise<CommandResult>>();

  // The same command pressed twice shares one request; different commands run
  // side by side, so End is never queued behind anything.
  function run(
    command: SessionCommand,
    work: () => Promise<void>,
  ): Promise<CommandResult> {
    const existing = inFlight.get(command);
    if (existing) return existing;
    const promise = (async (): Promise<CommandResult> => {
      context.set({
        pending: [...context.snapshot().pending, command],
        commandError: null,
      });
      try {
        await work();
        return { ok: true };
      } catch (error) {
        const code = errorCodeOf(error);
        context.set({ commandError: code });
        return { ok: false, code };
      } finally {
        inFlight.delete(command);
        context.set({
          pending: context
            .snapshot()
            .pending.filter((item) => item !== command),
        });
      }
    })();
    inFlight.set(command, promise);
    return promise;
  }
  const sessionId = (): string => {
    const id = context.snapshot().session?.id;
    if (!id) throw new SessionApiError("not_found", 0);
    return id;
  };
  const applied = (view: LiveSessionView) => {
    context.markCommandAnswered();
    context.adopt(view);
  };

  return {
    start: (request) =>
      run("start", async () => {
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
      }),
    pause: () =>
      run("pause", async () => {
        applied(await client.control(sessionId(), "pause"));
        context.restartLoop();
      }),
    resume: () =>
      run("resume", async () => {
        applied(await client.control(sessionId(), "resume"));
        context.restartLoop();
      }),
    end: () =>
      run("end", async () => {
        const id = sessionId();
        applied(await client.control(id, "end"));
        context.stopTimer();
        // The last transcript lines and results, once, before polling stops.
        await context.finalRead(id);
      }),
    renewCredential: () =>
      run("renew", async () => {
        const credential = await client.renewCredential(sessionId());
        context.set({ pairing: credential });
      }),
    revokeCredential: () =>
      run("revoke", async () => {
        const id = sessionId();
        await client.revokeCredential(id);
        // Revoking pauses a live session: read the record, not guess it.
        applied(await client.get(id));
        context.restartLoop();
      }),
    tightenLocality: () =>
      run("tighten", async () => {
        applied(await client.tightenPolicy(sessionId(), "device-only"));
      }),
    shortenRetention: (retention) =>
      run("shorten", async () => {
        applied(await client.shortenRetention(sessionId(), retention));
      }),
    deleteSession: () =>
      run("delete", async () => {
        applied(await client.deleteSession(sessionId()));
        context.resetLoop();
        context.restartLoop();
      }),
    analyzeLatestCapture: () =>
      run("analyze", async () => {
        const send = context.analyzeLatestCapture;
        if (!send) throw new SessionApiError("unavailable", 0);
        await send(sessionId());
        context.restartLoop();
      }),
    submitFollowUp: (text) =>
      run("follow-up", async () => {
        const send = context.submitFollowUp;
        if (!send) throw new SessionApiError("unavailable", 0);
        // [GUARD] Nothing empty is sent; the text goes to the route only.
        const trimmed = text.trim();
        if (trimmed === "") throw new SessionApiError("invalid_input", 0);
        await send(sessionId(), trimmed);
        context.restartLoop();
      }),
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
  };
}
