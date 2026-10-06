// [DOMAIN] Where someone goes after signing in. The target travels in the
// sign-in URL (`/sign-in?next=...`), so it is attacker-controlled input.
//
// [SAFETY] Only a same-origin path under /t/ is ever a target. The checks
// run on the raw text AND the decoded text, so neither `//host`, `/\host`,
// an encoded backslash or newline, nor a `..` escape out of /t/ survives.

const MAX_TARGET_LENGTH = 2048;
const FALLBACK_TARGET = "/t/local/p/interview";
const PLACEHOLDER_ORIGIN = "http://studio.invalid";

const hasUnsafeCharacter = (text: string) =>
  [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f || character === "\\";
  });

export function safeReturnTarget(value: unknown): string | null {
  // [GUARD] A repeated parameter arrives as an array: never a target.
  if (typeof value !== "string") return null;
  if (!value || value.length > MAX_TARGET_LENGTH) return null;
  if (!value.startsWith("/t/")) return null;
  if (hasUnsafeCharacter(value)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (hasUnsafeCharacter(decoded)) return null;
  // [STRATEGY] The URL parser resolves `..` (also when percent-encoded), so
  // what is checked is the path the browser would really request.
  let parsed: URL;
  try {
    parsed = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;
  if (!parsed.pathname.startsWith("/t/")) return null;
  return `${parsed.pathname}${parsed.search}`;
}

// The sign-in page for a visitor who asked for `next`.
export function signInPath(
  next: unknown,
  options: { expired?: boolean } = {},
): string {
  const query = new URLSearchParams();
  const target = safeReturnTarget(next);
  if (target) query.set("next", target);
  if (options.expired) query.set("reason", "expired");
  const text = query.toString();
  return text ? `/sign-in?${text}` : "/sign-in";
}

export type SignedInProvider = "google" | "linkedin" | "local";

// Where a fresh sign-in lands: the target (or the product's home) carrying
// which provider just signed in, so the app can welcome the person once.
export function withSignedInMarker(
  next: string | null,
  provider: SignedInProvider,
): string {
  const url = new URL(next ?? FALLBACK_TARGET, PLACEHOLDER_ORIGIN);
  url.searchParams.set("signed-in", provider);
  return `${url.pathname}${url.search}`;
}

const VIEW_LABELS: Readonly<Record<string, string>> = {
  home: "Home",
  work: "Workspace",
  briefings: "Briefings",
  documents: "Documents",
  knowledge: "Knowledge",
  rehearsal: "Rehearsal",
  live: "Live session",
};

// The name of the place the banner promises ("You'll go back to ...").
export function returnTargetLabel(target: string): string {
  const match = /^\/t\/[^/]+\/p\/interview(?:\/([^/?]+))?/.exec(target);
  if (!match) return "the page you asked for";
  const view = match[1];
  if (!view) return "Interview Studio";
  return Object.hasOwn(VIEW_LABELS, view)
    ? (VIEW_LABELS[view] ?? "Interview Studio")
    : "Interview Studio";
}
