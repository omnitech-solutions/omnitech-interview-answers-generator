"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import type React from "react";

import { ReferenceHeader } from "../shell";
import { referenceTextOptions, referenceThemes } from "./create-config";
import { usePresentationCreate } from "./use-presentation-create";

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

export function PresentationCreate(props: ProductPageProps) {
  const { tenantSlug, products } = props;
  const {
    title,
    setTitle,
    topic,
    setTopic,
    outline,
    setOutline,
    status,
    textContent,
    setTextContent,
    tone,
    setTone,
    audience,
    setAudience,
    scenario,
    setScenario,
    theme,
    setTheme,
    slideCount,
    setSlideCount,
    layout,
    setLayout,
    language,
    setLanguage,
    targets,
    targetId,
    create,
    generateOutline,
    selectAiProfile,
  } = usePresentationCreate(props);
  return (
    <section className="presentation-reference-app presentation-reference-create">
      <ReferenceHeader
        products={products}
        title={title || "New presentation"}
      />
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
              onChange={(event) => selectAiProfile(event.target.value)}
              value={targetId}
            >
              {targets.length === 0 ? (
                <option value="">AI unavailable</option>
              ) : (
                targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.model ?? target.id}
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
                    // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
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
                // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
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
