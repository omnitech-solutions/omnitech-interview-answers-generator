// What a generation request asks a model for, and which image references the
// product can show. Pure: no engine, no storage.

export interface OutlineRequest {
  prompt: string;
  slideCount?: number | undefined;
  language?: string | undefined;
  layout?: string | undefined;
  textContent?: string | undefined;
  tone?: string | undefined;
  audience?: string | undefined;
  scenario?: string | undefined;
}

// "Auto" (or nothing) leaves the choice to the model, so it is not stated.
const chosen = (value: string | undefined) =>
  value && value !== "Auto" ? value : undefined;

// [DOMAIN] The outline prompt, one paragraph per supplied option, in this
// order. An option that was not supplied adds nothing.
const OUTLINE_PARAGRAPHS: readonly ((
  request: OutlineRequest,
) => string | undefined)[] = [
  ({ prompt }) => prompt,
  ({ slideCount }) =>
    slideCount === undefined
      ? undefined
      : `Create an outline for exactly ${slideCount} slides.`,
  ({ language }) =>
    language === undefined ? undefined : `Write the outline in ${language}.`,
  ({ textContent }) =>
    textContent ? `Use ${textContent} text content.` : undefined,
  ({ tone }) => (chosen(tone) ? `Tone: ${tone}.` : undefined),
  ({ audience }) => (chosen(audience) ? `Audience: ${audience}.` : undefined),
  ({ scenario }) => (chosen(scenario) ? `Scenario: ${scenario}.` : undefined),
  ({ layout }) =>
    layout === undefined
      ? undefined
      : `Use a ${layout} presentation structure.`,
];

export function outlinePrompt(request: OutlineRequest): string {
  return OUTLINE_PARAGRAPHS.map((paragraph) => paragraph(request))
    .filter(Boolean)
    .join("\n\n");
}

/** The shapes a model's reply must have, as the engine's JSON schemas. */
export const OUTLINE_REPLY = {
  type: "object",
  required: ["title", "outline"],
  properties: {
    title: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
  },
} as const;

export const SLIDE_REPLY = {
  type: "object",
  required: ["sourceXml"],
  properties: { sourceXml: { type: "string" } },
} as const;

// The only refusal whose message reaches the client: fixed text, written here.
export class ImageAssetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageAssetRefusedError";
  }
}

// The engine reported a failed generation. Only its code is kept: its detail
// can carry provider text, which can quote a prompt or a reply.
export class AiFailureError extends Error {
  constructor(readonly code: string) {
    super("The AI engine reported a failure.");
    this.name = "AiFailureError";
  }
}

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// [GUARD] An image the product stores is an image data URL or a web address;
// an address on this machine only from a provider declared local.
export function validateImageAssetReference(
  value: string,
  localProvider = false,
): void {
  if (value.startsWith("data:image/")) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImageAssetRefusedError(
      "Image assets must use an HTTP(S) URL or image data URL.",
    );
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) {
    throw new ImageAssetRefusedError(
      "Image assets must use an HTTP(S) URL or image data URL.",
    );
  }
  if (!localProvider && LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new ImageAssetRefusedError(
      "Image assets cannot point to loopback hosts.",
    );
  }
}
