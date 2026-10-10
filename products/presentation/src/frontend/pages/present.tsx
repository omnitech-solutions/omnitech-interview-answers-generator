"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";

import { slideAppearance } from "../../domain/appearance";

import { SlideBlockView } from "../slide-blocks";

import { usePresentMode } from "./use-present-mode";

export function PresentationMode(props: ProductPageProps) {
  const {
    id,
    document,
    loadError,
    index,
    setIndex,
    recording,
    recordingStatus,
    recordings,
    slide,
    startRecording,
    stopRecording,
  } = usePresentMode(props);
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
            // biome-ignore lint/a11y/useMediaCaption: the person's own recording, played back to them: no caption track exists for it
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
