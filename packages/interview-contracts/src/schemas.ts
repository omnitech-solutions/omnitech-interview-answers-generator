import { z } from "zod";
import {
  answerGuideSchema,
  diagnosticSchema,
  renderGuideMarkdown,
  testResultSchema,
} from "./guide";

export const languageSchema = z.enum(["php", "react", "typescript", "ruby"]);
export const languageSelectionSchema = z.enum([
  "auto",
  "php",
  "react",
  "typescript",
  "ruby",
]);

export const routeRequestSchema = z.object({
  question: z.string().trim().min(1),
  language: languageSelectionSchema.default("auto"),
});

export const routeResultSchema = z.object({
  language: languageSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});

// The guide is the answer's source; answerMarkdown is its rendering
// (renderGuideMarkdown), kept beside it for every reader that shows Markdown.
export const generatedAnswerSchema = z.object({
  title: z.string().trim().min(1),
  language: languageSchema,
  answerMarkdown: z.string().trim().min(1),
  code: z.string(),
  usageCode: z.string().default(""),
  testCode: z.string().default(""),
  guide: answerGuideSchema,
});

// The host's gateway picks the model by profile; a request never names one.
export const generateRequestSchema = routeRequestSchema;

export const explanationRequestSchema = z.object({
  topic: z.string().trim().min(1),
  context: z.string().trim().optional(),
});

export const generatedExplanationSchema = z.object({
  title: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});

export const savedExplanationSchema = generatedExplanationSchema.extend({
  id: z.string().uuid(),
  topic: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const saveExplanationRequestSchema = generatedExplanationSchema.extend({
  id: z.string().uuid().optional(),
  topic: z.string().trim().min(1),
});

export const savedAnswerSchema = generatedAnswerSchema.extend({
  id: z.string().uuid(),
  question: z.string().trim().min(1),
  notes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// A save never takes the Markdown on trust: it is rendered from the guide, so
// a client's copy (if sent) is replaced.
export const saveAnswerRequestSchema = generatedAnswerSchema
  .omit({ answerMarkdown: true })
  .extend({
    id: z.string().uuid().optional(),
    question: z.string().trim().min(1),
    notes: z.string().default(""),
  })
  .transform((answer) => ({
    ...answer,
    answerMarkdown: renderGuideMarkdown(answer.guide),
  }));

export const runRequestSchema = z.object({
  language: z.enum(["php", "typescript", "ruby"]),
  code: z.string().min(1),
  stdin: z.string().default(""),
});

export const syntaxCheckRequestSchema = z.object({
  language: languageSchema,
  code: z.string().min(1),
});

export const runAllRequestSchema = z.object({
  language: languageSchema,
  code: z.string().min(1),
  usageCode: z.string().default(""),
  testCode: z.string().default(""),
  stdin: z.string().default(""),
});

export const runResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  timedOut: z.boolean(),
  // Present when the test framework's report could be read.
  tests: z.array(testResultSchema).optional(),
  // Present when the syntax checker can place its problems.
  diagnostics: z.array(diagnosticSchema).optional(),
});

export const libraryContentTypeSchema = z.enum([
  "official-reference",
  "cheat-sheet",
  "concept-guide",
  "dsa-pattern",
]);

export const libraryStatusSchema = z.enum(["draft", "published", "archived"]);

export const librarySourceSchema = z
  .object({
    publisher: z.string().trim().min(1),
    canonicalUrl: z.string().url().startsWith("https://"),
    official: z.boolean(),
    version: z.string().trim().min(1).optional(),
    lastVerifiedAt: z.string().date(),
  })
  .superRefine((source, context) => {
    if (!source.official) {
      context.addIssue({
        code: "custom",
        message: "Library source metadata is reserved for official references.",
        path: ["official"],
      });
    }
  });

const normalizedLibraryTagSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Tags must be lowercase slugs.");

export const libraryItemInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must contain lowercase letters, numbers, and hyphens.",
      ),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    body: z.string().trim().min(1),
    contentType: libraryContentTypeSchema,
    collection: normalizedLibraryTagSchema,
    tags: z.array(normalizedLibraryTagSchema).min(1),
    source: librarySourceSchema.optional(),
  })
  .superRefine((item, context) => {
    if (item.contentType === "official-reference" && !item.source) {
      context.addIssue({
        code: "custom",
        message: "Official references require canonical source metadata.",
        path: ["source"],
      });
    }
    if (item.contentType !== "official-reference" && item.source) {
      context.addIssue({
        code: "custom",
        message:
          "Only official references may provide official source metadata.",
        path: ["source"],
      });
    }
  });

export const libraryItemSchema = libraryItemInputSchema.extend({
  id: z.string().uuid(),
  status: libraryStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
  revision: z.number().int().positive(),
});

export const librarySearchQuerySchema = z.object({
  query: z.string().trim().max(200).default(""),
  contentTypes: z.array(libraryContentTypeSchema).default([]),
  collections: z.array(normalizedLibraryTagSchema).default([]),
  tags: z.array(normalizedLibraryTagSchema).default([]),
  officialOnly: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(20),
});

export const librarySearchHitSchema = z.object({
  itemId: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  contentType: libraryContentTypeSchema,
  collection: z.string(),
  tags: z.array(z.string()),
  official: z.boolean(),
  publisher: z.string().optional(),
  canonicalUrl: z.string().url().optional(),
  anchor: z.string(),
  headingPath: z.array(z.string()),
  excerpt: z.string(),
  score: z.number(),
});

export const libraryFacetsSchema = z.object({
  contentTypes: z.record(z.string(), z.number().int().nonnegative()),
  collections: z.record(z.string(), z.number().int().nonnegative()),
  tags: z.record(z.string(), z.number().int().nonnegative()),
});

export const librarySearchResponseSchema = z.object({
  hits: z.array(librarySearchHitSchema),
  total: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  facets: libraryFacetsSchema,
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.string()).optional(),
  }),
});

export type Language = z.infer<typeof languageSchema>;
export type LanguageSelection = z.infer<typeof languageSelectionSchema>;
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteResult = z.infer<typeof routeResultSchema>;
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type ExplanationRequest = z.infer<typeof explanationRequestSchema>;
export type GeneratedExplanation = z.infer<typeof generatedExplanationSchema>;
export type SavedExplanation = z.infer<typeof savedExplanationSchema>;
export type SaveExplanationRequest = z.infer<
  typeof saveExplanationRequestSchema
>;
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;
export type SaveAnswerRequest = z.infer<typeof saveAnswerRequestSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type SyntaxCheckRequest = z.infer<typeof syntaxCheckRequestSchema>;
export type RunAllRequest = z.infer<typeof runAllRequestSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
export type LibraryContentType = z.infer<typeof libraryContentTypeSchema>;
export type LibraryStatus = z.infer<typeof libraryStatusSchema>;
export type LibrarySource = z.infer<typeof librarySourceSchema>;
export type LibraryItemInput = z.infer<typeof libraryItemInputSchema>;
export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type LibrarySearchQuery = z.infer<typeof librarySearchQuerySchema>;
export type LibrarySearchHit = z.infer<typeof librarySearchHitSchema>;
export type LibraryFacets = z.infer<typeof libraryFacetsSchema>;
export type LibrarySearchResponse = z.infer<typeof librarySearchResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
