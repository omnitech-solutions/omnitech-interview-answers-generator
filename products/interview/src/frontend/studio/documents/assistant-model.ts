// The assistant's model picker owns the app's model choice, and the vendored
// assistant package keeps it only in this per-viewer preference (it exports no
// live state). This is the one place that knows the key; everything else asks
// for a document target.
const ASSISTANT_MODEL_KEY = "omnitech-assistant:model";

export function assistantModelId(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(ASSISTANT_MODEL_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

// `kind` is the platform's own attribute for how a target runs (a model API,
// an agent runtime, an image provider); product code reads it and never
// branches on a provider or model name (ADR-0007).
export type DocumentTarget = {
  id: string;
  label: string;
  kind?: "model" | "agent" | "image";
};
export type TargetResolution = {
  target: DocumentTarget | undefined;
  // The assistant's pick, when it cannot write documents and so was not used.
  skipped: string | null;
};

// Generation follows the assistant's model when that model can write
// documents. Otherwise the first agent target the platform lists (the
// signed-in CLI agents), then whatever the host offers first.
export function documentTarget(
  targets: readonly DocumentTarget[],
  preferred: string | null = assistantModelId(),
): TargetResolution {
  const chosen = preferred
    ? targets.find((item) => item.id === preferred)
    : undefined;
  if (chosen) return { target: chosen, skipped: null };
  return {
    target: targets.find((item) => item.kind === "agent") ?? targets[0],
    skipped: preferred,
  };
}
