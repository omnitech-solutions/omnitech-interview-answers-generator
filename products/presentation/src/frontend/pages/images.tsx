"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";

import { StudioPage } from "../shell";
import { useImageStudio } from "./use-image-studio";

export function ImageStudio(props: ProductPageProps) {
  const {
    images,
    prompt,
    setPrompt,
    aspectRatio,
    setAspectRatio,
    modelId,
    setModelId,
    status,
    generate,
    upload,
  } = useImageStudio(props);
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
