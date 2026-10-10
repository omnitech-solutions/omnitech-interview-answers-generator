import { expect, it, vi } from "vitest";

vi.mock("../services", () => ({
  answerRepository: {},
  explanationRepository: {},
  libraryRepository: {},
  codeRunner: {},
  libraryService: {},
  generateInterviewAnswer: vi.fn(),
  generateExplanation: vi.fn(),
}));

import { createApi } from "../api";

// Captured from the original module before extraction: method, path, order.
const originalRoutes = [
  "GET /api/fake/v1/models",
  "POST /api/fake/v1/chat/completions",
  "GET /api/v1/health",
  "GET /api/v1/library/search",
  "GET /api/v1/library/facets",
  "GET /api/v1/library/items",
  "GET /api/v1/library/items/:idOrSlug",
  "POST /api/v1/library/items",
  "PUT /api/v1/library/items/:id",
  "POST /api/v1/library/items/:id/publish",
  "POST /api/v1/library/items/:id/archive",
  "DELETE /api/v1/library/items/:id",
  "POST /api/v1/route",
  "POST /api/v1/generate",
  "POST /api/v1/explain",
  "GET /api/v1/explanations",
  "GET /api/v1/explanations/:id",
  "POST /api/v1/explanations",
  "DELETE /api/v1/explanations/:id",
  "GET /api/v1/answers",
  "GET /api/v1/coach-notes",
  "POST /api/v1/coach-notes",
  "DELETE /api/v1/coach-notes",
  "GET /api/v1/coach-ledger",
  "PUT /api/v1/coach-ledger",
  "POST /api/v1/coach-writer",
  "DELETE /api/v1/coach-writer",
  "GET /api/v1/coach-plan",
  "PUT /api/v1/coach-plan",
  "GET /api/v1/behaviour-flags",
  "PUT /api/v1/behaviour-flags",
  "GET /api/v1/coach-transcript",
  "POST /api/v1/coach-transcript",
  "POST /api/v1/coach-activity",
  "DELETE /api/v1/coach-transcript",
  "GET /api/v1/playground-control",
  "PATCH /api/v1/playground-control",
  "POST /api/v1/playground-control/explanations",
  "DELETE /api/v1/playground-control",
  "GET /api/v1/answers/:id",
  "POST /api/v1/answers",
  "DELETE /api/v1/answers/:id",
  "POST /api/v1/run",
  "POST /api/v1/syntax-check",
  "POST /api/v1/run-all",
  "POST /api/v1/react-preview",
];

it("registers the same 46 methods and paths in their original order", () => {
  const app = createApi({ resolveScope: async () => null });
  expect(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`),
  ).toEqual(originalRoutes);
});
