// Registers the DOM matchers' types for every screen test in this project.
import "@testing-library/jest-dom/vitest";
import type { ProductPageProps } from "@omnitech/platform-contracts";
import { type Mock, vi } from "vitest";
import { frontendPlugin } from "../manifest.js";

/** One request the screen sent through the fetch boundary. */
export interface SentRequest {
  method: string;
  path: string;
  query: string;
  body: unknown;
  /** True once the screen aborted the request, as a real browser would drop it. */
  aborted: boolean;
}

type Reply = unknown;
export type Handler = Reply | ((request: SentRequest) => Reply);

/** Marks a reply as a raw HTTP response rather than a JSON 200 body. */
export class Raw {
  constructor(
    readonly status: number,
    readonly text: string,
  ) {}
}

/**
 * Replaces `fetch` with a router keyed by `"METHOD /pathname"` and returns the
 * log of what the screen sent. Unrouted requests answer 404 so a missing route
 * shows up as a visible error rather than a hang.
 */
export function installFakeApi(routes: Record<string, Handler>) {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const [path = "", query = ""] = String(input).split("?");
      const method = init?.method ?? "GET";
      const request: SentRequest = {
        method,
        path,
        query,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        aborted: false,
      };
      sent.push(request);
      const signal = init?.signal;
      if (signal) {
        const abort = () => {
          request.aborted = true;
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        if (request.aborted) throw new DOMException("Aborted", "AbortError");
      }
      const route = routes[`${method} ${path}`];
      const reply = typeof route === "function" ? route(request) : route;
      if (route === undefined) {
        return new Response(JSON.stringify({ error: "No fake route." }), {
          status: 404,
        });
      }
      // A request aborted while in flight never delivers its response.
      await Promise.resolve();
      if (request.aborted) throw new DOMException("Aborted", "AbortError");
      if (reply instanceof Raw) {
        return new Response(reply.text, { status: reply.status });
      }
      return new Response(JSON.stringify(reply), { status: 200 });
    }),
  );
  return {
    sent,
    /** Requests per `"METHOD path"` resource that were not aborted. */
    live: () => countByResource(sent.filter((request) => !request.aborted)),
    /** Every request per `"METHOD path"` resource, aborted or not. */
    issued: () => countByResource(sent),
    to: (method: string, path: string) =>
      sent.filter(
        (request) => request.method === method && request.path === path,
      ),
  };
}

function countByResource(requests: readonly SentRequest[]) {
  const counts: Record<string, number> = {};
  for (const { method, path } of requests) {
    counts[`${method} ${path}`] = (counts[`${method} ${path}`] ?? 0) + 1;
  }
  return counts;
}

/** A two-slide document as the API returns it. */
export function sampleDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Roadmap",
    revision: 3,
    slideCount: 2,
    favorite: false,
    updatedAt: "2026-03-01T00:00:00Z",
    outline: ["Intro", "Next"],
    themeId: null,
    settings: {},
    slides: [
      {
        id: "s1",
        position: 0,
        sourceXml:
          '<SECTION layout="vertical"><H1>Intro</H1><P>Hello</P></SECTION>',
        content: {},
        revision: 1,
      },
      {
        id: "s2",
        position: 1,
        sourceXml: '<SECTION layout="vertical"><H1>Next</H1></SECTION>',
        content: {},
        revision: 1,
      },
    ],
    ...overrides,
  };
}

/** Captures page navigations, which jsdom cannot perform. */
export function captureNavigation(): Mock<(path: string) => void> {
  const assign = vi.fn();
  vi.stubGlobal("location", { origin: "https://app.test", assign });
  return assign;
}

/** Resolves a screen the way the shell mounts it: through the route loader. */
export async function routeScreen(
  routeId: string,
  pathSegments: readonly string[] = [],
  products: ProductPageProps["products"] = [],
) {
  const loader = frontendPlugin.routes[routeId];
  if (!loader) throw new Error(`No loader for ${routeId}`);
  const { default: Screen } = await loader();
  const props: ProductPageProps = {
    tenantSlug: "acme",
    routeId,
    pathSegments,
    products,
  };
  return { Screen, props };
}
