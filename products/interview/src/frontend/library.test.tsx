import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("Knowledge", () => {
  const base = "/library";
  beforeEach(() => {
    window.history.replaceState({}, "", base);
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

  it("hydrates every supported filter and excludes unknown content types", async () => {
    window.history.replaceState(
      {},
      "",
      "/library?q=state&type=concept-guide&type=invalid&collection=react&tag=hooks&official=true",
    );
    render(<Library basePath={base} />);
    expect(
      screen.getByRole("searchbox", { name: "Search knowledge" }),
    ).toHaveValue("state");
    const card = await screen.findByRole("link", { name: /React state/ });
    expect(card).toHaveAttribute(
      "href",
      "/library/react-state?q=state&type=concept-guide&collection=react&tag=hooks&official=true#ownership",
    );
    const searchCall = vi
      .mocked(fetch)
      .mock.calls.find(([path]) => String(path).includes("/search"));
    const parameters = new URL(String(searchCall![0]), "http://localhost")
      .searchParams;
    expect(parameters.getAll("type")).toEqual(["concept-guide"]);
    expect(parameters.get("collection")).toBe("react");
    expect(parameters.get("tag")).toBe("hooks");
    expect(parameters.get("official")).toBe("true");
  });

  it.each(["facets", "search", "items/react-state"])(
    "reports a failed %s request",
    async (endpoint) => {
      vi.mocked(fetch).mockImplementation(async (input) => {
        const path = String(input);
        if (path.includes(`/library/${endpoint}`))
          return response(
            {
              error: {
                message: "Knowledge unavailable",
                issues: ["Try later"],
              },
            },
            false,
          );
        if (path.includes("/facets")) return response(facets);
        if (path.includes("/search")) return response(searchResponse);
        return response(article);
      });
      render(
        <Library
          basePath={base}
          {...(endpoint.startsWith("items")
            ? { initialSlug: "react-state" }
            : {})}
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Knowledge unavailable Try later",
      );
    },
  );

  it("responds to browser navigation into and out of an article", async () => {
    render(<Library basePath={base} />);
    await screen.findByRole("heading", {
      name: "Recently verified and reviewed",
    });
    window.history.pushState({}, "", "/library/react-state#ownership");
    fireEvent.popState(window);
    expect(
      await screen.findByRole("heading", { name: "React state", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "← Back to Knowledge" }),
    ).toBeVisible();
    window.history.pushState({}, "", "/library");
    fireEvent.popState(window);
    expect(
      await screen.findByRole("heading", {
        name: "Find the exact answer, fast.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: "On this page" }),
    ).toBeNull();
  });

  it("replaces the technology filter while retaining popular tags", async () => {
    window.history.replaceState({}, "", "/library?tag=hooks&tag=typescript");
    render(<Library basePath={base} />);
    await screen.findByRole("link", { name: /React state/ });
    const technologies = screen.getByRole("navigation", {
      name: "Filter by technology",
    });
    fireEvent.click(
      within(technologies).getByRole("button", { name: /^React/ }),
    );
    expect(
      within(technologies).getByRole("button", { name: /^React/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(technologies).getByRole("button", { name: /^TypeScript/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(window.location.search).toBe("?tag=hooks&tag=react"),
    );
    fireEvent.click(within(technologies).getByRole("button", { name: "All" }));
    await waitFor(() => expect(window.location.search).toBe("?tag=hooks"));
    expect(
      within(technologies).getByRole("button", { name: "All" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("does not steal slash focus while typing", async () => {
    render(<Library basePath={base} />);
    const search = screen.getByRole("searchbox", { name: "Search knowledge" });
    const input = document.createElement("input");
    document.body.append(input);
    try {
      input.focus();
      fireEvent.keyDown(input, { key: "/" });
      expect(input).toHaveFocus();
      expect(search).not.toHaveFocus();
    } finally {
      input.remove();
    }
    await screen.findByRole("heading", {
      name: "Recently verified and reviewed",
    });
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("leaves modified result clicks to the browser (%j)", async (modifier) => {
    window.history.replaceState({}, "", "/library?q=state");
    render(<Library basePath={base} />);
    const card = await screen.findByRole("link", { name: /React state/ });
    let intercepted: boolean | undefined;
    const preventNavigation = (event: MouseEvent) => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    };
    document.body.addEventListener("click", preventNavigation);
    try {
      fireEvent.click(card, modifier);
    } finally {
      document.body.removeEventListener("click", preventNavigation);
    }
    expect(intercepted).toBe(false);
    expect(window.location.pathname).toBe("/library");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([path]) => String(path).includes("/items/")),
    ).toBe(false);
  });

  it("shows the collection index, then result cards for a search", async () => {
    const user = userEvent.setup();
    render(<Library basePath={base} />);

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
    await user.click(await screen.findByRole("button", { name: "PHP2" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("tag=php"),
        expect.anything(),
      ),
    );

    const search = screen.getByRole("searchbox", { name: "Search knowledge" });
    await user.type(search, "React state");
    const card = await screen.findByRole("link", { name: /React state/ });
    expect(card).toHaveTextContent("react › Ownership");

    await user.keyboard("{Enter}");
    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe("/library/react-state?q=React+state&tag=php#ownership");
  });

  it("keeps active filters in result links", async () => {
    const user = userEvent.setup();
    render(<Library basePath={base} />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search knowledge" }),
      "frequency",
    );
    await user.click(screen.getByRole("button", { name: /TypeScript/ }));

    expect(
      await screen.findByRole("link", { name: /React state/ }),
    ).toHaveAttribute(
      "href",
      "/library/react-state?q=frequency&tag=typescript#ownership",
    );
    expect(window.location.search).toBe("?q=frequency&tag=typescript");
  });

  it("shows the border beam on a card only while its article loads", async () => {
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
    render(<Library basePath={base} />);

    const card = await screen.findByRole("link", { name: /React state/ });
    await user.click(card);
    expect(card).toHaveClass("loading");

    await act(async () => resolveArticle?.(response(article)));
    expect(
      await screen.findByRole("heading", { name: "React state", level: 1 }),
    ).toBeVisible();
  });

  it("supports slash focus, arrows, Escape, and filters", async () => {
    const user = userEvent.setup();
    render(<Library basePath={base} />);
    const search = screen.getByRole("searchbox", { name: "Search knowledge" });

    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();
    await user.type(search, "React");
    await screen.findByRole("link", { name: /React state/ });
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
    render(<Library basePath={base} />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search knowledge" }),
      "useRef",
    );
    expect(await screen.findByRole("link", { name: /useRef/ })).toHaveAttribute(
      "href",
      "/library/react-use-ref?q=useRef",
    );
  });

  it("uses compact collection, trust, tag, mobile, and quick-link controls", async () => {
    const user = userEvent.setup();
    render(<Library basePath={base} />);
    await screen.findByText("Recently verified and reviewed");

    expect(
      (await screen.findAllByRole("link", { name: /React state/ })).at(-1),
    ).toHaveAttribute("href", "/library/react-state#ownership");

    const clear = () =>
      user.click(
        screen.getByRole("button", { name: "Clear search and filters" }),
      );
    await user.click(screen.getByRole("button", { name: /backend/ }));
    await clear();
    await user.click(screen.getByRole("button", { name: /hooks/ }));
    await clear();
    await user.click(screen.getByRole("button", { name: /Official only/ }));
    await clear();

    const index = screen.getByRole("complementary", {
      name: "Knowledge index",
    });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(index).toHaveClass("open");
  });

  it("renders Studio-authored articles without claiming an official source", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("/facets")) return response(facets);
      if (path.includes("/items/"))
        return response({ ...article, source: undefined });
      return response(searchResponse);
    });
    render(<Library basePath={base} initialSlug="react-state" />);
    await screen.findByRole("heading", { name: "React state", level: 1 });
    expect(
      screen.getByText("Focused Interview Studio reference"),
    ).toBeVisible();
    expect(screen.queryByText("Official source")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open canonical docs ↗" }),
    ).toBeNull();
  });

  it("links adjacent references while preserving filters and removes duplicate article hits", async () => {
    const previous = {
      ...hit,
      itemId: "previous",
      slug: "react-hooks",
      title: "Hooks",
      anchor: "hooks",
      headingPath: ["Hooks"],
    };
    const next = {
      ...hit,
      itemId: "next",
      slug: "react-context",
      title: "Context",
      anchor: "providers",
      headingPath: ["Context", "Providers"],
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("/facets")) return response(facets);
      if (path.includes("/items/")) return response(article);
      return response({
        ...searchResponse,
        hits: [previous, hit, { ...hit, anchor: "other" }, next],
        total: 4,
      });
    });
    render(<Library basePath={base} initialSlug="react-state" />);
    const adjacent = await screen.findByRole("navigation", {
      name: "Adjacent references",
    });
    expect(within(adjacent).getAllByRole("link")).toHaveLength(2);
    expect(
      within(adjacent).getByRole("link", { name: /Previous\s*Hooks/ }),
    ).toHaveAttribute("href", "/library/react-hooks");
    expect(
      within(adjacent).getByRole("link", { name: /Next\s*Context/ }),
    ).toHaveAttribute("href", "/library/react-context#providers");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search knowledge" }),
      { target: { value: "state" } },
    );
    expect(
      within(adjacent).getByRole("link", { name: /Previous\s*Hooks/ }),
    ).toHaveAttribute("href", "/library/react-hooks?q=state");
    expect(
      within(adjacent).getByRole("link", { name: /Next\s*Context/ }),
    ).toHaveAttribute("href", "/library/react-context?q=state#providers");
  });

  it("renders provenance, the article, and an on-page table of contents", async () => {
    window.history.replaceState({}, "", "/library/react-state#react-state");
    render(<Library basePath={base} initialSlug="react-state" />);

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
});

describe("Knowledge results and articles", () => {
  const base = "/t/local/p/interview/knowledge";
  let hits: unknown[] = [hit];
  beforeEach(() => {
    hits = [hit];
    window.history.replaceState({}, "", `${base}?q=state`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/facets")) return response(facets);
        if (url.includes("/items/react-state")) return response(article);
        if (url.includes("/search"))
          return response({ ...searchResponse, hits, total: hits.length });
        return response({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the filters beside result cards and leaves ⌘K to the studio", async () => {
    render(<Library basePath={base} />);
    const card = await screen.findByRole("link", { name: /React state/ });
    expect(card).toHaveTextContent("react › Ownership");
    expect(card).toHaveTextContent("Official");
    expect(card).toHaveTextContent("Official Reference");
    expect(screen.getByText("1 result")).toBeVisible();
    expect(screen.getByText("Content type")).toBeVisible();
    // ⌘K belongs to the studio palette; "/" still focuses search.
    const search = screen.getByRole("searchbox", { name: "Search knowledge" });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(search).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();
  });

  it("opens an article under the studio path and goes back to the results", async () => {
    render(<Library basePath={base} />);
    fireEvent.click(await screen.findByRole("link", { name: /React state/ }));
    await screen.findByRole("heading", { level: 1, name: "React state" });
    expect(window.location.pathname).toBe(`${base}/react-state`);
    fireEvent.click(screen.getByRole("button", { name: "← Back to results" }));
    expect(window.location.pathname).toBe(base);
    expect(window.location.search).toContain("q=state");
    expect(
      await screen.findByRole("link", { name: /React state/ }),
    ).toBeVisible();
  });

  it("says when nothing matches and clears the search", async () => {
    hits = [];
    render(<Library basePath={base} />);
    expect(await screen.findByText("Nothing matches “state”")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search knowledge" }),
      ).toHaveValue(""),
    );
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("clears filters from the sidebar", async () => {
    render(<Library basePath={base} />);
    await screen.findByRole("link", { name: /React state/ });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search knowledge" }),
      ).toHaveValue(""),
    );
  });
});
