"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";

import { slideAppearance } from "../../domain/appearance";

import { SlideBlockView } from "../slide-blocks";

import { useSharedPresentation } from "./use-shared-presentation";

export function SharedPresentation(props: ProductPageProps) {
  const { document, error, index, setIndex, slide } =
    useSharedPresentation(props);
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
