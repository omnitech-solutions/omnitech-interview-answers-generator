import { fakeCompletion } from "./services/fake-completion.service";
import { type ApiApp, JSON_BODY_LIMIT_BYTES, readBody } from "./transport";

export function mountFakeRoutes(app: ApiApp) {
  app.get("/api/fake/v1/models", (context) =>
    context.json({
      object: "list",
      data: [{ id: "fake-interview-model", object: "model" }],
    }),
  );

  app.post("/api/fake/v1/chat/completions", async (context) => {
    const read = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!read.ok) return read.response;
    return context.json(fakeCompletion(read.value));
  });
}
