// What each presentation route answers when its handler throws, as data, and
// the one content-free failure log line.
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { AiFailureError, ImageAssetRefusedError } from "../domain/generation";
import {
  PresentationConflictError,
  PresentationNotFoundError,
  PresentationThemeNotFoundError,
} from "../domain/index";
import { ExportRefusedError } from "../export/index";

// [SAFETY] Failures are logged as metadata only: the route, the error's class
// and an engine failure's code, never a message, which can quote a prompt, a
// file or a reply.
export function logFailure(route: string, error: unknown) {
  console.error(
    JSON.stringify({
      route,
      error: error instanceof Error ? error.name : "non-error",
      ...(error instanceof AiFailureError ? { code: error.code } : {}),
    }),
  );
}

/** The request carries no tenant membership; the only cause of a 401. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

type ErrorType = abstract new (...args: never[]) => unknown;
type Answer = readonly [status: ContentfulStatusCode, error: string];

// What a route answers when its handler throws. `known` errors are answered
// with their own row and not logged; anything else is logged under `log` (when
// the route has one) and answered with `otherwise`, or with the error's own
// fixed message when it is the one refusal the route `shows`.
export interface Failures {
  known?: readonly (readonly [ErrorType, ...Answer])[];
  log?: string;
  shows?: ErrorType;
  otherwise: Answer;
}

const CONFLICT = [
  PresentationConflictError,
  409,
  "The presentation changed since it was loaded.",
] as const;
const NOT_FOUND = [PresentationNotFoundError, 404, "Not found"] as const;
const UNKNOWN_THEME = [
  PresentationThemeNotFoundError,
  400,
  "Theme not found.",
] as const;
const NO_MEMBERSHIP = [UnauthorizedError, 401, "Unauthorized"] as const;
const invalid = (error: string) => [z.ZodError, 400, error] as const;
// A document write names its own bad input, theme and membership; the rest is
// a logged 500.
const documentWrite = (
  error: string,
  ...first: NonNullable<Failures["known"]>
): Failures => ({
  known: [
    ...first,
    invalid(error),
    [SyntaxError, 400, error],
    UNKNOWN_THEME,
    NO_MEMBERSHIP,
  ],
  log: "presentation",
  otherwise: [500, "Request failed."],
});

const UNAUTHORIZED: Failures = { otherwise: [401, "Unauthorized"] };
const refuses = (error: string): Failures => ({ otherwise: [400, error] });

export const FAILURES = {
  listDocuments: UNAUTHORIZED,
  createDocument: documentWrite("Invalid presentation input."),
  readDocument: UNAUTHORIZED,
  saveDocument: documentWrite("Invalid presentation update.", CONFLICT),
  deleteDocument: UNAUTHORIZED,
  duplicateDocument: refuses("Unable to duplicate presentation."),
  favoriteDocument: refuses("Unable to update favorite."),
  saveSlide: {
    known: [CONFLICT, invalid("Invalid slide.")],
    otherwise: [401, "Unauthorized"],
  },
  deleteSlide: refuses("Unable to delete slide."),
  moveSlide: refuses("Unable to move slide."),
  listThemes: UNAUTHORIZED,
  createTheme: refuses("Invalid theme."),
  importTheme: {
    known: [invalid("Invalid PowerPoint theme upload.")],
    log: "theme-import",
    otherwise: [400, "The PowerPoint file could not be read as a theme."],
  },
  reactToTheme: refuses("Invalid theme reaction."),
  listImages: UNAUTHORIZED,
  uploadImage: {
    known: [invalid("Invalid image upload.")],
    otherwise: [400, "Unable to save image."],
  },
  generateOutline: {
    known: [invalid("Invalid generation request.")],
    log: "generate-outline",
    otherwise: [502, "Generation failed."],
  },
  generateSlide: {
    known: [invalid("Invalid slide generation request.")],
    log: "generate-slide",
    otherwise: [502, "Slide generation failed."],
  },
  generateImage: {
    known: [invalid("Invalid image request.")],
    log: "generate-image",
    shows: ImageAssetRefusedError,
    otherwise: [502, "Image generation failed."],
  },
  createShare: {
    known: [NOT_FOUND],
    otherwise: [400, "Unable to create share."],
  },
  revokeShare: refuses("Unable to revoke share."),
  exportDocument: {
    known: [NOT_FOUND],
    log: "export",
    shows: ExportRefusedError,
    otherwise: [400, "Export failed."],
  },
  saveRecording: {
    known: [NOT_FOUND],
    otherwise: [400, "Invalid recording."],
  },
  listRecordings: refuses("Unable to load recordings."),
} satisfies Record<string, Failures>;
