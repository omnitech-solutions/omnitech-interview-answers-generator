import type {
  Scope as EngineScope,
  Execution,
  Failure,
  Prepared,
  PrepareResult,
  Resolved,
  ResolveResult,
} from "@omnitech/ai-engine";
import { INTERVIEW_PRODUCT_ID } from "../assistant-profile";

export type EngineSubject = NonNullable<Execution["for"]>;
export type Asker = { tenantId: string; actorId: string };

export function asking(
  who: Asker,
  access: "read" | "write",
  signal: AbortSignal,
  about?: EngineSubject,
): {
  scope: EngineScope;
  permissions: readonly string[];
  signal: AbortSignal;
  for?: EngineSubject;
} {
  return {
    scope: {
      tenantId: who.tenantId,
      actorId: who.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    },
    permissions:
      access === "read"
        ? ["interview.read"]
        : ["interview.read", "interview.documents.write"],
    signal,
    ...(about === undefined ? {} : { for: about }),
  };
}

type Failed = { readonly ok: false; readonly failure: Failure };
type Value<T> = { readonly ok: true; readonly value: T };

export function valueOrThrow<T>(
  result: Value<T> | Failed,
  signal: AbortSignal,
  refused: (reason: string) => Error,
): T;
export function valueOrThrow(
  result: PrepareResult,
  signal: AbortSignal,
  refused: (reason: string) => Error,
): Prepared;
export function valueOrThrow(
  result: ResolveResult,
  signal: AbortSignal,
  refused: (reason: string) => Error,
): Resolved;
export function valueOrThrow<T>(
  result: Value<T> | PrepareResult | ResolveResult,
  signal: AbortSignal,
  refused: (reason: string) => Error,
): T | Prepared | Resolved {
  if (signal.aborted || (!result.ok && result.failure.code === "cancelled"))
    throw new DOMException("Engine request cancelled.", "AbortError");
  if (!result.ok) throw refused(result.failure.reason);
  if ("value" in result) return result.value;
  if ("prepared" in result) return result.prepared;
  return result.resolved;
}
