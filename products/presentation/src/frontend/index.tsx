"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import React, { useEffect, useMemo, useState } from "react";
import type {
  GeneratedImage,
  PresentationDocument,
  PresentationSummary,
  PresentationTheme,
  Slide,
} from "../domain/index.js";

function api(tenantSlug: string, path: string) {
  return `/api/presentation/v1${path}?tenant=${encodeURIComponent(tenantSlug)}`;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
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

export function PresentationLibrary({ tenantSlug }: ProductPageProps) {
  const [items, setItems] = useState<PresentationSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(api(tenantSlug, "/documents"))
      .then(json<PresentationSummary[]>)
      .then(setItems)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Unable to load."),
      );
  }, [tenantSlug]);
  return (
    <StudioPage
      actions={
        <a
          className="studio-primary-action"
          href={`/t/${tenantSlug}/p/presentation/create`}
        >
          New presentation
        </a>
      }
      description="Create, organize, present, and share visual documents."
      title="Presentations"
    >
      {error ? <p role="alert">{error}</p> : null}
      <div className="studio-card-grid">
        {items.map((item) => (
          <a
            className="studio-document-card"
            href={`/t/${tenantSlug}/p/presentation/editor/${item.id}`}
            key={item.id}
          >
            <div className="studio-document-preview" aria-hidden="true">
              <span>{item.slideCount || 1}</span>
            </div>
            <strong>{item.title}</strong>
            <span>
              {item.slideCount} slides · revision {item.revision}
            </span>
          </a>
        ))}
        {items.length === 0 && !error ? (
          <div className="studio-empty-state">
            <h2>Create your first presentation</h2>
            <p>Start blank or generate an editable outline with AI.</p>
          </div>
        ) : null}
      </div>
    </StudioPage>
  );
}

