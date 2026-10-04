// A scripted stand-in for the Active Session routes, for store and view tests:
// handlers by "METHOD /path" (the base and any query stripped), and a record
// of every call so a test can count reads. Responses are real Response
// objects, so the client's parsing is exercised too.
import type { LiveStreamResponse } from "@omnitech/interview-contracts";
import { jsonResponse, streamPage } from "./session-fixtures";

type Handler = (call: {
  url: URL;
  body: unknown;
}) => Response | Promise<Response>;

export type TestServer = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  // "GET /current", "GET /<id>/stream", "POST /<id>/control" ...
  calls: string[];
  // The stream queries seen, in order.
  streamQueries: URLSearchParams[];
  on(route: string, handler: Handler): void;
  count(route: string): number;
};

const PREFIX = "/api/interview/t/local/sessions";

export function createTestServer(
  stream: () => LiveStreamResponse = () => streamPage(),
): TestServer {
  const handlers = new Map<string, Handler>();
  const calls: string[] = [];
  const streamQueries: URLSearchParams[] = [];
  // No report until a test installs one.
  handlers.set("GET /companion-capability", () =>
    jsonResponse({ capability: null }),
  );
  const server: TestServer = {
    calls,
    streamQueries,
    on: (route, handler) => handlers.set(route, handler),
    count: (route) => calls.filter((call) => call === route).length,
    async fetch(input, init = {}) {
      const url = new URL(input, "http://studio.test");
      const method = (init.method ?? "GET").toUpperCase();
      const path = url.pathname.replace(PREFIX, "") || "/";
      // Session ids are normalised to ":id" in the call record and handlers.
      const normal = path
        .replace(
          /^\/(?!(?:current|choices|companion-capability)(?:\/|$))[^/]+/,
          "/:id",
        )
        // A capture request's id is normalised too.
        .replace(/(\/capture-request)\/[^/]+$/, "$1/:rid");
      calls.push(`${method} ${normal}`);
      if (path.endsWith("/stream")) streamQueries.push(url.searchParams);
      const exact = handlers.get(`${method} ${path}`);
      const generic = handlers.get(`${method} ${normal}`);
      const handler = exact ?? generic;
      if (handler) {
        // A capture is multipart: its FormData is passed through as is.
        const body =
          init.body instanceof FormData
            ? init.body
            : init.body
              ? JSON.parse(String(init.body))
              : undefined;
        return handler({ url, body });
      }
      if (path.endsWith("/stream")) return jsonResponse(stream());
      return jsonResponse({ error: { code: "not_found" } }, 404);
    },
  };
  return server;
}
