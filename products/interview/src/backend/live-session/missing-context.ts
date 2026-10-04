// What a screen-based draft says it could not see (constraints, examples, ...).
// Display metadata only: nothing branches on it, it is never a claim, and it is
// never logged. Lenient by design: a malformed field or entry is dropped, never
// the whole draft (and never a read).
import {
  LIVE_MISSING_CONTEXT_MAX_ITEMS,
  type LiveMissingContext,
  liveMissingContextItemSchema,
} from "@omnitech/interview-contracts";

// Keeps each well-formed entry (closed kind, plain-text note of at most 120
// characters), the first of each kind, at most four. A bad note drops its
// entry. Returns undefined when nothing survives.
export function sanitizeMissingContext(
  raw: unknown,
): LiveMissingContext | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kept: LiveMissingContext[number][] = [];
  for (const entry of raw) {
    if (kept.length >= LIVE_MISSING_CONTEXT_MAX_ITEMS) break;
    const parsed = liveMissingContextItemSchema.safeParse(entry);
    if (!parsed.success) continue;
    if (kept.some((item) => item.kind === parsed.data.kind)) continue;
    kept.push(parsed.data);
  }
  return kept.length > 0 ? kept : undefined;
}
