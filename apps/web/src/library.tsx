"use client";

import type {
  LibraryContentType,
  LibraryFacets,
  LibraryItem,
  LibraryItemInput,
  LibrarySearchHit,
  LibrarySearchResponse,
} from "@omnitech/interview-contracts";
import { App, ConfigProvider } from "@oc-tech/omni-ui-components";
import { useRouter } from "next/navigation";
import React, {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { extractMarkdownHeadings, MarkdownContent } from "./markdown-content";
import {
  NavigationToggle,
  StudioBrand,
  StudioNavigation,
  ThemeToggle,
  useStudioTheme,
} from "./studio-shell";

const contentTypeLabels: Record<LibraryContentType, string> = {
  "official-reference": "Official Reference",
  "cheat-sheet": "Cheat Sheet",
  "concept-guide": "Concept Guide",
  "dsa-pattern": "DSA Pattern",
};

const emptyDraft: LibraryItemInput = {
  slug: "",
  title: "",
  summary: "",
  body: "# Start here\n\nWrite the concise interview reference.",
  contentType: "concept-guide",
  collection: "react-frontend",
  tags: [],
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json()) as
    | T
    | {
        error?: { message?: string; issues?: string[] };
      };
  if (!response.ok) {
    const error = (body as { error?: { message?: string; issues?: string[] } })
      .error;
    throw new Error(
      [error?.message, ...(error?.issues ?? [])].filter(Boolean).join(" "),
    );
  }
  return body as T;
}

function highlightedExcerpt(value: string, query: string) {
  const term = query.trim();
  if (!term) return value;
  const index = value.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + term.length)}</mark>
      {value.slice(index + term.length)}
    </>
  );
}

function typeClass(type: LibraryContentType) {
  return `library-type library-type-${type}`;
}

function normalizedHeading(value: string) {
  return value.trim().toLocaleLowerCase();
}

function isDocumentTitleHeading(hit: LibrarySearchHit) {
  return (
    hit.headingPath.length === 1 &&
    normalizedHeading(hit.headingPath[0] ?? "") === normalizedHeading(hit.title)
  );
}

function hitHref(hit: LibrarySearchHit) {
  const anchor =
    hit.anchor && !isDocumentTitleHeading(hit) ? `#${hit.anchor}` : "";
  return `/library/${hit.slug}${anchor}`;
}

function articleBodyWithoutDuplicateTitle(body: string, title: string) {
  const lines = body.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine < 0) return body;
  const heading = lines[firstContentLine]?.match(/^#\s+(.+)$/);
  if (
    !heading ||
    normalizedHeading(heading[1] ?? "") !== normalizedHeading(title)
  ) {
    return body;
  }
  lines.splice(firstContentLine, 1);
  if (lines[firstContentLine]?.trim() === "") lines.splice(firstContentLine, 1);
  return lines.join("\n");
}

