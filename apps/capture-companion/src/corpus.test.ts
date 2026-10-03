// The shared wire corpus is the contract between companions and Studio. Every
// valid message this companion can emit must be reproduced by its builders,
// and every invalid message must be refused by its own pre-send validation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acknowledgementSchema,
  type IngestMessage,
  validateIngestMessage,
} from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import { CompanionError } from "./errors.js";
import { FAKE_CREDENTIAL, fakeStudio } from "./fixture/fake-studio.js";
import {
  capabilityReportMessage,
  captureGapMessage,
  heartbeatMessage,
  screenSnapshotMessage,
  sourceDisconnectedMessage,
  transcriptFinalMessage,
} from "./messages.js";
import { createWireClient } from "./wire-client.js";

const corpusRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/active-session-contracts/corpus",
);
type Entry = {
  file: string;
  outcome: "valid" | "invalid";
  family: "ingest" | "acknowledgement";
  kind: string;
  issueCodes?: string[];
};
const readJson = (file: string) =>
  JSON.parse(readFileSync(join(corpusRoot, file), "utf8")) as Record<
    string,
    unknown
  >;
const entries = (readJson("index.json") as unknown as { entries: Entry[] })
  .entries;

// Each builder takes the body (everything but version and kind).
const builders: Record<string, (body: never) => unknown> = {
  "transcript.final": transcriptFinalMessage,
  "screen.snapshot": screenSnapshotMessage,
  "source.disconnected": sourceDisconnectedMessage,
  "capture.gap": captureGapMessage,
  heartbeat: heartbeatMessage,
  "capability.report": capabilityReportMessage,
};

const validIngest = entries.filter(
  (entry) => entry.outcome === "valid" && entry.family === "ingest",
);
const invalidIngest = entries.filter((entry) => entry.outcome === "invalid");

describe("builders against the shared corpus", () => {
  it("covers every companion message kind in the valid corpus", () => {
    expect(new Set(validIngest.map((entry) => entry.kind))).toEqual(
      new Set(Object.keys(builders)),
    );
  });

  it.each(validIngest.map((entry) => [entry.file, entry] as const))(
    "reproduces %s exactly",
    (_file, entry) => {
      const { version: _v, kind: _k, ...body } = readJson(entry.file);
      const built = builders[entry.kind]?.(body as never);
      expect(built).toEqual(readJson(entry.file));
      expect(validateIngestMessage(built).ok).toBe(true);
    },
  );

  it.each(invalidIngest.map((entry) => [entry.file, entry] as const))(
    "refuses %s before sending",
    async (_file, entry) => {
      const studio = fakeStudio();
      const client = createWireClient({
        baseUrl: "https://studio.example.test",
        tenantSlug: "acme",
        credential: FAKE_CREDENTIAL,
        fetch: studio.fetch,
      });
      const message = readJson(entry.file) as unknown as IngestMessage;
      expect(validateIngestMessage(message).ok).toBe(false);
      await expect(client.send(message)).rejects.toBeInstanceOf(CompanionError);
      expect(studio.requests).toEqual([]);
    },
  );

  it.each(
    entries
      .filter((entry) => entry.family === "acknowledgement")
      .map((entry) => [entry.file] as const),
  )("reads the acknowledgement %s", async (file) => {
    const ack = readJson(file);
    expect(acknowledgementSchema.safeParse(ack).success).toBe(true);
    const client = createWireClient({
      baseUrl: "https://studio.example.test",
      tenantSlug: "acme",
      credential: FAKE_CREDENTIAL,
      fetch: async () => ({
        headers: { get: () => null },
        json: async () => ack,
      }),
    });
    const outcome = await client.send(
      heartbeatMessage({
        sourceId: "companion",
        sentAt: "2026-10-03T10:00:05Z",
        capturing: true,
      }),
    );
    expect(outcome).toEqual({ kind: "ack", ack });
  });
});
