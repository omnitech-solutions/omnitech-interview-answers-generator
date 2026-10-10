// The request shapes of the presentation API and the bounds a body is read
// against. Shapes only: what a request means is decided in application/.
import { isSafeImageModelId } from "@omnitech/ai-engine";
import { z } from "zod";

export const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outline: z.array(z.string().trim().min(1)).optional(),
  themeId: z.uuid().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const saveSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  outline: z.array(z.string().trim().min(1)).optional(),
  themeId: z.uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().positive(),
});

export const slideSchema = z.object({
  id: z.uuid().optional(),
  position: z.number().int().nonnegative(),
  sourceXml: z.string().max(500_000),
  content: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().int().positive().optional(),
});

export const slideMoveSchema = z.object({
  position: z.number().int().nonnegative(),
});

export const generationSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  profileId: z.string().trim().min(1),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  modelId: z
    .string()
    .trim()
    .refine(isSafeImageModelId, "Not an allowed image model id.")
    .optional(),
  slideCount: z.number().int().min(1).max(100).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  layout: z.string().trim().min(1).max(40).optional(),
  textContent: z.string().trim().max(40).optional(),
  tone: z.string().trim().max(40).optional(),
  audience: z.string().trim().max(40).optional(),
  scenario: z.string().trim().max(40).optional(),
});

export const slideGenerationSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  profileId: z.string().trim().min(1),
  position: z.number().int().nonnegative().optional(),
});

export const themeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  definition: z.record(z.string(), z.unknown()),
});

export const themeImportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fileBase64: z.string().min(32).max(20_000_000),
  sourceImportId: z.string().trim().min(1).max(200),
});

export const themeReactionSchema = z.enum(["favorite", "like"]);

export const booleanSchema = z.object({ enabled: z.boolean() });

export const exportSchema = z.object({
  format: z.enum(["pptx", "pdf"]),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const recordingSchema = z.object({
  assetReference: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const imageUploadSchema = z.object({
  assetReference: z.string().trim().min(1).max(5_000_000),
  mimeType: z.string().trim().min(1).max(100).default("image/png"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// A request body is read as a stream against these bounds before any handler
// sees it. Images and theme files travel as base64 inside JSON. First match
// on the path's ending wins; the last row is every other route.
const BODY_LIMITS: readonly (readonly [ending: string, bytes: number])[] = [
  ["/themes/import", 24 * 1024 * 1024],
  ["/images", 8 * 1024 * 1024],
  ["", 2 * 1024 * 1024],
];

export function bodyLimitFor(path: string): number {
  return BODY_LIMITS.find(([ending]) => path.endsWith(ending))?.[1] ?? 0;
}