export function Library({ initialSlug }: { initialSlug?: string | undefined }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LibrarySearchResponse>();
  const [landingResult, setLandingResult] = useState<LibrarySearchResponse>();
  const [facets, setFacets] = useState<LibraryFacets>();
  const [item, setItem] = useState<LibraryItem>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [types, setTypes] = useState<LibraryContentType[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [officialOnly, setOfficialOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { theme, toggleTheme } = useStudioTheme();

  useEffect(() => {
    const collection = new URLSearchParams(window.location.search).get(
      "collection",
    );
    if (collection) setCollections([collection]);
  }, []);

  useEffect(() => {
    void requestJson<LibraryFacets>("/api/v1/library/facets")
      .then(setFacets)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Library failed."),
      );
  }, []);

  useEffect(() => {
    if (!initialSlug) {
      setItem(undefined);
      return;
    }
    setLoading(true);
    void requestJson<LibraryItem>(
      `/api/v1/library/items/${encodeURIComponent(initialSlug)}`,
    )
      .then((next) => {
        setItem(next);
        setError("");
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Article failed."),
      )
      .finally(() => setLoading(false));
  }, [initialSlug]);

  useEffect(() => {
    if (!item || !window.location.hash) return;
    const documentHeading = extractMarkdownHeadings(item.body).find(
      (heading) =>
        heading.depth === 1 &&
        normalizedHeading(heading.text) === normalizedHeading(item.title),
    );
    if (`#${documentHeading?.id}` !== window.location.hash) return;
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, [item]);

  useEffect(() => {
    const controller = new AbortController();
    const isDefaultSearch =
      !query &&
      types.length === 0 &&
      collections.length === 0 &&
      tags.length === 0 &&
      !officialOnly;
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({
        q: query,
        limit: "20",
      });
      for (const type of types) parameters.append("type", type);
      for (const collection of collections) {
        parameters.append("collection", collection);
      }
      for (const tag of tags) parameters.append("tag", tag);
      if (officialOnly) parameters.set("official", "true");
      setLoading(true);
      void requestJson<LibrarySearchResponse>(
        `/api/v1/library/search?${parameters}`,
        { signal: controller.signal },
      )
        .then((next) => {
          setResult(next);
          if (isDefaultSearch) setLandingResult(next);
          setActiveResult(0);
          setError("");
        })
        .catch((reason: unknown) => {
          if ((reason as Error).name !== "AbortError") {
            setError(
              reason instanceof Error ? reason.message : "Search failed.",
            );
          }
        })
        .finally(() => setLoading(false));
    }, 80);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [collections, officialOnly, query, tags, types]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.matches("input, textarea, select, [contenteditable=true]") ??
        false;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const headings = useMemo(
    () =>
      extractMarkdownHeadings(item?.body ?? "").filter(
        (heading) =>
          heading.depth <= 3 &&
          !(
            heading.depth === 1 &&
            normalizedHeading(heading.text) ===
              normalizedHeading(item?.title ?? "")
          ),
      ),
    [item],
  );
  const adjacentItems = useMemo(() => {
    const unique = [
      ...new Map(
        (landingResult?.hits ?? []).map((hit) => [hit.slug, hit]),
      ).values(),
    ];
    const index = unique.findIndex((hit) => hit.slug === item?.slug);
    return {
      previous: index > 0 ? unique[index - 1] : undefined,
      next: index >= 0 ? unique[index + 1] : undefined,
    };
  }, [item?.slug, landingResult]);

  function toggleFilter<T>(
    value: T,
    values: T[],
    setValues: (next: T[]) => void,
  ) {
    setValues(
      values.includes(value)
        ? values.filter((candidate) => candidate !== value)
        : [...values, value],
    );
  }

  function openHit(hit: LibrarySearchHit) {
    router.push(hitHref(hit));
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const hits = result?.hits ?? [];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && hits[activeResult]) {
      event.preventDefault();
      openHit(hits[activeResult]);
    } else if (event.key === "Escape") {
      setQuery("");
      searchRef.current?.blur();
    }
  }

  return (
    <ConfigProvider theme={{ mode: theme }}>
      <App>
        <main className="library-shell">
          <header className="library-header">
            <NavigationToggle
              open={navigationOpen}
              onClick={() => setNavigationOpen((open) => !open)}
            />
            <StudioBrand subtitle="Reference Library" />
            <div className="library-search-wrap">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search React, browser, backend, DSA…"
                aria-label="Search Library"
                aria-controls="library-results"
                aria-activedescendant={
                  result?.hits[activeResult]
                    ? `library-result-${activeResult}`
                    : undefined
                }
              />
              <kbd>⌘K</kbd>
            </div>
            <div className="library-header-actions">
              <button
                className="library-mobile-control"
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                Filters
              </button>
              <button
                className="library-add-button"
                type="button"
                onClick={() => setAuthorOpen(true)}
              >
                <PlusIcon /> Add item
              </button>
              <ThemeToggle theme={theme} onClick={toggleTheme} />
            </div>
          </header>

          {navigationOpen ? (
            <StudioNavigation
              active="library"
              onClose={() => setNavigationOpen(false)}
            />
          ) : null}

          {error ? (
            <div className="library-alert" role="alert">
              {error}
            </div>
          ) : null}

          <div className="library-workspace">
            <aside
              className={`library-filters${filtersOpen ? " open" : ""}`}
              aria-label="Library index"
            >
              {query ||
              types.length ||
              collections.length ||
              tags.length ||
              officialOnly ? (
                <>
                  <div className="library-index-toolbar">
                    <strong>Search index</strong>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setTypes([]);
                        setCollections([]);
                        setTags([]);
                        setOfficialOnly(false);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <SearchResults
                    active={activeResult}
                    loading={loading}
                    query={query}
                    response={result}
                  />
                </>
              ) : (
                <>
                  <FilterGroup label="Content type">
                    {(
                      Object.keys(contentTypeLabels) as LibraryContentType[]
                    ).map((type) => (
                      <FilterButton
                        key={type}
                        active={types.includes(type)}
                        count={facets?.contentTypes[type]}
                        onClick={() => toggleFilter(type, types, setTypes)}
                      >
                        {contentTypeLabels[type]}
                      </FilterButton>
                    ))}
                  </FilterGroup>
                  <FilterGroup label="Collections">
                    {Object.entries(facets?.collections ?? {}).map(
                      ([value, count]) => (
                        <FilterButton
                          key={value}
                          active={collections.includes(value)}
                          count={count}
                          onClick={() =>
                            toggleFilter(value, collections, setCollections)
                          }
                        >
                          {value.replaceAll("-", " ")}
                        </FilterButton>
                      ),
                    )}
                  </FilterGroup>
                  <FilterGroup label="Trust">
                    <FilterButton
                      active={officialOnly}
                      count={facets?.contentTypes["official-reference"]}
                      onClick={() => setOfficialOnly((value) => !value)}
                    >
                      Official only
                    </FilterButton>
                  </FilterGroup>
                  <FilterGroup label="Popular tags">
                    <div className="library-tag-cloud">
                      {Object.entries(facets?.tags ?? {})
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 18)
                        .map(([value, count]) => (
                          <button
                            type="button"
                            key={value}
                            className={tags.includes(value) ? "active" : ""}
                            onClick={() => toggleFilter(value, tags, setTags)}
                          >
                            {value} <span>{count}</span>
                          </button>
                        ))}
                    </div>
                  </FilterGroup>
                </>
              )}
            </aside>

            <section className="library-main">
              {item ? (
                <LibraryArticle item={item} {...adjacentItems} />
              ) : (
                <LibraryLanding response={landingResult} />
              )}
            </section>

            <aside
              className={`library-toc${tocOpen ? " open" : ""}`}
              aria-label="On this page"
            >
              <strong>On this page</strong>
              {item ? (
                <nav>
                  {headings.map((heading) => (
                    <a
                      key={heading.id}
                      className={`depth-${heading.depth}`}
                      href={`#${heading.id}`}
                      onClick={() => setTocOpen(false)}
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              ) : (
                <p>Open a reference to see its sections.</p>
              )}
            </aside>
          </div>

          {item ? (
            <button
              className="library-toc-toggle"
              type="button"
              onClick={() => setTocOpen((open) => !open)}
            >
              Contents
            </button>
          ) : null}
          {authorOpen ? (
            <LibraryAuthor onClose={() => setAuthorOpen(false)} />
          ) : null}
        </main>
      </App>
    </ConfigProvider>
  );
}

function SearchResults({
  active,
  loading,
  query,
  response,
}: {
  active: number;
  loading: boolean;
  query: string;
  response?: LibrarySearchResponse | undefined;
}) {
  return (
    <div className="library-results" id="library-results">
      <header>
        <div>
          <span className="library-eyebrow">Section search</span>
          <h1>{query ? `Results for “${query}”` : "Filtered references"}</h1>
        </div>
        <span aria-live="polite">
          {loading ? "Searching…" : `${response?.total ?? 0} sections`}
        </span>
      </header>
      {response?.hits.length ? (
        <div className="library-result-list">
          {response.hits.map((hit, index) => (
            <a
              id={`library-result-${index}`}
              key={`${hit.itemId}:${hit.anchor}`}
              className={active === index ? "active" : ""}
              href={hitHref(hit)}
              aria-current={active === index ? "true" : undefined}
            >
              <span className="library-result-meta">
                <span className={typeClass(hit.contentType)}>
                  {contentTypeLabels[hit.contentType]}
                </span>
                {hit.official ? (
                  <span className="library-official">Verified source</span>
                ) : null}
              </span>
              <strong>{hit.title}</strong>
              {hit.headingPath.length ? (
                <span className="library-breadcrumb">
                  {hit.headingPath.join(" › ")}
                </span>
              ) : null}
              <p>{highlightedExcerpt(hit.excerpt, query)}</p>
              <span className="library-result-tags">
                {hit.tags.slice(0, 4).map((tag) => (
                  <small key={tag}>{tag}</small>
                ))}
              </span>
            </a>
          ))}
        </div>
      ) : !loading ? (
        <div className="library-empty">
          <h2>No matching reference</h2>
          <p>Try a shorter technical term or remove a filter.</p>
        </div>
      ) : null}
    </div>
  );
}

function LibraryLanding({
  response,
}: {
  response?: LibrarySearchResponse | undefined;
}) {
  const collections = [
    ["react", "React & Frontend", "Hooks, state, rendering, accessibility"],
    ["web", "Web Fundamentals", "Browser, HTTP, CORS, storage"],
    ["backend", "Backend", "APIs, data, caching, reliability"],
    ["dsa", "DSA Patterns", "Recognition cues, invariants, complexity"],
  ] as const;
  return (
    <div className="library-landing">
      <span className="library-eyebrow">Interview reference</span>
      <h1>Find the useful answer, fast.</h1>
      <p>
        Search concise, reviewed sections. Official sources are visibly
        separated from Studio-authored cheat sheets and interview guides.
      </p>
      <div className="library-collection-grid">
        {collections.map(([slug, title, description]) => (
          <a key={slug} href={`?collection=${slug}`}>
            <span>
              {slug === "dsa"
                ? "O(n)"
                : "0" + (collections.findIndex((c) => c[0] === slug) + 1)}
            </span>
            <strong>{title}</strong>
            <small>{description}</small>
          </a>
        ))}
      </div>
      <h2>Recently verified and reviewed</h2>
      <div className="library-quick-list">
        {response?.hits.slice(0, 8).map((hit) => (
          <a key={`${hit.itemId}:${hit.anchor}`} href={hitHref(hit)}>
            <span className={typeClass(hit.contentType)}>
              {contentTypeLabels[hit.contentType]}
            </span>
            <strong>{hit.title}</strong>
            <small>{hit.summary}</small>
          </a>
        ))}
      </div>
    </div>
  );
}

function LibraryArticle({
  item,
  next,
  previous,
}: {
  item: LibraryItem;
  next?: LibrarySearchHit | undefined;
  previous?: LibrarySearchHit | undefined;
}) {
  return (
    <article className="library-article">
      <header className="library-article-header">
        <div className="library-result-meta">
          <span className={typeClass(item.contentType)}>
            {contentTypeLabels[item.contentType]}
          </span>
          <span>{item.collection.replaceAll("-", " ")}</span>
        </div>
        <h1>{item.title}</h1>
        <p>{item.summary}</p>
        {item.source ? (
          <div
            className="library-provenance"
            aria-label={`${item.title} source details`}
          >
            <div>
              <span className="library-official">Official source</span>
              <strong className="library-source-title">{item.title}</strong>
              <span className="library-source-publisher">
                <span>Publisher</span>
                <b>{item.source.publisher}</b>
              </span>
              <small>
                {item.source.version
                  ? `${item.source.publisher} ${item.source.version} · `
                  : ""}
                Verified {item.source.lastVerifiedAt}
              </small>
            </div>
            <a href={item.source.canonicalUrl} target="_blank" rel="noreferrer">
              Open canonical docs ↗
            </a>
          </div>
        ) : (
          <div className="library-studio-source">
            Interview Studio-authored preparation material
          </div>
        )}
        <div className="library-result-tags">
          {item.tags.map((tag) => (
            <small key={tag}>{tag}</small>
          ))}
        </div>
      </header>
      <div className="library-markdown">
        <MarkdownContent>
          {articleBodyWithoutDuplicateTitle(item.body, item.title)}
        </MarkdownContent>
      </div>
      {previous || next ? (
        <nav
          className="library-article-navigation"
          aria-label="Adjacent references"
        >
          {previous ? (
            <a href={`/library/${previous.slug}`}>
              <small>Previous</small>
              <strong>{previous.title}</strong>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a href={`/library/${next.slug}`}>
              <small>Next</small>
              <strong>{next.title}</strong>
            </a>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}

function LibraryAuthor({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<LibraryItemInput>(emptyDraft);
  const [saved, setSaved] = useState<LibraryItem>();
  const [hasPublished, setHasPublished] = useState(false);
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function update<K extends keyof LibraryItemInput>(
    key: K,
    value: LibraryItemInput[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function normalizeTags(value: string) {
    return [
      ...new Set(
        value
          .split(/[,\s]+/)
          .map((tag) =>
            tag
              .trim()
              .toLocaleLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
          )
          .filter(Boolean),
      ),
    ];
  }

  async function save(publish: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const body = JSON.stringify({ ...draft, tags: normalizeTags(tagText) });
      const next = await requestJson<LibraryItem>(
        saved ? `/api/v1/library/items/${saved.id}` : "/api/v1/library/items",
        {
          method: saved ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      );
      setSaved(next);
      if (publish) {
        const published = await requestJson<LibraryItem>(
          `/api/v1/library/items/${next.id}/publish`,
          { method: "POST" },
        );
        setSaved(published);
        setHasPublished(true);
        setMessage("Published and added to search.");
      } else {
        setMessage("Draft saved. It is not visible in search.");
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!saved) return;
    setBusy(true);
    try {
      const archived = await requestJson<LibraryItem>(
        `/api/v1/library/items/${saved.id}/archive`,
        { method: "POST" },
      );
      setSaved(archived);
      setMessage("Archived and removed from search.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Archive failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!saved) return;
    setBusy(true);
    try {
      await requestJson<{ deleted: true }>(
        `/api/v1/library/items/${saved.id}`,
        { method: "DELETE" },
      );
      onClose();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <div className="library-author-scrim" role="presentation">
      <section
        className="library-author"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-author-title"
      >
        <header>
          <div>
            <span className="library-eyebrow">Draft → review → publish</span>
            <h2 id="library-author-title">Add Library item</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close authoring">
            ×
          </button>
        </header>
        <div className="library-author-grid">
          <form onSubmit={(event) => event.preventDefault()}>
            <label>
              Title
              <input
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label>
              Slug
              <input
                value={draft.slug}
                onChange={(event) => update("slug", event.target.value)}
                placeholder="react-state-ownership"
              />
            </label>
            <label>
              Summary
              <textarea
                value={draft.summary}
                onChange={(event) => update("summary", event.target.value)}
              />
            </label>
            <div className="library-author-row">
              <label>
                Type
                <select
                  value={draft.contentType}
                  onChange={(event) => {
                    const contentType = event.target
                      .value as LibraryContentType;
                    setDraft((current) => ({
                      ...current,
                      contentType,
                      ...(contentType === "official-reference"
                        ? {
                            source: current.source ?? {
                              publisher: "",
                              canonicalUrl: "https://",
                              official: true,
                              lastVerifiedAt: new Date()
                                .toISOString()
                                .slice(0, 10),
                            },
                          }
                        : { source: undefined }),
                    }));
                  }}
                >
                  {Object.entries(contentTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Collection
                <input
                  value={draft.collection}
                  onChange={(event) => update("collection", event.target.value)}
                />
              </label>
            </div>
            <label>
              Tags
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="react, hooks, state-management"
              />
              <small>
                Comma or space separated; tags normalize to lowercase slugs.
              </small>
            </label>
            {draft.source ? (
              <fieldset>
                <legend>Official source</legend>
                <label>
                  Publisher
                  <input
                    value={draft.source.publisher}
                    onChange={(event) =>
                      update("source", {
                        ...draft.source!,
                        publisher: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Canonical HTTPS URL
                  <input
                    type="url"
                    value={draft.source.canonicalUrl}
                    onChange={(event) =>
                      update("source", {
                        ...draft.source!,
                        canonicalUrl: event.target.value,
                      })
                    }
                  />
                </label>
              </fieldset>
            ) : null}
            <label>
              Markdown
              <textarea
                className="library-body-editor"
                value={draft.body}
                onChange={(event) => update("body", event.target.value)}
              />
            </label>
          </form>
          <div className="library-author-preview">
            <span className="library-eyebrow">Live preview</span>
            <h1>{draft.title || "Untitled reference"}</h1>
            <p>{draft.summary}</p>
            <MarkdownContent>{draft.body}</MarkdownContent>
          </div>
        </div>
        <footer>
          <span role="status">{message}</span>
          {saved?.status === "draft" && !hasPublished ? (
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={() => void deleteDraft()}
            >
              Delete draft
            </button>
          ) : null}
          {saved && hasPublished && saved.status !== "archived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void archive()}
            >
              Archive
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save draft
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Publish
          </button>
        </footer>
      </section>
    </div>
  );
}

function FilterGroup({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="library-filter-group">
      <h2>{label}</h2>
      {children}
    </section>
  );
}

function FilterButton({
  active,
  children,
  count,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  count?: number | undefined;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      <span>{children}</span>
      {count === undefined ? null : <small>{count}</small>}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13 13 4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
