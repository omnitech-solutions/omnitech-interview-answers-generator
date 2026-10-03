import { z } from "zod";
import {
  acknowledgementSchema,
  capabilityReportSchema,
  heartbeatSchema,
} from "./control.js";
import { WIRE_VERSION } from "./ids.js";
import { observationSchema } from "./observation.js";

// The published wire description for non-TypeScript consumers (the Swift
// companion's conformance tests). It is derived from the zod schemas and never
// hand-edited: `pnpm --filter @omnitech/active-session-contracts
// schema:generate` rewrites it and a test fails when it drifts.
export const COMPANION_MESSAGE_KINDS = [
  "transcript.final",
  "screen.snapshot",
  "source.disconnected",
  "capture.gap",
  "heartbeat",
  "capability.report",
] as const;

const companionMessageSchema = z.union([
  observationSchema,
  heartbeatSchema,
  capabilityReportSchema,
]);

const toJsonSchema = (schema: z.ZodType) => {
  const { $schema: _omitted, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  return rest;
};

export function buildWireSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Active Session wire",
    wireVersion: WIRE_VERSION,
    messageKinds: [...COMPANION_MESSAGE_KINDS],
    companionMessage: toJsonSchema(companionMessageSchema),
    acknowledgement: toJsonSchema(acknowledgementSchema),
  };
}

export const serializeWireSchema = (schema: Record<string, unknown>) =>
  `${JSON.stringify(schema, null, 2)}\n`;

// One corpus file as read from disk; the manifest is derived from the files so
// it can never disagree with them.
export type CorpusFile = { file: string; json: unknown };

export type CorpusManifestEntry =
  | {
      file: string;
      outcome: "valid";
      family: "ingest" | "acknowledgement";
      kind: string;
    }
  | {
      file: string;
      outcome: "invalid";
      family: "ingest";
      kind: string;
      issueCodes: string[];
    };

const kindOf = (message: unknown) => {
  const kind =
    typeof message === "object" && message !== null
      ? (message as { kind?: unknown }).kind
      : undefined;
  return typeof kind === "string" ? kind : "unknown";
};

// Valid files hold the bare message; invalid files hold
// { description, message, expect: { ok: false, issueCodes } }. Entries are
// sorted by path so the manifest is stable.
export function buildCorpusManifest(files: CorpusFile[]) {
  const entries = [...files]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((entry): CorpusManifestEntry => {
      if (entry.file.startsWith("invalid/")) {
        const { message, expect } = entry.json as {
          message: unknown;
          expect: { issueCodes: string[] };
        };
        return {
          file: entry.file,
          outcome: "invalid",
          family: "ingest",
          kind: kindOf(message),
          issueCodes: expect.issueCodes,
        };
      }
      const status = (entry.json as { status?: unknown }).status;
      return typeof status === "string"
        ? {
            file: entry.file,
            outcome: "valid",
            family: "acknowledgement",
            kind: `acknowledgement.${status}`,
          }
        : {
            file: entry.file,
            outcome: "valid",
            family: "ingest",
            kind: kindOf(entry.json),
          };
    });
  return { wireVersion: WIRE_VERSION, entries };
}
