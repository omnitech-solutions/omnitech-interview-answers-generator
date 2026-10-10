"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";

import { ReferenceHeader } from "../shell";
import { usePresentationLibrary } from "./use-presentation-library";

export function PresentationLibrary(props: ProductPageProps) {
  const { tenantSlug, products } = props;
  const {
    items,
    error,
    prompt,
    setPrompt,
    tab,
    setTab,
    search,
    setSearch,
    listView,
    setListView,
    sortByTitle,
    setSortByTitle,
    slideCount,
    setSlideCount,
    layout,
    setLayout,
    language,
    setLanguage,
    targets,
    targetId,
    visibleItems,
    openCreate,
    toggleFavorite,
    selectAiProfile,
  } = usePresentationLibrary(props);
  return (
    <section className="presentation-reference-app">
      <ReferenceHeader products={products} />
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
                onClick={() => void toggleFavorite(item)}
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
