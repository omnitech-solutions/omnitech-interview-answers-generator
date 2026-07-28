import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Library } from "./library";

const facets = {
  contentTypes: {
    "official-reference": 1,
    "concept-guide": 2,
  },
  collections: { react: 3, backend: 1 },
  tags: {
    react: 3,
    typescript: 3,
    php: 2,
    laravel: 2,
    symfony: 1,
    hooks: 2,
    state: 1,
  },
};

const hit = {
  itemId: "123e4567-e89b-42d3-a456-426614174000",
  slug: "react-state",
  title: "React state",
  summary: "State ownership.",
  contentType: "official-reference",
  collection: "react",
  tags: ["react", "state"],
  official: true,
  publisher: "React",
  canonicalUrl: "https://react.dev/learn/state-as-a-snapshot",
  anchor: "ownership",
  headingPath: ["React state", "Ownership"],
  excerpt: "Keep React state with one owner.",
  score: 10,
};

const searchResponse = {
  hits: [hit],
  total: 1,
  elapsedMs: 2,
  facets,
};

const article = {
  id: hit.itemId,
  slug: hit.slug,
  title: hit.title,
  summary: hit.summary,
  body: "# React state\n\n## Ownership\n\nKeep one owner.",
  contentType: "official-reference",
  collection: "react",
  tags: ["react", "state"],
  source: {
    publisher: "React",
    canonicalUrl: hit.canonicalUrl,
    official: true,
    version: "19",
    lastVerifiedAt: "2026-07-27",
  },
  status: "published",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  publishedAt: "2026-07-27T00:00:00.000Z",
  revision: 2,
};

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("Library", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/library");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/facets")) return response(facets);
        if (url.includes("/items/react-state")) return response(article);
        if (url.includes("/search")) return response(searchResponse);
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a DevDocs-style collection index and moves search into the sidebar", async () => {
    const user = userEvent.setup();
    render(<Library />);

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("link", { name: /Playground/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /Concept Lab/ })).toHaveAttribute(
      "href",
      "/?view=concept-lab",
    );
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(
      screen.getAllByRole("button", { name: "Close navigation" }).at(-1)!,
    );

    expect(
      screen.getByRole("heading", { name: "Find the exact answer, fast." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /React & Frontend/ }),
    ).toHaveAttribute("href", "?collection=react");
    expect(screen.getByRole("link", { name: /PHP 8.4/ })).toHaveAttribute(
      "href",
      "?collection=php",
    );
    expect(screen.getByRole("link", { name: /Laravel 13/ })).toHaveAttribute(
      "href",
      "?collection=laravel",
    );
    expect(screen.getByRole("link", { name: /Symfony/ })).toHaveAttribute(
      "href",
      "?collection=symfony",
    );
    expect(
      screen.getByRole("navigation", { name: "Filter by technology" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "PHP2" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("tag=php"),
        expect.anything(),
      ),
    );

    const search = screen.getByRole("searchbox", { name: "Search Library" });
    await user.type(search, "React state");
    expect(
      await screen.findByRole("heading", { name: "Results for “React state”" }),
    ).toBeVisible();
    expect(
      (await screen.findAllByRole("link", { name: /React state/ }))[0],
    ).toBeVisible();
    expect(screen.getByText("React state › Ownership")).toBeVisible();

    await user.keyboard("{Enter}");
    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe("/library/react-state?q=React+state&tag=php#ownership");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("Content type")).toBeVisible();
  });

  it("preserves active filters in selected reference links", async () => {
    const user = userEvent.setup();
    render(<Library />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search Library" }),
      "frequency",
    );
    await user.click(screen.getByRole("button", { name: /TypeScript/ }));

    const resultLink = (
      await screen.findAllByRole("link", { name: /React state/ })
    )[0];
    expect(resultLink).toHaveAttribute(
      "href",
      "/library/react-state?q=frequency&tag=typescript#ownership",
    );
    expect(window.location.search).toBe("?q=frequency&tag=typescript");
  });

  it("marks the open reference instead of the first filtered result", async () => {
    window.history.replaceState({}, "", "/library/react-state?tag=typescript");
    const firstHit = {
      ...hit,
      itemId: "223e4567-e89b-42d3-a456-426614174000",
      slug: "string-frequency",
      title: "String frequency",
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/facets")) return response(facets);
      if (url.includes("/items/react-state")) return response(article);
      if (url.includes("/search")) {
        return response({
          ...searchResponse,
          hits: [firstHit, hit],
          total: 2,
        });
      }
      return response({});
    });

    render(<Library initialSlug="react-state" />);

    const index = screen.getByRole("complementary", {
      name: "Library index",
    });
    const selected = (
      await within(index).findByText("React state", { selector: "strong" })
    ).closest("a");
    const first = (
      await within(index).findByText("String frequency", {
        selector: "strong",
      })
    ).closest("a");
    expect(selected).toHaveAttribute("aria-current", "page");
    expect(selected).toHaveClass("active");
    expect(first).not.toHaveAttribute("aria-current");
    expect(first).not.toHaveClass("active");
  });

  it("shows the border beam only while the selected article is loading", async () => {
    window.history.replaceState({}, "", "/library?tag=typescript");
    let resolveArticle: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/facets")) return response(facets);
      if (url.includes("/items/react-state")) {
        return new Promise<Response>((resolve) => {
          resolveArticle = resolve;
        });
      }
      if (url.includes("/search")) return response(searchResponse);
      return response({});
    });
    const user = userEvent.setup();
    render(<Library />);

    const index = screen.getByRole("complementary", {
      name: "Library index",
    });
    const selected = (
      await within(index).findByText("React state", { selector: "strong" })
    ).closest("a");
    await user.click(selected!);
    expect(selected).toHaveClass("loading");

    await act(async () => resolveArticle?.(response(article)));
    await waitFor(() => expect(selected).not.toHaveClass("loading"));
    expect(selected).toHaveClass("active");
    expect(
      screen.getByRole("heading", { name: "React state", level: 1 }),
    ).toBeVisible();
  });

  it("supports command focus, slash focus, arrows, Escape, and filters", async () => {
    const user = userEvent.setup();
    render(<Library />);
    const search = screen.getByRole("searchbox", { name: "Search Library" });

    await user.keyboard("{Meta>}k{/Meta}");
    expect(search).toHaveFocus();
    await user.type(search, "React");
    await screen.findAllByRole("link", { name: /React state/ });
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(window.location.pathname).toBe("/library/react-state");
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Concept Guide/ }));
    await waitFor(() =>
      expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain(
        "type=concept-guide",
      ),
    );
  });

  it("links a document-title search hit to the article root", async () => {
    const user = userEvent.setup();
    const rootHit = {
      ...hit,
      slug: "react-use-ref",
      title: "useRef",
      summary: "Retain a mutable value across renders.",
      anchor: "useref",
      headingPath: ["useRef"],
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/facets")) return response(facets);
      if (url.includes("/search")) {
        return response({ ...searchResponse, hits: [rootHit] });
      }
      return response({});
    });
    render(<Library />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search Library" }),
      "useRef",
    );
    const links = await screen.findAllByRole("link", { name: /useRef/ });
    expect(links[0]).toHaveAttribute("href", "/library/react-use-ref?q=useRef");
  });

  it("uses compact collection, trust, tag, mobile, and quick-link controls", async () => {
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByText("Recently verified and reviewed");

    expect(
      (await screen.findAllByRole("link", { name: /React state/ })).at(-1),
    ).toHaveAttribute("href", "/library/react-state#ownership");

    await user.click(screen.getByRole("button", { name: /backend/ }));
    await screen.findByRole("button", { name: "Clear" });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: /hooks/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: /Official only/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    const index = screen.getByRole("complementary", {
      name: "Library index",
    });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(index).toHaveClass("open");
  });

  it("renders provenance, the article, and an on-page table of contents", async () => {
    window.history.replaceState({}, "", "/library/react-state#react-state");
    render(<Library initialSlug="react-state" />);

    expect(
      (
        await screen.findAllByRole("heading", {
          name: "React state",
          level: 1,
        })
      )[0],
    ).toBeVisible();
    expect(screen.getByText("Official source")).toBeVisible();
    expect(screen.getByText("Publisher")).toBeVisible();
    expect(
      screen.getByLabelText("React state source details"),
    ).toHaveTextContent("React state");
    expect(
      screen.getByRole("link", { name: "Open canonical docs ↗" }),
    ).toHaveAttribute("href", hit.canonicalUrl);
    expect(
      screen.getAllByRole("link", { name: "Ownership" }).at(-1),
    ).toHaveAttribute("href", "#ownership");
    expect(
      screen.getAllByRole("heading", { name: "React state", level: 1 }),
    ).toHaveLength(1);
    await waitFor(() => expect(window.location.hash).toBe(""));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Contents" }));
    expect(
      screen.getByRole("complementary", { name: "On this page" }),
    ).toHaveClass("open");
    await user.click(
      screen.getAllByRole("link", { name: "Ownership" }).at(-1)!,
    );
  });

  it("authors drafts, normalizes tags, and publishes explicitly", async () => {
    const user = userEvent.setup();
    const draft = {
      ...article,
      contentType: "concept-guide",
      source: undefined,
      status: "draft",
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/facets")) return response(facets);
      if (url.includes("/search")) return response(searchResponse);
      if (init?.method === "POST" && url.endsWith("/items")) {
        return response(draft);
      }
      if (init?.method === "PUT") return response(draft);
      if (url.endsWith("/publish")) return response(article);
      if (url.endsWith("/archive")) {
        return response({ ...article, status: "archived" });
      }
      return response({});
    });
    render(<Library />);

    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Title"), "State ownership");
    await user.type(screen.getByLabelText("Slug"), "state-ownership");
    await user.type(screen.getByLabelText("Summary"), "Keep one owner.");
    await user.clear(screen.getByLabelText("Markdown"));
    await user.type(screen.getByLabelText("Markdown"), "# Ownership");
    await user.type(screen.getByLabelText(/^Tags/), "React Hooks, state");
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Published and added to search.",
      ),
    );
    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/library/items") && init?.method === "POST",
      );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      tags: ["react", "hooks", "state"],
    });
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Draft saved."),
    );
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Archived and removed from search.",
      ),
    );
  });

  it("shows inline API errors and official-source authoring fields", async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.selectOptions(
      screen.getByLabelText("Type"),
      "official-reference",
    );
    expect(screen.getByLabelText("Publisher")).toBeVisible();
    expect(screen.getByLabelText("Canonical HTTPS URL")).toBeVisible();
    await user.type(screen.getByLabelText("Publisher"), "React");
    await user.type(screen.getByLabelText("Canonical HTTPS URL"), "react.dev");
    await user.selectOptions(screen.getByLabelText("Type"), "concept-guide");
    expect(screen.queryByLabelText("Publisher")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close authoring" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    vi.mocked(fetch).mockResolvedValueOnce(
      response({ error: { message: "Index unavailable" } }, false),
    );
    await user.click(
      screen.getByRole("button", { name: /Official Reference/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Index unavailable",
    );
  });

  it("deletes a never-published draft", async () => {
    const user = userEvent.setup();
    const draft = {
      ...article,
      contentType: "concept-guide",
      source: undefined,
      status: "draft",
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/facets")) return response(facets);
      if (url.includes("/search")) return response(searchResponse);
      if (init?.method === "POST") return response(draft);
      if (init?.method === "DELETE") return response({ deleted: true });
      return response({});
    });
    render(<Library />);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Title"), "Draft");
    await user.type(screen.getByLabelText("Slug"), "draft");
    await user.type(screen.getByLabelText("Summary"), "Draft summary");
    await user.type(screen.getByLabelText(/^Tags/), "draft");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("button", { name: "Delete draft" });
    await user.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
