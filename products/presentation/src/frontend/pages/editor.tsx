"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import React from "react";
import { slideAppearance } from "../../domain/appearance";
import { ProductLinks, StudioPage } from "../shell";
import { SlideBlockView } from "../slide-blocks";
import { EditorProperties } from "./editor-properties";
import { usePresentationEditor } from "./use-presentation-editor";

export function PresentationEditor(props: ProductPageProps) {
  const { tenantSlug, products } = props;
  const {
    id,
    document,
    selectedId,
    setSelectedId,
    status,
    agentPrompt,
    setAgentPrompt,
    slidePrompt,
    setSlidePrompt,
    agentOutput,
    agentCandidate,
    agentJobId,
    shareUrl,
    shareId,
    images,
    selectedImageId,
    themes,
    activePanel,
    setActivePanel,
    menuOpen,
    setMenuOpen,
    panelSearch,
    setPanelSearch,
    exportOpen,
    setExportOpen,
    zoom,
    undoSources,
    redoSources,
    selected,
    saveDocument,
    saveSlide,
    deleteSlide,
    moveSlide,
    runAgent,
    generateSlide,
    cancelAgent,
    resumeAgent,
    createShare,
    revokeShare,
    updateSelectedSource,
    restoreSource,
    addReferenceBlock,
    panelCards,
    duplicatePresentation,
    renameDocument,
    openCreate,
    focusTitle,
    openSetup,
    openThemes,
    openLibrary,
    addSlide,
    selectImage,
    applyAgentCandidate,
    saveFontSize,
    saveTextAlign,
    selectTheme,
    zoomOut,
    zoomIn,
    exportPptx,
    exportPdf,
  } = usePresentationEditor(props);
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
        <ProductLinks products={products} />
        <input
          aria-label="Presentation title"
          className="presentation-reference-editor-title"
          onBlur={() => void saveDocument(document)}
          onChange={(event) => renameDocument(event.target.value)}
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
          <button onClick={openCreate} type="button">
            ＋ New Presentation
          </button>
          <button onClick={focusTitle} type="button">
            ✎ Rename
          </button>
          <button onClick={() => void createShare()} type="button">
            Share presentation
          </button>
          <button onClick={() => void duplicatePresentation()} type="button">
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
          <button onClick={openSetup} type="button">
            ⚙ Page Setup
          </button>
          <button onClick={openThemes} type="button">
            ◈ Theme Panel
          </button>
          <p>VIEW</p>
          <button onClick={openCreate} type="button">
            ← Back to prompt
          </button>
          <button onClick={openLibrary} type="button">
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
          onClick={addSlide}
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
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer selection of a slide card; a key handler would add behaviour, so it waits for an accessibility pass */}
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
              <EditorProperties
                selected={selected}
                canDelete={document.slides.length > 1}
                onChange={updateSelectedSource}
                onSave={saveSlide}
                onDelete={deleteSlide}
              />
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
                onChange={(event) => selectImage(event.target.value)}
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
              onClick={applyAgentCandidate}
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
              onChange={(event) => saveFontSize(event.target.value)}
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
              onChange={(event) => saveTextAlign(event.target.value)}
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
                onClick={() => selectTheme(theme)}
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
          <button onClick={zoomOut} type="button">
            −
          </button>
          <span>{zoom}%</span>
          <button onClick={zoomIn} type="button">
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
            <button onClick={exportPptx} type="button">
              Export PPTX
            </button>
            <button onClick={exportPdf} type="button">
              Export PDF
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
