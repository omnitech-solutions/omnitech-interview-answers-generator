"use client";

import type { DocumentField } from "@omnitech/interview-contracts";
import { Icon } from "../icon";
import { DocumentPreview, type PreviewPayload } from "./document-preview";
import { Spinner } from "./documents-ui";

export type WritingBatch = {
  id: string;
  title: string;
  count: number;
  done: boolean;
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// Up to this many sections are written at once; the rest wait their turn.
const WRITING_AT_ONCE = 4;

/**
 * A document being written: the sections on one side, ticking off as each is
 * done, and the document itself on the other, filling in as they land.
 */
export function WritingView({
  title,
  model,
  batches,
  fields,
  preview,
  seconds,
  finished,
}: {
  title: string;
  model: string;
  batches: readonly WritingBatch[] | null;
  fields: readonly DocumentField[];
  preview: PreviewPayload | null;
  seconds: number;
  finished: boolean;
}) {
  const done = batches?.filter((batch) => batch.done).length ?? 0;
  const total = batches?.length ?? 0;
  // The first not-yet-done sections are the ones being written right now.
  const writingNow = new Set(
    (batches ?? [])
      .filter((batch) => !batch.done)
      .slice(0, WRITING_AT_ONCE)
      .map((batch) => batch.id),
  );
  const percent = finished ? 100 : total ? Math.round((done / total) * 100) : 4;
  return (
    <div className="dx-writing">
      <aside className="dx-writing-side" aria-label="Progress">
        <div className="dx-writing-head">
          <span className="dx-writing-mark">
            {finished ? (
              <Icon name="check_circle" size={20} />
            ) : (
              <Icon name="auto_awesome" size={20} />
            )}
          </span>
          <div className="dx-grow">
            <div className="dx-row-title">
              {finished ? "Done. Opening it…" : "Writing your document"}
            </div>
            <div className="dx-sub dx-ellipsis">{title}</div>
          </div>
        </div>
        <div
          className="dx-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Sections written"
        >
          <div className="dx-meter-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="dx-writing-meta">
          <span>
            {total
              ? `${done} of ${total} sections`
              : "Reading your experience…"}
          </span>
          <span className="dx-mono">{clock(seconds)}</span>
        </div>
        <ol className="dx-steps">
          {(batches ?? []).map((batch) => (
            <li
              key={batch.id}
              className="dx-step-line"
              data-state={
                batch.done
                  ? "done"
                  : writingNow.has(batch.id)
                    ? "writing"
                    : "waiting"
              }
            >
              <span className="dx-step-icon">
                {batch.done ? (
                  <Icon name="check_circle" size={18} />
                ) : writingNow.has(batch.id) ? (
                  <Spinner />
                ) : (
                  <Icon name="radio_button_unchecked" size={18} />
                )}
              </span>
              <span className="dx-grow dx-ellipsis">{batch.title}</span>
              <span className="dx-mono dx-faint">{batch.count}</span>
            </li>
          ))}
        </ol>
        <p className="dx-sub dx-writing-note">
          {model} writes the sections side by side. Everything is editable once
          it’s done, and each change is kept as a revision.
        </p>
      </aside>
      <div className="dx-writing-canvas">
        <DocumentPreview
          preview={preview}
          fields={fields}
          selected={null}
          onSelect={() => undefined}
          writing={!finished}
        />
      </div>
    </div>
  );
}
