"use client";

import type { Slide } from "../../domain/index";
import { SlideBlockEditor } from "../slide-blocks";

export function EditorProperties({
  selected,
  canDelete,
  onChange,
  onSave,
  onDelete,
}: {
  selected: Slide;
  canDelete: boolean;
  onChange: (source: string) => void;
  onSave: (slide: Slide) => Promise<void>;
  onDelete: (slide: Slide) => Promise<void>;
}) {
  return (
    <section className="presentation-reference-editor-form">
      <SlideBlockEditor
        key={selected.id}
        onChange={onChange}
        source={selected.sourceXml}
      />
      <div className="presentation-reference-form-actions">
        <button
          className="studio-primary-action"
          onClick={() => void onSave(selected)}
          type="button"
        >
          Save slide
        </button>
        <button
          disabled={!canDelete}
          onClick={() => void onDelete(selected)}
          type="button"
        >
          Delete slide
        </button>
      </div>
    </section>
  );
}
