// The interview brief's routes, registered on the documents API so they sit
// behind its guard (the signed-in member of the tenant the request names, the
// write permission and same-origin check on every write) and under its
// prefix: /api/interview/documents/candidacies/:id/…
//
// PROBLEM: one application's stages, transcripts, employer-said entries and
// research must be read and edited whole by its owner. STRATEGY: each route
// parses its body against the contract (every size is bounded there) and
// hands it to the brief's service, which opens one tenant transaction and lets
// the repository settle ownership first.
// [SAFETY] A refusal is a code alone. Nothing a person typed, uploaded or
// recorded is ever logged or echoed in an error.
import type { PlatformDatabase } from "@omnitech/database";
import {
  employerSaidInputSchema,
  employerSaidUpdateSchema,
  INTERVIEW_BRIEF_BOUNDS,
  researchCreateSchema,
  researchUpdateSchema,
  stageCreateSchema,
  stageOrderSchema,
  stageUpdateSchema,
  TRANSCRIPT_POLICIES,
  type TranscriptPolicy,
  transcriptAttachSchema,
  transcriptPasteSchema,
  transcriptUpdateSchema,
} from "@omnitech/interview-contracts";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { BriefError, type BriefScope, isReferenced } from "./repository";
import { createBriefService } from "./services/brief.service";
import { decodeTranscript } from "./transcript";

const BOUNDS = INTERVIEW_BRIEF_BOUNDS;
const uuid = z.uuid();
// A JSON body that carries no long text.
const SMALL_JSON = 128 * 1024;
// Room for a form's own framing around its one file.
const FORM_OVERHEAD = 64 * 1024;
// [DOMAIN] A pasted transcript rides in JSON, where a line break or a quote
// costs two bytes: the bound's bytes, and as much again for the escaping.
const TRANSCRIPT_JSON = BOUNDS.transcriptUploadBytes * 2;
const RESEARCH_JSON = BOUNDS.researchUploadBytes * 2;
// The transcript formats `readTranscript` parses, and research as plain text.
const TRANSCRIPT_FILES = /\.(txt|vtt|srt)$/i;
const RESEARCH_FILES = /\.(txt|md|markdown)$/i;

const STATUS = {
  "not-found": 404,
  "invalid-request": 400,
  "body-too-large": 413,
  "limit-reached": 409,
  "invalid-transcript": 422,
  "unsupported-format": 415,
  "stage-in-use": 409,
  "loosening-refused": 409,
  "nothing-to-carry": 409,
} as const;

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new BriefError("body-too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new BriefError("invalid-request");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new BriefError("body-too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: Request, limit = SMALL_JSON) {
  const bytes = await boundedBody(request, limit);
  return JSON.parse(bytes.toString("utf8")) as unknown;
}
// One uploaded file and the form's text fields, the file within its bound.
async function fileBody(request: Request, limit: number) {
  const body = await boundedBody(request, limit + FORM_OVERHEAD);
  const form = await new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: new Uint8Array(body),
  }).formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new BriefError("invalid-request");
  if (file.size > limit) throw new BriefError("body-too-large");
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined;
  };
  return {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    field,
  };
}
// A name with its extension off, as a title.
const titleOf = (name: string) =>
  name.replace(/\.[A-Za-z0-9]+$/, "").slice(0, BOUNDS.nameChars) ||
  "Transcript";

type ScopedContext = Context<{ Variables: { documentScope: BriefScope } }>;

