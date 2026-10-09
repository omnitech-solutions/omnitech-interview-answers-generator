// What a session asks of the AI engine, and how it asks (ADR-0037).
//
// PROBLEM: the processor must make model calls without knowing a provider, a
// model or a runtime, and every call must carry who the session's owner is,
// where it may be processed and which answer it belongs to. STRATEGY: one call
// shape in the session's own words, and one function that puts it to the
// engine and reads the answer back. The engine is handed in by the host; the
// processor names profiles and nothing else (rule:model-calls-gateway-routed).
import { createHash } from "node:crypto";
import type {
  AiEngine,
  Execution,
  Failure,
  ModelInput,
  ModelMessage,
} from "@omnitech/ai-engine";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { ProcessingPolicy } from "./core/index";
import type { OwnerScope } from "./scope";

// The one thing the session needs of the engine.
export type SessionEngine = Pick<AiEngine, "stream">;

// An image a task's answer rests on, named by its provenance id only. The
// host's runtime resolves the reference through the product's loader; the
// bytes never travel with the call.
export type SessionAttachment = {
  id: string;
  kind: "file" | "image";
  name: string;
  reference: string;
  mimeType?: string;
};
// How many a task may carry.
export const MAX_TASK_ATTACHMENTS = 4;

// Which runtime and model produced an answer. Display metadata from the
// host's own configuration, never from user input or model output. Never
// branched on (ADR-0007) and never logged with content.
export type AnsweredBy = { runtime: string; model: string };

// [SAFETY] Who a session's calls are made as: the product, the session OWNER
// as the actor, and the product's read permission. Tenant and actor come from
// the claimed session row, never from ingest or model content. The host's
// engine authorises by these permissions, as it does for every product call.
export const SESSION_CALL_IDENTITY = Object.freeze({
  productId: INTERVIEW_PRODUCT_ID,
  permissions: Object.freeze(["interview.read"]) as readonly string[],
});

export type SessionCall = {
  scope: OwnerScope;
  profileId: string;
  system: string;
  prompt: string;
  schema: Readonly<Record<string, unknown>>;
  attachments?: readonly SessionAttachment[];
  policy: ProcessingPolicy;
  // session:task:revision:stage:attempt, as the dispatch keys the call.
  idempotencyKey: string;
  // The answer this call belongs to.
  answer: { sessionId: string; taskId: string; revision: number };
  signal: AbortSignal;
};

// One part holds at most this much (the engine's stated bound), so a long
// prompt goes as several parts and none of it is lost.
const PART_CHARS = 100_000;
const textParts = (text: string) => {
  const cut: { type: "text"; text: string }[] = [];
  for (let at = 0; at < text.length; at += PART_CHARS)
    cut.push({ type: "text", text: text.slice(at, at + PART_CHARS) });
  return cut;
};

export function modelInputOf(call: SessionCall): ModelInput {
  const messages: ModelMessage[] = [];
  if (call.system)
    messages.push({ role: "system", parts: textParts(call.system) });
  messages.push({
    role: "user",
    parts: [
      ...textParts(call.prompt || " "),
      ...(call.attachments ?? []).map((attachment) => ({
        type: "attachment" as const,
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        reference: attachment.reference,
        ...(attachment.mimeType ? { mediaType: attachment.mimeType } : {}),
      })),
    ],
  });
  return {
    profileId: call.profileId,
    messages,
    schema: call.schema as NonNullable<ModelInput["schema"]>,
  };
}

export function executionOf(call: SessionCall): Execution {
  const { sessionId, taskId, revision } = call.answer;
  return {
    scope: {
      tenantId: call.scope.tenantId,
      actorId: call.scope.actorId,
      productId: SESSION_CALL_IDENTITY.productId,
    },
    permissions: SESSION_CALL_IDENTITY.permissions,
    signal: call.signal,
    policy: call.policy,
    idempotencyKey: call.idempotencyKey,
    for: { kind: "session-task", id: `${sessionId}:${taskId}` },
    // [DOMAIN] Every stage and repair of one answer is one trace, so it is
    // read back as one run. A W3C trace id: 32 hex characters.
    traceId: createHash("sha256")
      .update(`${sessionId}:${taskId}:${revision}`)
      .digest("hex")
      .slice(0, 32),
  };
}

// `failure` is absent when the call was cancelled.
export type SessionAnswer =
  | { ok: true; result: unknown }
  | { ok: false; failure?: Failure };

// Puts one call to the engine and reads its one answer. `onText` is told the
// text so far as it is written, for a draft a person reads while it grows.
// [SAFETY] Never throws for a model failure: the engine ends every call with
// one terminal part, and anything else is reported as a failure of the call.
export async function askEngine(
  engine: SessionEngine,
  call: SessionCall,
  onText?: (soFar: string) => Promise<void>,
): Promise<SessionAnswer> {
  let text = "";
  try {
    for await (const part of engine.stream(
      modelInputOf(call),
      executionOf(call),
    )) {
      if (part.type === "text") {
        text += part.text;
        await onText?.(text);
      } else if (part.type === "done") return { ok: true, result: part.value };
      else if (part.type === "failed")
        return { ok: false, failure: part.failure };
      else if (part.type === "cancelled") return { ok: false };
    }
  } catch {
    // An engine that broke its own contract is an unavailable model.
  }
  return {
    ok: false,
    failure: {
      code: "unavailable",
      reason: "The call ended without an answer.",
      retryable: true,
    },
  };
}
