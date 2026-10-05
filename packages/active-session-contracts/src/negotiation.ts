import { opaqueIdSchema } from "./ids";

// Wire negotiation (ADR-0020). The acknowledgement objects are strict, so a new
// field is not additive for a reader that does not know it. A companion
// therefore DECLARES what it understands on every ingest request, in headers
// outside the strict bodies (an older Studio ignores them, so a newer companion
// still works against it), and Studio emits a field an older reader would
// reject only to a companion that declared it.
//   x-companion-features: space- or comma-separated feature tokens
//   x-companion-screen:   the companion's opaque token for the screen source it
//                         has selected (display identity plus selection
//                         generation); changes whenever the selection does
export const COMPANION_FEATURES_HEADER = "x-companion-features";
export const COMPANION_SCREEN_HEADER = "x-companion-screen";

// control.capture, screenshot requestId, and the capture.failure message.
export const COMPANION_FEATURE_CAPTURE_REQUEST = "capture-request.v1";

export type CompanionDeclaration = {
  captureRequests: boolean;
  screenSelection?: string;
};

export const formatCompanionFeatures = (
  features: readonly string[] = [COMPANION_FEATURE_CAPTURE_REQUEST],
): string => features.join(" ");

// Tolerant reading of an untrusted header: unknown tokens are ignored and an
// unusable screen token is absent, never an error.
export function parseCompanionDeclaration(
  read: (name: string) => string | null | undefined,
): CompanionDeclaration {
  const features = (read(COMPANION_FEATURES_HEADER) ?? "")
    .split(/[\s,]+/)
    .filter((token) => token !== "");
  const screen = opaqueIdSchema.safeParse(read(COMPANION_SCREEN_HEADER));
  return {
    captureRequests: features.includes(COMPANION_FEATURE_CAPTURE_REQUEST),
    ...(screen.success ? { screenSelection: screen.data } : {}),
  };
}
