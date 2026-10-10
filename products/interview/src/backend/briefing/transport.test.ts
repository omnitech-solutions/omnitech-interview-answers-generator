import { expect, it, vi } from "vitest";
import {
  type WorkspaceDatabasePort,
  WorkspaceError,
} from "../assistant/workspace";
import { createBriefingApi } from "./api";

const scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: "omnitech.interview",
};
const prefix = "http://localhost/api/interview/briefing";
function transport(
  resolveScope: (request: Request) => Promise<typeof scope | null> = async () =>
    scope,
) {
  const transaction = vi.fn(async () => {
    throw new Error("Unexpected persistence");
  });
  const database = {
    tenantTransaction: transaction,
  } satisfies WorkspaceDatabasePort;
  return {
    app: createBriefingApi({
      database,
      resolveScope,
      generate: async () => ({}),
    }),
    transaction,
  };
}
it("authorizes before parsing or touching persistence", async () => {
  const { app, transaction } = transport(async () => null);
  const response = await app.request(`${prefix}/profiles`, {
    method: "POST",
    body: "{",
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
  expect(transaction).not.toHaveBeenCalled();
});
it("rejects cross-site mutations before their malformed input is parsed", async () => {
  const { app, transaction } = transport();
  const response = await app.request(`${prefix}/artifacts/a/ask`, {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
    body: "{",
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "origin-forbidden" },
  });
  expect(transaction).not.toHaveBeenCalled();
});
it("keeps the declared body-size rejection in transport", async () => {
  const { app, transaction } = transport();
  const response = await app.request(`${prefix}/profiles`, {
    method: "POST",
    headers: { "content-length": "1048577" },
    body: "{}",
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: { code: "body-too-large" } });
  expect(transaction).not.toHaveBeenCalled();
});
it("validates before calling a use case and reports field paths without input values", async () => {
  const { app, transaction } = transport();
  const response = await app.request(`${prefix}/artifacts/a/ask`, {
    method: "POST",
    body: JSON.stringify({ question: "PRIVATE QUESTION" }),
  });
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain("invalid-input");
  expect(body).toContain("expectedRevision");
  expect(body).not.toContain("PRIVATE QUESTION");
  expect(transaction).not.toHaveBeenCalled();
});
it.each([
  "not-found",
  "evidence-forbidden",
  "runner-unavailable",
  "revision-conflict",
])("renders the carried status for %s", async (code) => {
  const error = new WorkspaceError(code);
  const { app } = transport(async () => {
    throw error;
  });
  const response = await app.request(`${prefix}/profiles`);
  expect(response.status).toBe(error.statusCode);
  expect((await response.json()).error.code).toBe(code);
});
it("does not reveal unexpected failures", async () => {
  const { app } = transport(async () => {
    throw new Error("PRIVATE ERROR");
  });
  const response = await app.request(`${prefix}/profiles`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "internal-error" } });
});

it.each([
  ["body-too-large", 413],
  ["matrix-too-large", 413],
  ["generation-failed", 503],
  ["default-profile-unavailable", 503],
])("preserves the existing briefing response for %s", async (code, status) => {
  const { app } = transport(async () => {
    throw new WorkspaceError(String(code));
  });
  const response = await app.request(`${prefix}/profiles`);
  expect(response.status).toBe(status);
  expect((await response.json()).error.code).toBe(code);
});

it("checks the actual UTF-8 body size without a content-length header", async () => {
  const { app, transaction } = transport();
  const response = await app.request(`${prefix}/profiles`, {
    method: "POST",
    body: JSON.stringify({ name: "é".repeat(524288) }),
  });
  expect(response.status).toBe(413);
  expect((await response.json()).error.code).toBe("body-too-large");
  expect(transaction).not.toHaveBeenCalled();
});