export function registerBriefRoutes(
  // The documents API's own app: its guard has already settled the member.
  // biome-ignore lint/suspicious/noExplicitAny: the host app's variables are its own; these routes read only `documentScope`
  host: Hono<any>,
  options: {
    database: PlatformDatabase;
    prefix: string;
    // Where the Studio's own recordings are written (transcript-recording.ts).
    recordingsDirectory?: string | undefined;
  },
): void {
  const app = host as Hono<{ Variables: { documentScope: BriefScope } }>;
  const base = `${options.prefix}/candidacies/:id`;
  const brief = createBriefService(options);
  const memberOf = (c: ScopedContext) => c.get("documentScope");
  // Every route answers a refusal by its code, and nothing else.
  const route =
    (work: (c: ScopedContext) => Promise<Response>) =>
    async (c: ScopedContext) => {
      try {
        return await work(c);
      } catch (error) {
        if (error instanceof BriefError)
          return c.json({ error: { code: error.code } }, STATUS[error.code]);
        throw error;
      }
    };
  const id = (c: ScopedContext, name = "id") => uuid.parse(c.req.param(name));
  const briefOf = (c: ScopedContext, status: 200 | 201 = 200) =>
    brief.readBrief(memberOf(c), id(c)).then((brief) => c.json(brief, status));

  app.get(
    `${base}/interview-brief`,
    route((c) => briefOf(c)),
  );

  // ---- Stages -------------------------------------------------------------
  app.post(
    `${base}/stages`,
    route(async (c) => {
      const input = stageCreateSchema.parse(await jsonBody(c.req.raw));
      await brief.addStage(memberOf(c), id(c), input);
      return briefOf(c, 201);
    }),
  );
  app.put(
    `${base}/stages/order`,
    route(async (c) => {
      const { order } = stageOrderSchema.parse(await jsonBody(c.req.raw));
      await brief.orderStages(memberOf(c), id(c), order);
      return briefOf(c);
    }),
  );
  app.patch(
    `${base}/stages/:stageId`,
    route(async (c) => {
      const input = stageUpdateSchema.parse(await jsonBody(c.req.raw));
      await brief.updateStage(memberOf(c), id(c), id(c, "stageId"), input);
      return briefOf(c);
    }),
  );
  app.delete(
    `${base}/stages/:stageId`,
    route(async (c) => {
      try {
        await brief.removeStage(memberOf(c), id(c), id(c, "stageId"));
      } catch (error) {
        // A live session or a document was made for this stage.
        if (isReferenced(error)) throw new BriefError("stage-in-use");
        throw error;
      }
      return briefOf(c);
    }),
  );
  // The application's old notes become the first stage's.
  app.post(
    `${base}/notes/move`,
    route(async (c) => {
      await brief.moveApplicationNotes(memberOf(c), id(c));
      return briefOf(c);
    }),
  );

  // ---- Transcripts --------------------------------------------------------
  const stagePath = `${base}/stages/:stageId/transcripts`;
  const policyOf = (value: string | undefined): TranscriptPolicy => {
    // Absent: it stays on this device.
    if (value === undefined) return "device-only";
    return z.enum(TRANSCRIPT_POLICIES).parse(value);
  };
  // Pasted text.
  app.post(
    stagePath,
    route(async (c) => {
      const input = transcriptPasteSchema.parse(
        await jsonBody(c.req.raw, TRANSCRIPT_JSON),
      );
      const transcript = await brief.addTranscript(
        memberOf(c),
        id(c),
        id(c, "stageId"),
        {
          title: input.title ?? "Pasted transcript",
          origin: "pasted",
          capturePolicy: policyOf(input.capturePolicy),
          occurredAt: input.occurredAt,
          text: input.text,
        },
      );
      return c.json({ transcript }, 201);
    }),
  );
  // A file in one of the formats `readTranscript` parses.
  app.post(
    `${stagePath}/upload`,
    route(async (c) => {
      const file = await fileBody(c.req.raw, BOUNDS.transcriptUploadBytes);
      if (!TRANSCRIPT_FILES.test(file.name))
        throw new BriefError("unsupported-format");
      const text = decodeTranscript(file.bytes);
      if (text === null) throw new BriefError("invalid-transcript");
      const occurredAt = file.field("occurredAt");
      const transcript = await brief.addTranscript(
        memberOf(c),
        id(c),
        id(c, "stageId"),
        {
          title: (file.field("title") ?? titleOf(file.name)).slice(
            0,
            BOUNDS.nameChars,
          ),
          origin: "uploaded",
          originName: file.name.slice(0, BOUNDS.nameChars),
          capturePolicy: policyOf(file.field("capturePolicy")),
          occurredAt: occurredAt
            ? z.iso.datetime({ offset: true }).parse(occurredAt)
            : undefined,
          text,
        },
      );
      return c.json({ transcript }, 201);
    }),
  );

  app.get(
    `${base}/recordings`,
    route(async (c) => {
      const recordings = await brief.listRecordings(memberOf(c), id(c));
      return c.json({ recordings });
    }),
  );
  // "Attach the transcript I just recorded."
  app.post(
    `${stagePath}/recordings`,
    route(async (c) => {
      const input = transcriptAttachSchema.parse(await jsonBody(c.req.raw));
      const transcript = await brief.attachRecording(
        memberOf(c),
        c.req.param("id") ?? "",
        c.req.param("stageId") ?? "",
        input,
      );
      return c.json({ transcript }, 201);
    }),
  );
  app.get(
    `${stagePath}/:transcriptId`,
    route(async (c) =>
      c.json({
        transcript: await brief.readTranscriptDetail(
          memberOf(c),
          id(c),
          id(c, "stageId"),
          id(c, "transcriptId"),
        ),
      }),
    ),
  );
  app.patch(
    `${stagePath}/:transcriptId`,
    route(async (c) => {
      const input = transcriptUpdateSchema.parse(await jsonBody(c.req.raw));
      return c.json({
        transcript: await brief.updateTranscript(
          memberOf(c),
          id(c),
          id(c, "stageId"),
          id(c, "transcriptId"),
          input,
        ),
      });
    }),
  );
  app.delete(
    `${stagePath}/:transcriptId`,
    route(async (c) => {
      await brief.removeTranscript(
        memberOf(c),
        id(c),
        id(c, "stageId"),
        id(c, "transcriptId"),
      );
      return briefOf(c);
    }),
  );

  // ---- Employer said ------------------------------------------------------
  app.post(
    `${base}/employer-said`,
    route(async (c) => {
      const input = employerSaidInputSchema.parse(await jsonBody(c.req.raw));
      await brief.addEmployerSaid(memberOf(c), id(c), input);
      return briefOf(c, 201);
    }),
  );
  app.patch(
    `${base}/employer-said/:entryId`,
    route(async (c) => {
      const input = employerSaidUpdateSchema.parse(await jsonBody(c.req.raw));
      await brief.updateEmployerSaid(
        memberOf(c),
        id(c),
        id(c, "entryId"),
        input,
      );
      return briefOf(c);
    }),
  );
  app.delete(
    `${base}/employer-said/:entryId`,
    route(async (c) => {
      await brief.removeEmployerSaid(memberOf(c), id(c), id(c, "entryId"));
      return briefOf(c);
    }),
  );

  // ---- Research -----------------------------------------------------------
  app.post(
    `${base}/research`,
    route(async (c) => {
      const input = researchCreateSchema.parse(
        await jsonBody(c.req.raw, RESEARCH_JSON),
      );
      await brief.addResearch(memberOf(c), id(c), {
        scope: input.scope ?? "application",
        title: input.title,
        origin: input.origin ?? (input.originRef ? "url" : "pasted"),
        originRef: input.originRef,
        text: input.text,
      });
      return briefOf(c, 201);
    }),
  );
  app.post(
    `${base}/research/upload`,
    route(async (c) => {
      const file = await fileBody(c.req.raw, BOUNDS.researchUploadBytes);
      // Plain text and Markdown are read as they are; nothing is converted.
      if (!RESEARCH_FILES.test(file.name))
        throw new BriefError("unsupported-format");
      const text = decodeTranscript(file.bytes);
      if (text === null || text.trim() === "")
        throw new BriefError("unsupported-format");
      const scopeOf = z
        .enum(["company", "application"])
        .parse(file.field("scope") ?? "application");
      await brief.addResearch(memberOf(c), id(c), {
        scope: scopeOf,
        title: (file.field("title") ?? titleOf(file.name)).slice(
          0,
          BOUNDS.nameChars,
        ),
        origin: "file",
        originRef: file.name.slice(0, BOUNDS.originChars),
        text,
      });
      return briefOf(c, 201);
    }),
  );
  // The company's old research text, kept as a document.
  app.post(
    `${base}/research/keep-carried`,
    route(async (c) => {
      await brief.keepCarriedResearch(memberOf(c), id(c));
      return briefOf(c);
    }),
  );
  // A document's id, or the carried-over text's stand-in.
  const documentId = (c: ScopedContext) =>
    z.string().min(1).max(64).parse(c.req.param("documentId"));
  app.get(
    `${base}/research/:documentId`,
    route(async (c) =>
      c.json({
        document: await brief.readResearchDocument(
          memberOf(c),
          c.req.param("id") ?? "",
          documentId(c),
        ),
      }),
    ),
  );
  app.patch(
    `${base}/research/:documentId`,
    route(async (c) => {
      const input = researchUpdateSchema.parse(
        await jsonBody(c.req.raw, RESEARCH_JSON),
      );
      await brief.updateResearch(
        memberOf(c),
        id(c),
        uuid.parse(documentId(c)),
        input,
      );
      return briefOf(c);
    }),
  );
  app.delete(
    `${base}/research/:documentId`,
    route(async (c) => {
      await brief.removeResearch(memberOf(c), id(c), uuid.parse(documentId(c)));
      return briefOf(c);
    }),
  );
}