export function PresentationCreate({ tenantSlug }: ProductPageProps) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  async function create() {
    setStatus("Creating…");
    try {
      const result = await fetch(api(tenantSlug, "/documents"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title || topic || "Untitled presentation",
          outline,
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
          profileId: "document-fast",
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
    <StudioPage
      description="Start blank or shape an AI-assisted outline before generating slides."
      title="Create presentation"
    >
      <div className="studio-create-layout">
        <form
          className="studio-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            Presentation title
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Quarterly product strategy"
              value={title}
            />
          </label>
          <label>
            Topic or brief
            <textarea
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Describe the audience, goal, tone, and key facts."
              rows={7}
              value={topic}
            />
          </label>
          <div className="studio-actions">
            <button
              disabled={!topic.trim()}
              onClick={() => void generateOutline()}
              type="button"
            >
              Generate outline
            </button>
            <button className="studio-primary-action" type="submit">
              Continue
            </button>
          </div>
          <p aria-live="polite">{status}</p>
        </form>
        <section className="studio-panel">
          <h2>Outline</h2>
          {outline.map((item, index) => (
            <label key={`${index}-${item}`}>
              Slide {index + 1}
              <input
                onChange={(event) =>
                  setOutline((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index ? event.target.value : value,
                    ),
                  )
                }
                value={item}
              />
            </label>
          ))}
          {outline.length === 0 ? (
            <p>Your editable outline will appear here.</p>
          ) : null}
        </section>
      </div>
    </StudioPage>
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
  const selected = useMemo(
    () => document?.slides.find((slide) => slide.id === selectedId),
    [document, selectedId],
  );
  useEffect(() => {
    if (!id) return;
    void fetch(api(tenantSlug, `/documents/${id}`))
      .then(json<PresentationDocument>)
      .then((value) => {
        setDocument(value);
        setSelectedId(value.slides[0]?.id ?? "");
      })
      .catch((reason: unknown) =>
        setStatus(reason instanceof Error ? reason.message : "Unable to load."),
      );
  }, [id, tenantSlug]);
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
      ).then(json<{ id: string }>);
      setDocument({
        ...document,
        slides: document.slides.map((item) =>
          item.id === slide.id ? { ...slide, id: response.id } : item,
        ),
      });
      setStatus("Saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
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
    <section className="presentation-editor">
      <header className="presentation-editor-toolbar">
        <input
          aria-label="Presentation title"
          onBlur={() => void saveDocument(document)}
          onChange={(event) =>
            setDocument({ ...document, title: event.target.value })
          }
          value={document.title}
        />
        <span aria-live="polite">{status}</span>
        <a href={`/t/${tenantSlug}/p/presentation/present/${document.id}`}>
          Present
        </a>
        <button type="button">Share</button>
        <button type="button">Export PPTX</button>
      </header>
      <aside className="presentation-slide-list" aria-label="Slides">
        {document.slides.map((slide) => (
          <button
            aria-current={slide.id === selectedId ? "true" : undefined}
            key={slide.id}
            onClick={() => setSelectedId(slide.id)}
            type="button"
          >
            <span>{slide.position + 1}</span>
            <small>{slide.sourceXml.slice(0, 70)}</small>
          </button>
        ))}
        <button
          onClick={() => {
            const slide = defaultSlide(document.slides.length);
            setDocument({
              ...document,
              slides: [...document.slides, slide],
            });
            setSelectedId(slide.id);
          }}
          type="button"
        >
          Add slide
        </button>
      </aside>
      <main className="presentation-canvas">
        {selected ? (
          <>
            <div className="presentation-slide">
              <h2>Editable slide source</h2>
              <textarea
                aria-label="Slide source"
                onChange={(event) =>
                  setDocument({
                    ...document,
                    slides: document.slides.map((slide) =>
                      slide.id === selected.id
                        ? { ...slide, sourceXml: event.target.value }
                        : slide,
                    ),
                  })
                }
                value={selected.sourceXml}
              />
            </div>
            <button
              className="studio-primary-action"
              onClick={() => void saveSlide(selected)}
              type="button"
            >
              Save slide
            </button>
          </>
        ) : (
          <p>Add a slide to begin.</p>
        )}
      </main>
      <aside className="presentation-agent-panel">
        <h2>Design partner</h2>
        <textarea
          aria-label="Agent instruction"
          placeholder="Ask the presentation agent to improve selected slides."
          rows={6}
        />
        <button type="button">Run with selected profile</button>
        <p>Changes are staged for approval before publication.</p>
      </aside>
    </section>
  );
}

export function ThemeLibrary({ tenantSlug }: ProductPageProps) {
  const [themes, setThemes] = useState<PresentationTheme[]>([]);
  useEffect(() => {
    void fetch(api(tenantSlug, "/themes"))
      .then(json<PresentationTheme[]>)
      .then(setThemes);
  }, [tenantSlug]);
  return (
    <StudioPage
      description="Built-in and tenant-owned colors, typography, and layout systems."
      title="Themes"
    >
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
          </article>
        ))}
      </div>
    </StudioPage>
  );
}

export function ImageStudio({ tenantSlug }: ProductPageProps) {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    void fetch(api(tenantSlug, "/images"))
      .then(json<GeneratedImage[]>)
      .then(setImages);
  }, [tenantSlug]);
  async function generate() {
    setStatus("Generating…");
    try {
      await fetch(api(tenantSlug, "/images/generate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, profileId: "image-balanced" }),
      }).then(json);
      setStatus("Image generated and persisted.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Generation failed.",
      );
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
          <button
            className="studio-primary-action"
            disabled={!prompt.trim()}
            onClick={() => void generate()}
            type="button"
          >
            Generate
          </button>
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
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!id) return;
    void fetch(api(tenantSlug, `/documents/${id}`))
      .then(json<PresentationDocument>)
      .then(setDocument);
  }, [id, tenantSlug]);
  const slide = document?.slides[index];
  return (
    <section className="presentation-mode" aria-label="Presentation mode">
      <div className="presentation-mode-slide">
        <pre>{slide?.sourceXml ?? "Loading presentation…"}</pre>
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

export function SharedPresentation(props: ProductPageProps) {
  return <PresentationMode {...props} />;
}
