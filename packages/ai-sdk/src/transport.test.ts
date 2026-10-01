import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
afterEach(() => vi.unstubAllGlobals());
function response() {
  return new Response(
    JSON.stringify({
      id: "m",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
}
it("retains public call shape and actual endpoint while preserving roles", async () => {
  let body: any;
  let url: unknown;
  vi.stubGlobal("fetch", async (u: unknown, init: RequestInit) => {
    url = u;
    body = JSON.parse(String(init.body));
    return response();
  });
  const p = createOpenAiCompatibleProvider({
    id: "local",
    label: "Local",
    model: "m",
    baseUrl: "http://127.0.0.1:1234/v1/",
  });
  expect(
    await p.generateText({
      system: "Rules",
      messages: [
        { role: "user", content: "Q" },
        { role: "assistant", content: "A" },
      ],
      maxOutputTokens: 10,
      temperature: 0,
    }),
  ).toMatchObject({ providerId: "local", text: "ok", usage: {} });
  expect(String(url)).toBe("http://127.0.0.1:1234/v1/chat/completions");
  expect(body.messages).toEqual([
    { role: "system", content: "Rules" },
    { role: "user", content: "Q" },
    { role: "assistant", content: "A" },
  ]);
});
it("benchmarks identical successful and retryable-failure fake workloads", async () => {
  let attempts = 0;
  let failing = false;
  vi.stubGlobal("fetch", async () => {
    attempts++;
    return failing
      ? new Response(
          JSON.stringify({ error: { message: "mock unavailable" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        )
      : response();
  });
  const p = createOpenAiCompatibleProvider({
    id: "mock",
    label: "Mock",
    model: "m",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: randomUUID(),
    timeoutMs: 120000,
  });
  let start = performance.now();
  for (let i = 0; i < 20; i++) await p.generateText({ prompt: "same input" });
  console.info(
    `transport benchmark success requests=${attempts} elapsedMs=${(performance.now() - start).toFixed(2)}`,
  );
  attempts = 0;
  failing = true;
  start = performance.now();
  await expect(p.generateText({ prompt: "same input" })).rejects.toMatchObject({
    code: "provider_failure",
  });
  console.info(
    `transport benchmark failure requests=${attempts} elapsedMs=${(performance.now() - start).toFixed(2)}`,
  );
}, 20000);
