"use client";

import type { AiTargetSummary } from "@omnitech/ai-contracts";
import type { ProductPageProps } from "@omnitech/platform-contracts";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { slideAppearance } from "../domain/appearance.js";
import type {
  GeneratedImage,
  PresentationDocument,
  PresentationRecording,
  PresentationSummary,
  PresentationTheme,
  Slide,
} from "../domain/index.js";
import type { SlideBlock, SlideBlockType } from "./slide-blocks.js";
import {
  parseSlideBlocks,
  SlideBlockEditor,
  SlideBlockView,
  serializeSlideBlocks,
} from "./slide-blocks.js";

function api(tenantSlug: string, path: string) {
  return `/api/presentation/v1${path}?tenant=${encodeURIComponent(tenantSlug)}`;
}

function persistSelectedAiProfile(profileId: string) {
  window.localStorage.setItem("platform.aiProfileId", profileId);
  window.dispatchEvent(
    new CustomEvent("platform-ai-profile-change", {
      detail: { profileId },
    }),
  );
}

async function json<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & { error?: string }) | undefined;
  try {
    body = JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid response."
        : `Request failed (${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

/**
 * Loads a resource for an effect and returns the effect's cleanup. A cleaned-up
 * effect aborts its request and drops its result, so React StrictMode's dev
 * re-run (or a changed dependency) never leaves two live requests or a stale
 * state update.
 */
function load<T>(
  url: string,
  onData: (value: T) => void,
  onError: (reason: unknown) => void = () => undefined,
): () => void {
  const controller = new AbortController();
  const current = () => !controller.signal.aborted;
  void fetch(url, { signal: controller.signal })
    .then(json<T>)
    .then((value) => {
      if (current()) onData(value);
    })
    .catch((reason: unknown) => {
      if (current()) onError(reason);
    });
  return () => controller.abort();
}

async function ok(response: Response): Promise<void> {
  if (response.ok) return;
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  } catch (reason) {
    if (
      reason instanceof Error &&
      reason.message !== "Unexpected end of JSON input"
    ) {
      throw reason;
    }
    throw new Error(`Request failed (${response.status}).`);
  }
}

function slideSourceCandidate(value: unknown): string | undefined {
  if (typeof value === "string" && value.includes("<SECTION")) return value;
  if (typeof value !== "object" || value === null) return undefined;
  const sourceXml = (value as { sourceXml?: unknown }).sourceXml;
  return typeof sourceXml === "string" && sourceXml.includes("<SECTION")
    ? sourceXml
    : undefined;
}

function StudioPage({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="studio-page">
      <header className="studio-page-header">
        <div>
          <p className="studio-eyebrow">Studio</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="studio-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

const referenceThemes = [
  {
    id: "indigo",
    name: "Indigo",
    fonts: "Poppins / Source Sans Pro",
    frame: "#818cf8",
    card: "#24205a",
    text: "#a5b4fc",
  },
  {
    id: "orbit",
    name: "Orbit",
    fonts: "Space Grotesk / IBM Plex Sans",
    frame: "#3d368f",
    card: "#f8f8f8",
    text: "#393185",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    fonts: "Space Grotesk / IBM Plex Sans",
    frame: "#818cf8",
    card: "#01040e",
    text: "#818cf8",
  },
  {
    id: "piano",
    name: "Piano",
    fonts: "Playfair Display / Lora",
    frame: "#202833",
    card: "#f1f2f4",
    text: "#202833",
  },
  {
    id: "ebony",
    name: "Ebony",
    fonts: "Playfair Display / Lora",
    frame: "#e5e7eb",
    card: "#111827",
    text: "#f8fafc",
  },
  {
    id: "mystique",
    name: "Mystique",
    fonts: "Montserrat / Raleway",
    frame: "#7c3aed",
    card: "#ffffff",
    text: "#7c3aed",
  },
] as const;

const referenceTextOptions = [
  { id: "minimal", name: "Minimal", lines: 2 },
  { id: "concise", name: "Concise", lines: 3 },
  { id: "detailed", name: "Detailed", lines: 3 },
  { id: "extensive", name: "Extensive", lines: 4 },
] as const;

function ReferenceHeader({
  title = "Presentation Studio",
}: {
  title?: string;
}) {
  return (
    <header className="presentation-reference-header">
      <span className="presentation-reference-mark" aria-hidden="true">
        ◌
      </span>
      <span>{title}</span>
    </header>
  );
}

function ReferenceThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: (typeof referenceThemes)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`presentation-reference-theme ${selected ? "selected" : ""}`}
      onClick={onSelect}
      style={
        {
          "--theme-frame": theme.frame,
          "--theme-card": theme.card,
          "--theme-text": theme.text,
        } as React.CSSProperties
      }
      type="button"
    >
      <span className="presentation-reference-theme-preview">
        <strong>Title</strong>
        <span>
          Body text <u>Link</u>
        </span>
        <i />
      </span>
      <span className="presentation-reference-theme-meta">
        <strong>{theme.name}</strong>
        <small>{theme.fonts}</small>
      </span>
      {selected ? (
        <span className="presentation-reference-theme-check">✓</span>
      ) : null}
      {selected ? (
        <span className="presentation-reference-theme-personalize">
          ⚙ Personalize
        </span>
      ) : null}
    </button>
  );
}

export function PresentationLibrary({ tenantSlug }: ProductPageProps) {
  const [items, setItems] = useState<PresentationSummary[]>([]);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<"all" | "recent" | "favorites">("recent");
  const [search, setSearch] = useState("");
  const [listView, setListView] = useState(false);
  const [sortByTitle, setSortByTitle] = useState(false);
  const [slideCount, setSlideCount] = useState(10);
  const [layout, setLayout] = useState("dynamic");
  const [language, setLanguage] = useState("English");
  const [targets, setTargets] = useState<AiTargetSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  useEffect(
    () =>
      load<PresentationSummary[]>(
        api(tenantSlug, "/documents"),
        setItems,
        (reason) =>
          setError(
            reason instanceof Error ? reason.message : "Unable to load.",
          ),
      ),
    [tenantSlug],
  );
  useEffect(
    () =>
      load<AiTargetSummary[]>(
        `/api/platform/v1/ai-targets?tenant=${encodeURIComponent(tenantSlug)}`,
        (available) => {
          setTargets(
            available.filter(
              (target) =>
                target.family === "direct-model" && target.kind === "language",
            ),
          );
          const persisted = window.localStorage.getItem("platform.aiProfileId");
          setTargetId(
            (current) => current || persisted || available[0]?.id || "",
          );
        },
      ),
    [tenantSlug],
  );
  const visibleItems = [...items]
    .sort((left, right) =>
      sortByTitle
        ? left.title.localeCompare(right.title)
        : right.updatedAt.localeCompare(left.updatedAt),
    )
    .filter((item) => {
      if (tab === "favorites" && !item.favorite) return false;
      return item.title.toLowerCase().includes(search.toLowerCase());
    });
  function openCreate() {
    sessionStorage.setItem(
      "presentation.create-settings",
      JSON.stringify({
        prompt: prompt.trim(),
        slideCount,
        layout,
        language,
        targetId,
      }),
    );
    window.location.assign(`/t/${tenantSlug}/p/presentation/create`);
  }
  return (
    <section className="presentation-reference-app">
      <ReferenceHeader />
      <main className="presentation-reference-main">
        <h1>What presentation would you like to create today?</h1>
        <div className="presentation-reference-prompt">
          <textarea
            aria-label="Presentation prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe your topic or paste your content here. Our AI will structure it into a compelling presentation."
            value={prompt}
          />
          <div className="presentation-reference-prompt-actions">
            <label className="presentation-reference-pill">
              <span aria-hidden="true">▣</span>
              <select
                aria-label="Slide count"
                onChange={(event) => setSlideCount(Number(event.target.value))}
                value={slideCount}
              >
                <option value={5}>5 slides</option>
                <option value={10}>10 slides</option>
                <option value={15}>15 slides</option>
                <option value={20}>20 slides</option>
              </select>
            </label>
            <label className="presentation-reference-pill">
              <span aria-hidden="true">▦</span>
              <select
                aria-label="Presentation layout"
                onChange={(event) => setLayout(event.target.value)}
                value={layout}
              >
                <option value="dynamic">Dynamic</option>
                <option value="classic">Classic</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
            <label className="presentation-reference-pill">
              <span aria-hidden="true">文</span>
              <select
                aria-label="Presentation language"
                onChange={(event) => setLanguage(event.target.value)}
                value={language}
              >
                <option>English</option>
                <option>French</option>
                <option>Spanish</option>
              </select>
            </label>
            <button
              className="presentation-reference-pill presentation-reference-pill-button"
              onClick={openCreate}
              type="button"
            >
              <span aria-hidden="true">✣</span>More
            </button>
            <label className="presentation-reference-pill">
              <span aria-hidden="true">▱</span>
              <select
                aria-label="AI model"
                onChange={(event) => {
                  setTargetId(event.target.value);
                  persistSelectedAiProfile(event.target.value);
                }}
                value={targetId}
              >
                {targets.length === 0 ? (
                  <option value="">AI unavailable</option>
                ) : (
                  targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label} · {target.modelId ?? target.id}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              aria-label="Create presentation"
              className="presentation-reference-submit"
              onClick={openCreate}
              type="button"
            >
              →
            </button>
          </div>
        </div>
        <div className="presentation-reference-library-toolbar">
          <div>
            {(
              [
                ["all", "▣ All"],
                ["recent", "◷ Recently updated"],
                ["favorites", "☆ Favorites"],
              ] as const
            ).map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="presentation-reference-library-actions">
            <input
              aria-label="Search presentations"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="⌕"
              value={search}
            />
            <button onClick={openCreate} type="button">
              ＋ Create new
            </button>
            <button
              aria-label="Sort presentations by title"
              aria-pressed={sortByTitle}
              onClick={() => setSortByTitle((current) => !current)}
              type="button"
            >
              A–Z
            </button>
            <button
              className={!listView ? "active" : ""}
              onClick={() => setListView(false)}
              type="button"
            >
              ▦ Grid
            </button>
            <button
              className={listView ? "active" : ""}
              onClick={() => setListView(true)}
              type="button"
            >
              ☷ List
            </button>
          </div>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <div
          className={`presentation-reference-files ${listView ? "is-list" : ""}`}
        >
          {visibleItems.map((item) => (
            <article className="presentation-reference-file" key={item.id}>
              <a href={`/t/${tenantSlug}/p/presentation/editor/${item.id}`}>
                <div className="presentation-reference-file-preview">
                  <span>{item.title}</span>
                </div>
                <strong>{item.title}</strong>
                <small>
                  {item.slideCount} slides · revision {item.revision}
                </small>
              </a>
              <button
                aria-label={`${item.favorite ? "Remove" : "Add"} ${item.title} favorite`}
                onClick={() =>
                  void fetch(
                    api(tenantSlug, `/documents/${item.id}/favorite`),
                    {
                      method: "PUT",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ enabled: !item.favorite }),
                    },
                  )
                    .then(ok)
                    .then(() =>
                      setItems((current) =>
                        current.map((candidate) =>
                          candidate.id === item.id
                            ? { ...candidate, favorite: !candidate.favorite }
                            : candidate,
                        ),
                      ),
                    )
                    .catch((reason: unknown) =>
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "Unable to update favorite.",
                      ),
                    )
                }
                type="button"
              >
                {item.favorite ? "★" : "☆"}
              </button>
            </article>
          ))}
          {visibleItems.length === 0 ? (
            <p className="presentation-reference-empty">
              {items.length > 0
                ? "No presentations match this search or filter."
                : "No presentations yet. Create one above."}
            </p>
          ) : null}
        </div>
      </main>
      <button
        aria-label="Help"
        className="presentation-reference-help"
        type="button"
      >
        ?
      </button>
    </section>
  );
}

export function PresentationCreate({ tenantSlug }: ProductPageProps) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [textContent, setTextContent] = useState("concise");
  const [tone, setTone] = useState("Auto");
  const [audience, setAudience] = useState("Auto");
  const [scenario, setScenario] = useState("Auto");
  const [theme, setTheme] = useState("ebony");
  const [slideCount, setSlideCount] = useState(10);
  const [layout, setLayout] = useState("dynamic");
  const [language, setLanguage] = useState("English");
  const [targets, setTargets] = useState<AiTargetSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  useEffect(() => {
    const raw = sessionStorage.getItem("presentation.create-settings");
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          prompt?: string;
          slideCount?: number;
          layout?: string;
          language?: string;
          targetId?: string;
        };
        if (saved.prompt) {
          setTopic(saved.prompt);
          setTitle(saved.prompt.split(/[.!?]/)[0]?.slice(0, 80) ?? "");
        }
        if (saved.slideCount) setSlideCount(saved.slideCount);
        if (saved.layout) setLayout(saved.layout);
        if (saved.language) setLanguage(saved.language);
        if (saved.targetId) setTargetId(saved.targetId);
      } catch {
        // Ignore stale settings and let the create form use its defaults.
      }
      sessionStorage.removeItem("presentation.create-settings");
    }
  }, []);
  useEffect(
    () =>
      load<AiTargetSummary[]>(
        `/api/platform/v1/ai-targets?tenant=${encodeURIComponent(tenantSlug)}`,
        (available) => {
          const languageTargets = available.filter(
            (target) =>
              target.family === "direct-model" && target.kind === "language",
          );
          setTargets(languageTargets);
          const persisted = window.localStorage.getItem("platform.aiProfileId");
          setTargetId(
            (current) => current || persisted || languageTargets[0]?.id || "",
          );
        },
      ),
    [tenantSlug],
  );
  async function create() {
    setStatus("Creating…");
    try {
      const result = await fetch(api(tenantSlug, "/documents"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title || topic || "Untitled presentation",
          outline,
          settings: {
            textContent,
            tone,
            audience,
            scenario,
            theme,
            slideCount,
            layout,
            language,
            targetId,
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      }).then(json<{ id: string }>);
      window.location.assign(
        `/t/${tenantSlug}/p/presentation/editor/${result.id}`,
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Creation failed.");
    }
  }
  async function generateOutline() {
    setStatus("Generating outline…");
    try {
      const execution = await fetch(api(tenantSlug, "/generate/outline"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: topic,
          profileId: targetId || "document-fast",
          slideCount,
          language,
          layout,
          textContent,
          tone,
          audience,
          scenario,
        }),
      }).then(json<{ result: { title?: string; outline?: string[] } }>);
      setTitle(execution.result.title ?? title);
      setOutline(execution.result.outline ?? []);
      setStatus("Outline ready.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Generation failed.",
      );
    }
  }
  return (
    <section className="presentation-reference-app presentation-reference-create">
      <ReferenceHeader title={title || "New presentation"} />
      <main className="presentation-reference-main">
        <section className="presentation-reference-summary">
          <input
            aria-label="Presentation title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Presentation title"
            value={title}
          />
          <span>⌄</span>
          <label className="presentation-reference-pill">
            <span aria-hidden="true">▣</span>
            <select
              aria-label="Slide count"
              onChange={(event) => setSlideCount(Number(event.target.value))}
              value={slideCount}
            >
              <option value={5}>5 slides</option>
              <option value={10}>10 slides</option>
              <option value={15}>15 slides</option>
              <option value={20}>20 slides</option>
            </select>
          </label>
          <label className="presentation-reference-pill">
            <span aria-hidden="true">▦</span>
            <select
              aria-label="Presentation layout"
              onChange={(event) => setLayout(event.target.value)}
              value={layout}
            >
              <option value="dynamic">Dynamic</option>
              <option value="classic">Classic</option>
              <option value="minimal">Minimal</option>
            </select>
          </label>
          <label className="presentation-reference-pill">
            <span aria-hidden="true">文</span>
            <select
              aria-label="Presentation language"
              onChange={(event) => setLanguage(event.target.value)}
              value={language}
            >
              <option>English</option>
              <option>French</option>
              <option>Spanish</option>
            </select>
          </label>
          <label className="presentation-reference-pill">
            <span aria-hidden="true">▱</span>
            <select
              aria-label="AI model"
              onChange={(event) => {
                setTargetId(event.target.value);
                persistSelectedAiProfile(event.target.value);
              }}
              value={targetId}
            >
              {targets.length === 0 ? (
                <option value="">AI unavailable</option>
              ) : (
                targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.modelId ?? target.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            disabled={
              !topic.trim() ||
              status === "Generating outline…" ||
              status === "Creating…"
            }
            onClick={() => void generateOutline()}
            type="button"
          >
            ⟳ Regenerate
          </button>
        </section>
        <label className="presentation-reference-topic-label">
          Presentation brief
          <textarea
            aria-label="Presentation prompt"
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Describe your topic or paste your content here."
            value={topic}
          />
        </label>
        <section className="presentation-reference-setting-card">
          <h2>☷ Text Content</h2>
          <p>Amount of text per card</p>
          <div className="presentation-reference-density-grid">
            {referenceTextOptions.map((option) => (
              <button
                className={textContent === option.id ? "selected" : ""}
                key={option.id}
                onClick={() => setTextContent(option.id)}
                type="button"
              >
                <span className="presentation-reference-lines">
                  {Array.from({ length: option.lines }).map((_, index) => (
                    <i key={index} />
                  ))}
                </span>
                <strong>{option.name}</strong>
              </button>
            ))}
          </div>
          <div className="presentation-reference-select-grid">
            {[
              ["Tone", tone, setTone],
              ["Audience", audience, setAudience],
              ["Scenario", scenario, setScenario],
            ].map(([label, value, setter]) => (
              <label key={label as string}>
                {label as string}
                <select
                  onChange={(event) =>
                    (setter as (value: string) => void)(event.target.value)
                  }
                  value={value as string}
                >
                  <option>Auto</option>
                  <option>General</option>
                  <option>Business</option>
                  <option>Investor</option>
                  <option>Teacher</option>
                  <option>Student</option>
                </select>
              </label>
            ))}
          </div>
        </section>
        <section className="presentation-reference-setting-card">
          <div className="presentation-reference-section-heading">
            <div>
              <h2>Customize Theme</h2>
              <p>
                Pick a visual direction and image source before rendering
                slides.
              </p>
            </div>
            <a href={`/t/${tenantSlug}/p/presentation/themes`}>More Themes</a>
          </div>
          <h3>Theme &amp; Layout</h3>
          <div className="presentation-reference-theme-grid">
            {referenceThemes.map((item) => (
              <ReferenceThemeCard
                key={item.id}
                onSelect={() => setTheme(item.id)}
                selected={theme === item.id}
                theme={item}
              />
            ))}
          </div>
          <a href={`/t/${tenantSlug}/p/presentation/images`}>
            Upload or generate images in Image Studio, then insert them from the
            editor.
          </a>
        </section>
        {outline.length > 0 ? (
          <section className="presentation-reference-outline">
            <h2>Outline</h2>
            {outline.map((item, index) => (
              <input
                aria-label={`Slide ${index + 1} outline`}
                key={index}
                onChange={(event) =>
                  setOutline((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index ? event.target.value : value,
                    ),
                  )
                }
                value={item}
              />
            ))}
          </section>
        ) : null}
      </main>
      <footer className="presentation-reference-footer">
        <span aria-live="polite">{status}</span>
        {outline.length > 0 ? (
          <button
            disabled={status === "Creating…"}
            onClick={() => void create()}
            type="button"
          >
            Create presentation
          </button>
        ) : null}
        <button
          disabled={
            !topic.trim() ||
            status === "Generating outline…" ||
            status === "Creating…"
          }
          onClick={() => void generateOutline()}
          type="button"
        >
          ✣ Generate Outline
        </button>
        <button aria-label="Help" type="button">
          ?
        </button>
      </footer>
    </section>
  );
}

function defaultSlide(position: number): Slide {
  return {
    id: crypto.randomUUID(),
    position,
    sourceXml:
      '<SECTION layout="vertical"><H1>New slide</H1><P>Add your content</P></SECTION>',
    content: {},
    revision: 1,
  };
}

export function PresentationEditor({
  tenantSlug,
  pathSegments,
}: ProductPageProps) {
  const id = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [slidePrompt, setSlidePrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const [agentCandidate, setAgentCandidate] = useState("");
  const [agentJobId, setAgentJobId] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareId, setShareId] = useState("");
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [themes, setThemes] = useState<PresentationTheme[]>([]);
  const [activePanel, setActivePanel] = useState<
    | "text"
    | "elements"
    | "charts"
    | "diagrams"
    | "embeds"
    | "setup"
    | "themes"
    | "record"
    | "ai"
    | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelSearch, setPanelSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [undoSources, setUndoSources] = useState<
    Array<{ id: string; source: string }>
  >([]);
  const [redoSources, setRedoSources] = useState<
    Array<{ id: string; source: string }>
  >([]);
  const [dirtySlides, setDirtySlides] = useState<Set<string>>(new Set());
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirtySlides.size === 0) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySlides]);
  const selected = useMemo(
    () => document?.slides.find((slide) => slide.id === selectedId),
    [document, selectedId],
  );
  useEffect(() => {
    if (!id) return;
    return load<PresentationDocument>(
      api(tenantSlug, `/documents/${id}`),
      (value) => {
        setDocument(value);
        setSelectedId(value.slides[0]?.id ?? "");
      },
      (reason) =>
        setStatus(reason instanceof Error ? reason.message : "Unable to load."),
    );
  }, [id, tenantSlug]);
  useEffect(
    () => load<GeneratedImage[]>(api(tenantSlug, "/images"), setImages),
    [tenantSlug],
  );
  useEffect(
    () => load<PresentationTheme[]>(api(tenantSlug, "/themes"), setThemes),
    [tenantSlug],
  );
  async function saveDocument(next: PresentationDocument) {
    setStatus("Saving…");
    try {
      const response = await fetch(api(tenantSlug, `/documents/${next.id}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: next.title,
          outline: next.outline,
          themeId: next.themeId,
          settings: next.settings,
          expectedRevision: next.revision,
        }),
      }).then(json<{ revision: number }>);
      setDocument({ ...next, revision: response.revision });
      setStatus("Saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
  }
  async function saveSlide(slide: Slide) {
    if (!document) return;
    setStatus("Saving slide…");
    try {
      const response = await fetch(
        api(tenantSlug, `/documents/${document.id}/slides`),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(slide),
        },
      ).then(json<{ id: string; revision: number }>);
      setDocument({
        ...document,
        slides: document.slides.map((item) =>
          item.id === slide.id
            ? { ...slide, id: response.id, revision: response.revision }
            : item,
        ),
      });
      setDirtySlides((current) => {
        const next = new Set(current);
        next.delete(slide.id);
        return next;
      });
      setStatus("Saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
  }
  async function deleteSlide(slide: Slide) {
    if (!document || document.slides.length <= 1) return;
    if (dirtySlides.has(slide.id)) {
      setStatus("Save slide changes before deleting.");
      return;
    }
    setStatus("Deleting slide…");
    try {
      await fetch(
        api(tenantSlug, `/documents/${document.id}/slides/${slide.id}`),
        { method: "DELETE" },
      ).then(ok);
      const slides = document.slides
        .filter((item) => item.id !== slide.id)
        .map((item, position) => ({ ...item, position }));
      const latest = await fetch(
        api(tenantSlug, `/documents/${document.id}`),
      ).then(json<PresentationDocument>);
      setDocument({ ...document, revision: latest.revision, slides });
      setDirtySlides(
        (current) => new Set([...current].filter((id) => id !== slide.id)),
      );
      setSelectedId(slides[0]?.id ?? "");
      setStatus("Slide deleted.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Delete failed.");
    }
  }
  async function moveSlide(slide: Slide, position: number) {
    if (!document || position < 0 || position >= document.slides.length) return;
    if (dirtySlides.size > 0) {
      setStatus("Save slide changes before reordering.");
      return;
    }
    setStatus("Moving slide…");
    try {
      await fetch(
        api(tenantSlug, `/documents/${document.id}/slides/${slide.id}`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ position }),
        },
      ).then(ok);
      const slides = [...document.slides]
        .sort((left, right) => left.position - right.position)
        .filter((item) => item.id !== slide.id);
      slides.splice(position, 0, slide);
      const latest = await fetch(
        api(tenantSlug, `/documents/${document.id}`),
      ).then(json<PresentationDocument>);
      setDocument({
        ...document,
        revision: latest.revision,
        slides: slides.map((item, index) => ({ ...item, position: index })),
      });
      setStatus("Slide moved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Move failed.");
    }
  }
  async function runAgent() {
    if (!document || !selected || !agentPrompt.trim()) return;
    setStatus("Starting design agent…");
    try {
      const job = await fetch(
        `/api/platform/v1/agent-jobs?tenant=${encodeURIComponent(tenantSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            productId: "omnitech.presentation",
            profileId: "presentation-editor",
            prompt: [
              "Presentation id:",
              document.id,
              "Selected slide source:",
              selected.sourceXml,
              "Requested change:",
              agentPrompt,
            ].join("\n"),
          }),
        },
      ).then(json<{ id: string; status: string }>);
      setStatus(`Agent job ${job.status}. Follow progress in the terminal.`);
      setAgentJobId(job.id);
      void watchAgent(job.id);
      setAgentPrompt("");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Agent failed.");
    }
  }
  async function generateSlide() {
    if (!document || !slidePrompt.trim()) return;
    setStatus("Generating slide…");
    try {
      const generated = await fetch(
        api(tenantSlug, `/documents/${document.id}/slides/generate`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: slidePrompt,
            profileId:
              window.localStorage.getItem("platform.aiProfileId") ||
              "document-fast",
            position: document.slides.length,
          }),
        },
      ).then(json<{ result: { sourceXml?: string }; position: number }>);
      if (!generated.result.sourceXml)
        throw new Error("Generated slide was empty.");
      const slide = {
        ...defaultSlide(generated.position),
        sourceXml: generated.result.sourceXml,
      };
      setDocument({ ...document, slides: [...document.slides, slide] });
      setDirtySlides((current) => new Set([...current, slide.id]));
      setSelectedId(slide.id);
      setSlidePrompt("");
      setStatus("Slide draft ready; save it to keep the changes.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Slide generation failed.",
      );
    }
  }
  async function watchAgent(jobId: string) {
    let sequence = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const events = await fetch(
          `/api/platform/v1/agent-jobs/${jobId}/events?tenant=${encodeURIComponent(tenantSlug)}&after=${sequence}`,
        ).then(
          json<
            Array<{
              sequence: number;
              event: {
                type: string;
                text?: string;
                result?: { output?: unknown };
                error?: { message?: string };
              };
            }>
          >,
        );
        for (const persisted of events) {
          sequence = Math.max(sequence, persisted.sequence);
          const event = persisted.event;
          if (event.type === "text-delta") {
            setAgentOutput((current) => `${current}${event.text ?? ""}`);
          } else if (event.type === "awaiting-input") {
            setStatus("Agent is waiting for approval or more input.");
            return;
          } else if (event.type === "completed") {
            setStatus("Agent completed; review the staged result.");
            if (event.result?.output !== undefined) {
              const output = event.result.output;
              setAgentOutput(JSON.stringify(output, null, 2));
              setAgentCandidate(slideSourceCandidate(output) ?? "");
            }
            try {
              const job = await fetch(
                `/api/platform/v1/agent-jobs/${jobId}?tenant=${encodeURIComponent(tenantSlug)}`,
              ).then(json<{ result?: { output?: unknown } | unknown }>);
              const durableOutput =
                typeof job.result === "object" &&
                job.result !== null &&
                "output" in job.result
                  ? job.result.output
                  : job.result;
              if (durableOutput !== undefined) {
                setAgentOutput(JSON.stringify(durableOutput, null, 2));
                setAgentCandidate(slideSourceCandidate(durableOutput) ?? "");
              }
            } catch {
              // The completion event is still usable if the durable payload is unavailable.
            }
            return;
          } else if (event.type === "failed") {
            setStatus(event.error?.message ?? "Agent failed.");
            return;
          }
        }
      } catch (reason) {
        setStatus(
          reason instanceof Error ? reason.message : "Agent polling failed.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    setStatus(
      "Agent is still running; progress remains available in the terminal.",
    );
  }
  async function cancelAgent() {
    if (!agentJobId) return;
    try {
      await fetch(
        `/api/platform/v1/agent-jobs/${agentJobId}?tenant=${encodeURIComponent(tenantSlug)}`,
        { method: "DELETE" },
      ).then(ok);
      setStatus("Agent cancellation requested.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Cancellation failed.",
      );
    }
  }
  async function resumeAgent() {
    if (!agentJobId || !agentPrompt.trim()) return;
    try {
      await fetch(
        `/api/platform/v1/agent-jobs/${agentJobId}/resume?tenant=${encodeURIComponent(tenantSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: agentPrompt }),
        },
      ).then(ok);
      setStatus("Agent resume queued.");
      setAgentPrompt("");
      void watchAgent(agentJobId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Resume failed.");
    }
  }
  async function createShare() {
    if (!document) return;
    setStatus("Creating share link…");
    try {
      const result = await fetch(
        api(tenantSlug, `/documents/${document.id}/shares`),
        { method: "POST" },
      ).then(json<{ id: string; token: string }>);
      setShareId(result.id);
      const url = `${window.location.origin}/share/presentation/${result.token}`;
      setShareUrl(url);
      await navigator.clipboard?.writeText(url);
      setStatus("Share link ready.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Share failed.");
    }
  }
  async function revokeShare() {
    if (!shareId) return;
    try {
      await fetch(api(tenantSlug, `/shares/${shareId}`), {
        method: "DELETE",
      }).then(ok);
      setShareId("");
      setShareUrl("");
      setStatus("Share link revoked.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Unable to revoke share.",
      );
    }
  }
  async function exportDocument(format: "pptx" | "pdf") {
    if (!document) return;
    if (dirtySlides.size > 0) {
      setStatus("Save your slide changes before exporting.");
      return;
    }
    setStatus(`Exporting ${format.toUpperCase()}…`);
    try {
      const result = await fetch(
        api(tenantSlug, `/documents/${document.id}/exports`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            format,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      ).then(json<{ assetReference: string }>);
      const link = window.document.createElement("a");
      link.href = result.assetReference;
      link.download = `${document.title || "presentation"}.${format}`;
      link.click();
      setStatus(`${format.toUpperCase()} exported.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Export failed.");
    }
  }
  function updateSelectedSource(sourceXml: string) {
    if (!document || !selected || sourceXml === selected.sourceXml) return;
    setUndoSources((current) => [
      ...current.slice(-99),
      { id: selected.id, source: selected.sourceXml },
    ]);
    setRedoSources([]);
    setDirtySlides((current) => new Set([...current, selected.id]));
    setStatus("Unsaved changes. Save slide to keep this edit.");
    setDocument({
      ...document,
      slides: document.slides.map((slide) =>
        slide.id === selected.id ? { ...slide, sourceXml } : slide,
      ),
    });
  }
  function restoreSource(direction: "undo" | "redo") {
    if (!document) return;
    const stack = direction === "undo" ? undoSources : redoSources;
    const entry = stack.at(-1);
    const slide = document.slides.find((item) => item.id === entry?.id);
    if (!entry || !slide) return;
    const inverse = { id: slide.id, source: slide.sourceXml };
    if (direction === "undo") {
      setUndoSources(stack.slice(0, -1));
      setRedoSources((current) => [...current, inverse]);
    } else {
      setRedoSources(stack.slice(0, -1));
      setUndoSources((current) => [...current, inverse]);
    }
    setDocument({
      ...document,
      slides: document.slides.map((item) =>
        item.id === entry.id ? { ...item, sourceXml: entry.source } : item,
      ),
    });
    setSelectedId(entry.id);
    setDirtySlides((current) => new Set([...current, entry.id]));
    setStatus("Unsaved changes. Save slide to keep this edit.");
  }
  function addReferenceBlock(type: SlideBlockType, text: string) {
    if (!selected) return;
    const blocks = parseSlideBlocks(selected.sourceXml);
    const sourceXml = serializeSlideBlocks(selected.sourceXml, [
      ...blocks,
      { type, text } satisfies SlideBlock,
    ]);
    updateSelectedSource(sourceXml);
    setStatus(`${type.toLowerCase()} added to slide. Save slide to publish.`);
  }
  function panelCards(panel: Exclude<typeof activePanel, null>) {
    const cards: Array<[string, SlideBlockType, string]> =
      panel === "text"
        ? [
            ["Title", "TITLE", "New title"],
            ["Heading 1", "H1", "New heading"],
            ["Heading 2", "H2", "New heading"],
            ["Heading 3", "H3", "New heading"],
            ["Text", "P", "Add supporting text"],
            ["Blockquote", "QUOTE", "A memorable quote"],
            ["Code block", "CODE", "const example = true;"],
            ["Call to action", "P", "Learn more"],
            ["Table of contents", "P", "1. Overview\n2. Next steps"],
          ]
        : panel === "elements"
          ? [
              [
                "Bullet Points",
                "BULLETS",
                "First point\nSecond point\nThird point",
              ],
              ["Timeline", "BULLETS", "Now\nNext\nLater"],
              ["Steps", "BULLETS", "1. Discover\n2. Design\n3. Deliver"],
              ["Large Quote", "QUOTE", "Make the complex feel simple."],
              ["Side Quote", "QUOTE", "A useful perspective"],
              ["Comparison", "COLUMNS", "Before | After"],
              ["Before / After", "COLUMNS", "Before | After"],
              ["Pros & Cons", "COLUMNS", "Pros | Cons"],
            ]
          : panel === "charts"
            ? [
                [
                  "Bar chart",
                  "CHART",
                  '{"labels":["Q1","Q2","Q3"],"values":[24,42,35]}',
                ],
              ]
            : panel === "diagrams"
              ? [
                  [
                    "Process flow",
                    "DIAGRAM",
                    '{"nodes":["Input","Process","Output"],"edges":[]}',
                  ],
                ]
              : [];

    return cards;
  }
  if (!id) {
    return (
      <StudioPage description="Choose a presentation to edit." title="Editor">
        <a href={`/t/${tenantSlug}/p/presentation/library`}>
          Open presentation library
        </a>
      </StudioPage>
    );
  }
  if (!document) {
    return (
      <StudioPage description="Preparing the editor." title="Loading…">
        <p aria-live="polite">{status}</p>
      </StudioPage>
    );
  }
  return (
    <section className="presentation-reference-editor">
      <header className="presentation-reference-editor-header">
        <button
          aria-label="Open presentation menu"
          className="presentation-editor-icon-button"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          ☰
        </button>
        <span className="presentation-reference-editor-logo">◌</span>
        <input
          aria-label="Presentation title"
          className="presentation-reference-editor-title"
          onBlur={() => void saveDocument(document)}
          onChange={(event) =>
            setDocument({ ...document, title: event.target.value })
          }
          value={document.title}
        />
        <span aria-live="polite" className="presentation-editor-status">
          {status}
        </span>
        <div className="presentation-reference-editor-actions">
          <button
            onClick={() =>
              setActivePanel(activePanel === "themes" ? null : "themes")
            }
            type="button"
          >
            Theme
          </button>
          <button onClick={() => setExportOpen(true)} type="button">
            Export
          </button>
          <a
            className="presentation-reference-present"
            href={`/t/${tenantSlug}/p/presentation/present/${document.id}`}
          >
            Present
          </a>
        </div>
      </header>
      {menuOpen ? (
        <aside
          className="presentation-reference-menu"
          aria-label="Presentation menu"
        >
          <p>FILE</p>
          <button
            onClick={() =>
              window.location.assign(`/t/${tenantSlug}/p/presentation/create`)
            }
            type="button"
          >
            ＋ New Presentation
          </button>
          <button
            onClick={() =>
              window.document
                .querySelector<HTMLInputElement>(
                  ".presentation-reference-editor-title",
                )
                ?.focus()
            }
            type="button"
          >
            ✎ Rename
          </button>
          <button onClick={() => void createShare()} type="button">
            Share presentation
          </button>
          <button
            onClick={async () => {
              try {
                const copy = await fetch(
                  api(tenantSlug, `/documents/${document.id}/duplicate`),
                  { method: "POST" },
                ).then(json<{ id: string }>);
                window.location.assign(
                  `/t/${tenantSlug}/p/presentation/editor/${copy.id}`,
                );
              } catch (reason) {
                setStatus(
                  reason instanceof Error
                    ? reason.message
                    : "Duplicate failed.",
                );
              }
            }}
            type="button"
          >
            Duplicate presentation
          </button>
          {shareId ? (
            <button onClick={() => void revokeShare()} type="button">
              Revoke share link
            </button>
          ) : null}
          <p>EDIT</p>
          <button
            disabled={undoSources.length === 0}
            onClick={() => restoreSource("undo")}
            type="button"
          >
            ↶ Undo
          </button>
          <button
            disabled={redoSources.length === 0}
            onClick={() => restoreSource("redo")}
            type="button"
          >
            ↷ Redo
          </button>
          <p>WORKSPACE</p>
          <button
            onClick={() => {
              setActivePanel("setup");
              setMenuOpen(false);
            }}
            type="button"
          >
            ⚙ Page Setup
          </button>
          <button
            onClick={() => {
              setActivePanel("themes");
              setMenuOpen(false);
            }}
            type="button"
          >
            ◈ Theme Panel
          </button>
          <p>VIEW</p>
          <button
            onClick={() =>
              window.location.assign(`/t/${tenantSlug}/p/presentation/create`)
            }
            type="button"
          >
            ← Back to prompt
          </button>
          <button
            onClick={() =>
              window.location.assign(`/t/${tenantSlug}/p/presentation/library`)
            }
            type="button"
          >
            ▦ All Presentations
          </button>
        </aside>
      ) : null}
      <aside className="presentation-reference-slide-rail" aria-label="Slides">
        {document.slides.map((slide) => (
          <div
            className={`presentation-reference-thumb ${slide.id === selectedId ? "is-selected" : ""}`}
            key={slide.id}
          >
            <button
              aria-label={`Select slide ${slide.position + 1}`}
              aria-current={slide.id === selectedId ? "true" : undefined}
              onClick={() => setSelectedId(slide.id)}
              type="button"
            >
              <span>{slide.position + 1}</span>
              <div>
                <SlideBlockView
                  source={slide.sourceXml}
                  appearance={slideAppearance(document?.settings ?? {})}
                />
              </div>
            </button>
            <div className="presentation-reference-thumb-actions">
              <button
                aria-label={`Move slide ${slide.position + 1} up`}
                disabled={slide.position === 0}
                onClick={() => void moveSlide(slide, slide.position - 1)}
                type="button"
              >
                ↑
              </button>
              <button
                aria-label={`Move slide ${slide.position + 1} down`}
                disabled={slide.position === document.slides.length - 1}
                onClick={() => void moveSlide(slide, slide.position + 1)}
                type="button"
              >
                ↓
              </button>
            </div>
          </div>
        ))}
        <button
          aria-label="Add slide"
          className="presentation-reference-add-slide"
          onClick={() => {
            const slide = defaultSlide(document.slides.length);
            setDocument({ ...document, slides: [...document.slides, slide] });
            setDirtySlides((current) => new Set([...current, slide.id]));
            setSelectedId(slide.id);
          }}
          type="button"
        >
          ＋
        </button>
      </aside>
      <main
        className="presentation-reference-canvas"
        style={
          { "--presentation-zoom": `${zoom / 100}` } as React.CSSProperties
        }
      >
        {document.slides.map((slide) => (
          <React.Fragment key={slide.id}>
            <article
              className={`presentation-reference-slide-card ${slide.id === selectedId ? "is-selected" : ""}`}
              key={slide.id}
              data-slide-id={slide.id}
              onClick={() => setSelectedId(slide.id)}
            >
              <span className="presentation-reference-slide-number">
                {slide.position + 1}
              </span>
              <SlideBlockView
                source={slide.sourceXml}
                appearance={slideAppearance(document?.settings ?? {})}
              />
            </article>
            {slide.id === selectedId && selected ? (
              <section className="presentation-reference-editor-form">
                <SlideBlockEditor
                  key={selected.id}
                  onChange={updateSelectedSource}
                  source={selected.sourceXml}
                />
                <div className="presentation-reference-form-actions">
                  <button
                    className="studio-primary-action"
                    onClick={() => void saveSlide(selected)}
                    type="button"
                  >
                    Save slide
                  </button>
                  <button
                    disabled={document.slides.length <= 1}
                    onClick={() => void deleteSlide(selected)}
                    type="button"
                  >
                    Delete slide
                  </button>
                </div>
              </section>
            ) : null}
          </React.Fragment>
        ))}
      </main>
      <aside
        className="presentation-reference-tool-rail"
        aria-label="Slide tools"
      >
        {(
          [
            ["text", "Aa", "Text"],
            ["elements", "▦", "Add elements"],
            ["charts", "◔", "Add Charts"],
            ["diagrams", "⌁", "Add Diagrams"],
            ["embeds", "↗", "Media Embeds"],
            ["record", "◉", "Record"],
            ["ai", "✣", "AI tools"],
          ] as const
        ).map(([panel, icon, label]) => (
          <button
            aria-label={label}
            className={activePanel === panel ? "is-active" : ""}
            key={panel}
            onClick={() => setActivePanel(activePanel === panel ? null : panel)}
            type="button"
          >
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </aside>
      {activePanel &&
      activePanel !== "record" &&
      activePanel !== "setup" &&
      activePanel !== "themes" &&
      activePanel !== "ai" ? (
        <aside
          className="presentation-reference-panel"
          aria-label={`${activePanel} panel`}
        >
          <div className="presentation-reference-panel-header">
            <h2>
              {activePanel === "text"
                ? "Text"
                : activePanel === "elements"
                  ? "Add elements"
                  : activePanel === "charts"
                    ? "Add Charts"
                    : activePanel === "diagrams"
                      ? "Add Diagrams"
                      : "Media Embeds"}
            </h2>
            <button
              aria-label="Close panel"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <input
            aria-label="Search panel"
            className="presentation-reference-panel-search"
            placeholder="Search"
            value={panelSearch}
            onChange={(event) => setPanelSearch(event.target.value)}
          />
          {activePanel === "embeds" ? (
            <label>
              Insert uploaded image
              <select
                aria-label="Image from library"
                value={selectedImageId}
                onChange={(event) => {
                  setSelectedImageId(event.target.value);
                  const image = images.find(
                    (item) => item.id === event.target.value,
                  );
                  if (image) addReferenceBlock("IMG", image.assetReference);
                }}
              >
                <option value="">Choose an image…</option>
                {images.map((image) => (
                  <option key={image.id} value={image.id}>
                    {image.providerId} · {image.modelId}
                  </option>
                ))}
              </select>
              <a href={`/t/${tenantSlug}/p/presentation/images`}>
                Upload an image in Image Studio
              </a>
            </label>
          ) : null}
          <div className="presentation-reference-panel-grid">
            {panelCards(activePanel)
              .filter(([label]) =>
                label.toLowerCase().includes(panelSearch.toLowerCase()),
              )
              .map(([label, type, text]) => (
                <button
                  className="presentation-reference-card"
                  key={`${label}-${type}`}
                  onClick={() => addReferenceBlock(type, text)}
                  type="button"
                >
                  <span className="presentation-reference-card-preview">
                    {type === "CHART"
                      ? "◔"
                      : type === "DIAGRAM"
                        ? "⌁"
                        : type === "IMG"
                          ? "▧"
                          : type === "BULLETS"
                            ? "☷"
                            : "Aa"}
                  </span>
                  <strong>{label}</strong>
                </button>
              ))}
          </div>
        </aside>
      ) : null}
      {activePanel === "ai" ? (
        <aside
          className="presentation-reference-panel presentation-agent-panel"
          aria-label="AI tools"
        >
          <h2>Generate slide</h2>
          <textarea
            aria-label="Slide generation prompt"
            onChange={(event) => setSlidePrompt(event.target.value)}
            placeholder="Describe a slide to add to this presentation."
            rows={4}
            value={slidePrompt}
          />
          <button
            disabled={!slidePrompt.trim()}
            onClick={() => void generateSlide()}
            type="button"
          >
            Generate slide
          </button>
          <h2>Design partner</h2>
          <textarea
            aria-label="Agent instruction"
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="Ask the presentation agent to improve selected slides."
            rows={6}
            value={agentPrompt}
          />
          <button
            disabled={!selected || !agentPrompt.trim()}
            onClick={() => void runAgent()}
            type="button"
          >
            Run presentation agent
          </button>
          {agentJobId ? (
            <div className="studio-actions">
              <button onClick={() => void cancelAgent()} type="button">
                Cancel agent
              </button>
              <button onClick={() => void resumeAgent()} type="button">
                Resume with prompt
              </button>
            </div>
          ) : null}
          {agentOutput ? <pre aria-live="polite">{agentOutput}</pre> : null}
          {agentCandidate && selected ? (
            <button
              className="studio-primary-action"
              onClick={() => {
                updateSelectedSource(agentCandidate);
                setStatus(
                  "Staged agent result applied locally; save to publish.",
                );
                setAgentCandidate("");
              }}
              type="button"
            >
              Apply staged result
            </button>
          ) : null}
          <p>Changes are staged for approval before publication.</p>
        </aside>
      ) : null}
      {activePanel === "setup" ? (
        <aside className="presentation-reference-panel presentation-reference-settings">
          <div className="presentation-reference-panel-header">
            <h2>Page Setup</h2>
            <button
              aria-label="Close panel"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <label>
            Font size
            <select
              aria-label="Slide font size"
              value={String(document.settings["fontSize"] ?? "medium")}
              onChange={(event) =>
                void saveDocument({
                  ...document,
                  settings: {
                    ...document.settings,
                    fontSize: event.target.value,
                  },
                })
              }
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Text alignment
            <select
              aria-label="Slide text alignment"
              value={String(document.settings["textAlign"] ?? "left")}
              onChange={(event) =>
                void saveDocument({
                  ...document,
                  settings: {
                    ...document.settings,
                    textAlign: event.target.value,
                  },
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <p>Settings apply to every slide and are saved immediately.</p>
        </aside>
      ) : null}
      {activePanel === "themes" ? (
        <aside className="presentation-reference-panel presentation-reference-theme-panel">
          <div className="presentation-reference-panel-header">
            <h2>Theme</h2>
            <button
              aria-label="Close panel"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <a
            className="presentation-reference-new-theme"
            href={`/t/${tenantSlug}/p/presentation/themes`}
          >
            ＋ New Theme
          </a>
          {themes.length === 0 ? (
            <p>
              Create or import a theme to add it to this panel. The presentation
              keeps its selected preset.
            </p>
          ) : null}
          <div className="presentation-reference-theme-grid">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className="presentation-reference-theme-option"
                onClick={() =>
                  void saveDocument({
                    ...document,
                    themeId: theme.id,
                    settings: {
                      ...document.settings,
                      themeDefinition: theme.definition,
                    },
                  })
                }
                type="button"
              >
                <span
                  style={{
                    background: String(
                      theme.definition["background"] ?? "#24205a",
                    ),
                    color: String(theme.definition["text"] ?? "#f8fafc"),
                  }}
                >
                  Aa
                </span>
                <strong>{theme.name}</strong>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      {activePanel === "record" ? (
        <aside className="presentation-reference-panel presentation-reference-record-panel">
          <div className="presentation-reference-panel-header">
            <h2>Record</h2>
            <button
              aria-label="Close panel"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <p>Record your screen from Present mode.</p>
          <a
            className="presentation-reference-present"
            href={`/t/${tenantSlug}/p/presentation/present/${document.id}`}
          >
            Open presentation
          </a>
        </aside>
      ) : null}
      <footer className="presentation-reference-editor-footer">
        <span>{shareUrl ? shareUrl : status}</span>
        <div>
          <button
            onClick={() => setZoom((value) => Math.max(50, value - 10))}
            type="button"
          >
            −
          </button>
          <span>{zoom}%</span>
          <button
            onClick={() => setZoom((value) => Math.min(150, value + 10))}
            type="button"
          >
            ＋
          </button>
          <button aria-label="Help" type="button">
            ?
          </button>
        </div>
      </footer>
      {exportOpen ? (
        <div
          className="presentation-reference-modal-backdrop"
          role="presentation"
        >
          <section
            aria-label="Export presentation"
            className="presentation-reference-export-modal"
          >
            <button
              aria-label="Close export"
              onClick={() => setExportOpen(false)}
              type="button"
            >
              ×
            </button>
            <h2>Export presentation</h2>
            <p>Choose a format to download this presentation.</p>
            <button
              onClick={() => {
                setExportOpen(false);
                void exportDocument("pptx");
              }}
              type="button"
            >
              Export PPTX
            </button>
            <button
              onClick={() => {
                setExportOpen(false);
                void exportDocument("pdf");
              }}
              type="button"
            >
              Export PDF
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function ThemeLibrary({ tenantSlug }: ProductPageProps) {
  const [themes, setThemes] = useState<PresentationTheme[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [themeStatus, setThemeStatus] = useState("");
  useEffect(
    () =>
      load<PresentationTheme[]>(
        api(tenantSlug, "/themes"),
        setThemes,
        (reason) =>
          setThemeStatus(
            reason instanceof Error ? reason.message : "Unable to load themes.",
          ),
      ),
    [tenantSlug],
  );
  async function createTheme() {
    if (!name.trim()) return;
    setThemeStatus("Saving theme…");
    try {
      const theme = await fetch(api(tenantSlug, "/themes"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          definition: {
            background: "#f8fafc",
            text: "#111827",
            accent: "#4f46e5",
          },
        }),
      }).then(json<{ id: string }>);
      setThemes((current) => [
        ...current,
        {
          id: theme.id,
          name,
          description,
          builtIn: false,
          definition: {
            background: "#f8fafc",
            text: "#111827",
            accent: "#4f46e5",
          },
          favorite: false,
          liked: false,
        },
      ]);
      setName("");
      setDescription("");
      setThemeStatus("Theme saved.");
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Unable to save theme.",
      );
    }
  }
  async function setReaction(
    theme: PresentationTheme,
    reaction: "favorite" | "like",
  ) {
    const enabled = !(reaction === "favorite" ? theme.favorite : theme.liked);
    try {
      await fetch(api(tenantSlug, `/themes/${theme.id}/${reaction}`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(ok);
      setThemes((current) =>
        current.map((candidate) =>
          candidate.id === theme.id
            ? {
                ...candidate,
                ...(reaction === "favorite"
                  ? { favorite: enabled }
                  : { liked: enabled }),
              }
            : candidate,
        ),
      );
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Reaction failed.",
      );
    }
  }
  async function importTheme(file: File) {
    setThemeStatus("Importing PowerPoint theme…");
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const value = String(reader.result ?? "");
          resolve(value.includes(",") ? (value.split(",", 2)[1] ?? "") : value);
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read theme."));
        reader.readAsDataURL(file);
      });
      const imported = await fetch(api(tenantSlug, "/themes/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: file.name.replace(/\.pptx$/i, "") || "Imported theme",
          fileBase64,
          sourceImportId: `pptx:${file.name}:${file.size}:${file.lastModified}`,
        }),
      }).then(json<{ id: string; theme: PresentationTheme }>);
      setThemes((current) => [
        ...current,
        {
          ...imported.theme,
          id: imported.id,
          builtIn: false,
          favorite: false,
          liked: false,
        },
      ]);
      setThemeStatus("PowerPoint theme imported.");
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Theme import failed.",
      );
    }
  }
  return (
    <StudioPage
      description="Built-in and tenant-owned colors, typography, and layout systems."
      title="Themes"
    >
      <form
        className="studio-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void createTheme();
        }}
      >
        <h2>Create custom theme</h2>
        <label>
          Name
          <input
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          Description
          <input
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>
        <button className="studio-primary-action" type="submit">
          Save theme
        </button>
        <p aria-live="polite">{themeStatus}</p>
        <label>
          Import PowerPoint theme
          <input
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importTheme(file);
            }}
            type="file"
          />
        </label>
      </form>
      <div className="studio-card-grid">
        {themes.map((theme) => (
          <article className="studio-theme-card" key={theme.id}>
            <div
              className="studio-theme-preview"
              style={{
                background: String(theme.definition["background"] ?? "#f8fafc"),
                color: String(theme.definition["text"] ?? "#111827"),
              }}
            >
              <strong>Aa</strong>
            </div>
            <h2>{theme.name}</h2>
            <p>{theme.description}</p>
            <span>{theme.builtIn ? "Built in" : "Custom"}</span>
            <div className="studio-actions">
              <button
                onClick={() => void setReaction(theme, "favorite")}
                type="button"
              >
                {theme.favorite ? "★ Favorited" : "☆ Favorite"}
              </button>
              <button
                onClick={() => void setReaction(theme, "like")}
                type="button"
              >
                {theme.liked ? "♥ Liked" : "♡ Like"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </StudioPage>
  );
}

export function ImageStudio({ tenantSlug }: ProductPageProps) {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState("");
  useEffect(
    () =>
      load<GeneratedImage[]>(api(tenantSlug, "/images"), setImages, (reason) =>
        setStatus(
          reason instanceof Error ? reason.message : "Unable to load images.",
        ),
      ),
    [tenantSlug],
  );
  async function generate() {
    setStatus("Generating…");
    try {
      await fetch(api(tenantSlug, "/images/generate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          profileId: "image-balanced",
          aspectRatio,
          ...(modelId.trim() ? { modelId: modelId.trim() } : {}),
        }),
      }).then(json);
      const refreshed = await fetch(api(tenantSlug, "/images")).then(
        json<GeneratedImage[]>,
      );
      setImages(refreshed);
      setStatus("Image generated and persisted.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Generation failed.",
      );
    }
  }
  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file.");
      return;
    }
    setStatus("Saving image…");
    try {
      const assetReference = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Unable to read image."));
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read image."));
        reader.readAsDataURL(file);
      });
      await fetch(api(tenantSlug, "/images"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetReference, mimeType: file.type }),
      }).then(json<{ id: string }>);
      setImages(
        await fetch(api(tenantSlug, "/images")).then(json<GeneratedImage[]>),
      );
      setStatus("Image uploaded.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Upload failed.");
    }
  }
  return (
    <StudioPage
      description="Generate reusable visual assets through tenant-approved image profiles."
      title="Image Studio"
    >
      <div className="studio-create-layout">
        <section className="studio-panel">
          <label>
            Describe the image
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              rows={6}
              value={prompt}
            />
          </label>
          <label>
            Aspect ratio
            <select
              onChange={(event) => setAspectRatio(event.target.value)}
              value={aspectRatio}
            >
              <option value="16:9">16:9 landscape</option>
              <option value="1:1">1:1 square</option>
              <option value="9:16">9:16 portrait</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label>
            Provider model (optional)
            <input
              onChange={(event) => setModelId(event.target.value)}
              placeholder="Use configured default"
              value={modelId}
            />
          </label>
          <button
            className="studio-primary-action"
            disabled={!prompt.trim()}
            onClick={() => void generate()}
            type="button"
          >
            Generate
          </button>
          <label>
            Upload image
            <input
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              type="file"
            />
          </label>
          <p aria-live="polite">{status}</p>
        </section>
        <div className="studio-image-grid">
          {images.map((image) => (
            <figure key={image.id}>
              <img alt="" src={image.assetReference} />
              <figcaption>
                {image.providerId} · {image.modelId}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </StudioPage>
  );
}

export function PresentationMode({
  tenantSlug,
  pathSegments,
}: ProductPageProps) {
  const id = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [recordings, setRecordings] = useState<PresentationRecording[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  useEffect(() => {
    if (!id) return;
    const stopDocument = load<PresentationDocument>(
      api(tenantSlug, `/documents/${id}`),
      setDocument,
      (reason) =>
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "Unable to load presentation.",
        ),
    );
    const stopRecordings = load<PresentationRecording[]>(
      api(tenantSlug, `/documents/${id}/recordings`),
      setRecordings,
    );
    return () => {
      stopDocument();
      stopRecordings();
    };
  }, [id, tenantSlug]);
  const slide = document?.slides[index];
  async function startRecording() {
    if (!document || !navigator.mediaDevices?.getDisplayMedia) {
      setRecordingStatus("Screen recording is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const nextRecorder = new MediaRecorder(stream);
      recordingChunks.current = [];
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunks.current.push(event.data);
      };
      nextRecorder.onstop = () => {
        void (async () => {
          const blob = new Blob(recordingChunks.current, {
            type: nextRecorder.mimeType || "video/webm",
          });
          const assetReference = await new Promise<string>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                typeof reader.result === "string"
                  ? resolve(reader.result)
                  : reject(new Error("Unable to read recording."));
              reader.onerror = () =>
                reject(reader.error ?? new Error("Unable to read recording."));
              reader.readAsDataURL(blob);
            },
          );
          const saved = await fetch(
            api(tenantSlug, `/documents/${document.id}/recordings`),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                assetReference,
                metadata: { mimeType: blob.type, size: blob.size },
              }),
            },
          ).then(json<{ id: string }>);
          setRecordings((current) => [
            {
              id: saved.id,
              assetReference,
              metadata: { mimeType: blob.type, size: blob.size },
              createdAt: new Date().toISOString(),
            },
            ...current,
          ]);
          setRecordingStatus("Recording saved.");
        })().catch((reason: unknown) =>
          setRecordingStatus(
            reason instanceof Error ? reason.message : "Recording failed.",
          ),
        );
        for (const track of stream.getTracks()) track.stop();
        setRecording(false);
      };
      recorder.current = nextRecorder;
      nextRecorder.start();
      setRecording(true);
      setRecordingStatus("Recording…");
    } catch (reason) {
      setRecordingStatus(
        reason instanceof Error ? reason.message : "Recording was cancelled.",
      );
    }
  }
  function stopRecording() {
    recorder.current?.stop();
  }
  return (
    <section className="presentation-mode" aria-label="Presentation mode">
      <div className="presentation-mode-slide">
        {loadError ? (
          <p role="alert">{loadError}</p>
        ) : slide ? (
          <SlideBlockView
            source={slide.sourceXml}
            appearance={slideAppearance(document?.settings ?? {})}
          />
        ) : (
          <p>Loading presentation…</p>
        )}
      </div>
      <nav>
        <button
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
          type="button"
        >
          Previous
        </button>
        <span>
          {index + 1} / {document?.slides.length ?? 0}
        </span>
        <button
          disabled={!document || index >= document.slides.length - 1}
          onClick={() => setIndex((value) => value + 1)}
          type="button"
        >
          Next
        </button>
        {/* Only a loaded document can be recorded. */}
        {document ? (
          <>
            <button
              onClick={() =>
                recording ? stopRecording() : void startRecording()
              }
              type="button"
            >
              {recording ? "Stop recording" : "Record"}
            </button>
            <span aria-live="polite">{recordingStatus}</span>
          </>
        ) : null}
      </nav>
      {recordings.length > 0 ? (
        <aside className="presentation-recordings">
          <h2>Recordings</h2>
          {recordings.map((recording) => (
            <video
              controls
              key={recording.id}
              preload="metadata"
              src={recording.assetReference}
            />
          ))}
        </aside>
      ) : null}
    </section>
  );
}

export function SharedPresentation(props: ProductPageProps) {
  const { tenantSlug, pathSegments } = props;
  const token = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!token) return;
    return load<PresentationDocument>(
      `/api/presentation/v1/shared/${token}`,
      setDocument,
      (reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load presentation.",
        ),
    );
  }, [token]);
  const slide = document?.slides[index];
  return (
    <section className="presentation-mode" aria-label="Shared presentation">
      <h1>{document?.title ?? "Loading presentation…"}</h1>
      <div className="presentation-mode-slide">
        {error ? (
          <p role="alert">{error}</p>
        ) : slide ? (
          <SlideBlockView
            source={slide.sourceXml}
            appearance={slideAppearance(document?.settings ?? {})}
          />
        ) : (
          <p>Loading presentation…</p>
        )}
      </div>
      <nav>
        <button
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
          type="button"
        >
          Previous
        </button>
        <span>
          {index + 1} / {document?.slides.length ?? 0}
        </span>
        <button
          disabled={!document || index >= document.slides.length - 1}
          onClick={() => setIndex((value) => value + 1)}
          type="button"
        >
          Next
        </button>
      </nav>
    </section>
  );
}
