import { z } from "zod";

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

export const generatedAnswerSchema = z.object({
  title: z.string().trim().min(1),
  language: languageSchema,
  answerMarkdown: z.string().trim().min(1),
  code: z.string(),
  usageCode: z.string().default(""),
  testCode: z.string().default(""),
});

export const generateRequestSchema = routeRequestSchema.extend({
  providerId: z.string().trim().min(1).optional(),
});

export const savedAnswerSchema = generatedAnswerSchema.extend({
  id: z.string().uuid(),
  question: z.string().trim().min(1),
  notes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const saveAnswerRequestSchema = generatedAnswerSchema.extend({
  id: z.string().uuid().optional(),
  question: z.string().trim().min(1),
  notes: z.string().default(""),
});

export const runRequestSchema = z.object({
  language: z.enum(["php", "typescript", "ruby"]),
  code: z.string().min(1),
  stdin: z.string().default(""),
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
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;
export type SaveAnswerRequest = z.infer<typeof saveAnswerRequestSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type RunAllRequest = z.infer<typeof runAllRequestSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
