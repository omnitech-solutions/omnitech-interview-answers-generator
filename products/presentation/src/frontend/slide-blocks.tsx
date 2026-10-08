"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { SlideBlock, SlideBlockType } from "../domain/slide-blocks";
import { parseSlideBlocks, serializeSlideBlocks } from "../domain/slide-blocks";

export type { SlideBlock, SlideBlockType } from "../domain/slide-blocks";
export {
  parseSlideBlocks,
  serializeSlideBlocks,
} from "../domain/slide-blocks";

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**"))
          // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
          return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
          // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
          return <em key={`${part}-${index}`}>{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`"))
          // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
          return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
        // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
        return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
      })}
    </>
  );
}

function RichTextArea({
  value,
  rows,
  onChange,
}: {
  value: string;
  rows: number;
  onChange(value: string): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function wrap(prefix: string, suffix = prefix) {
    const textarea = ref.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const content = selected.includes(prefix)
      ? selected.replaceAll(prefix, "").replaceAll(suffix, "")
      : selected;
    const next = `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }
  return (
    <div className="studio-rich-text">
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass */}
      <div
        className="studio-rich-text-toolbar"
        aria-label="Rich text formatting"
      >
        <button onClick={() => wrap("**")} type="button">
          Bold
        </button>
        <button onClick={() => wrap("*")} type="button">
          Italic
        </button>
        <button onClick={() => wrap("`")} type="button">
          Code
        </button>
      </div>
      <textarea
        aria-label="Rich text content"
        onChange={(event) => onChange(event.target.value)}
        ref={ref}
        rows={rows}
        value={value}
      />
    </div>
  );
}

export function SlideBlockEditor({
  source,
  onChange,
}: {
  source: string;
  onChange(source: string): void;
}) {
  const initial = useMemo(() => parseSlideBlocks(source), [source]);
  const [blocks, setBlocks] = useState<SlideBlock[]>(initial);
  useEffect(() => setBlocks(initial), [initial]);
  function update(index: number, patch: Partial<SlideBlock>) {
    const next = blocks.map((block, blockIndex) =>
      blockIndex === index ? { ...block, ...patch } : block,
    );
    setBlocks(next);
    onChange(serializeSlideBlocks(source, next));
  }
  function addBlock() {
    const next = [...blocks, { type: "P" as const, text: "New paragraph" }];
    setBlocks(next);
    onChange(serializeSlideBlocks(source, next));
  }
  function removeBlock(index: number) {
    const next = blocks.filter((_, blockIndex) => blockIndex !== index);
    setBlocks(next);
    onChange(serializeSlideBlocks(source, next));
  }
  return (
    <div className="studio-block-editor">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
        <div className="studio-block-row" key={`${index}-${block.type}`}>
          <select
            aria-label={`Block ${index + 1} type`}
            onChange={(event) =>
              update(index, { type: event.target.value as SlideBlockType })
            }
            value={block.type}
          >
            <option value="TITLE">Title</option>
            <option value="H1">Heading 1</option>
            <option value="H2">Heading 2</option>
            <option value="H3">Heading 3</option>
            <option value="P">Paragraph</option>
            <option value="QUOTE">Quote</option>
            <option value="CODE">Code</option>
            <option value="BULLETS">Bullets</option>
            <option value="COLUMNS">Columns</option>
            <option value="CHART">Chart data</option>
            <option value="DIAGRAM">Diagram data</option>
            <option value="INFOGRAPHIC">Infographic</option>
            <option value="IMG">Image</option>
          </select>
          <RichTextArea
            onChange={(text) => update(index, { text })}
            rows={block.type === "CODE" ? 5 : 2}
            value={block.text}
          />
          <button onClick={() => removeBlock(index)} type="button">
            Remove
          </button>
        </div>
      ))}
      <button onClick={addBlock} type="button">
        Add content block
      </button>
    </div>
  );
}

export function SlideBlockView({
  source,
  appearance,
}: {
  source: string;
  appearance?: {
    background: string;
    text: string;
    fontSize?: number;
    textAlign?: "left" | "center" | "right";
  };
}) {
  function visual(block: SlideBlock) {
    let data: unknown;
    try {
      data = JSON.parse(block.text);
    } catch {
      data = undefined;
    }
    if (block.type === "CHART" && data && typeof data === "object") {
      const chart = data as { labels?: unknown; values?: unknown };
      const labels = Array.isArray(chart.labels)
        ? chart.labels.map(String)
        : [];
      const values = Array.isArray(chart.values)
        ? chart.values.map((value) => Number(value) || 0)
        : [];
      const maximum = Math.max(1, ...values);
      return (
        <div className="studio-chart-block">
          <svg aria-label="Chart" role="img" viewBox="0 0 640 260">
            {values.map((value, index) => {
              const height = (value / maximum) * 180;
              return (
                <g key={`${labels[index] ?? index}-${value}`}>
                  <rect
                    fill="currentColor"
                    height={height}
                    width="48"
                    x={32 + index * 80}
                    y={210 - height}
                  />
                  <text x={32 + index * 80} y="235">
                    {labels[index] ?? index + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      );
    }
    if (block.type === "DIAGRAM" && data && typeof data === "object") {
      const diagram = data as { nodes?: unknown; edges?: unknown };
      const nodes = Array.isArray(diagram.nodes)
        ? diagram.nodes.map(String)
        : [];
      return (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass
        <div className="studio-diagram-block" aria-label="Diagram">
          {nodes.map((node, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
            <React.Fragment key={`${node}-${index}`}>
              <span>{node}</span>
              {index < nodes.length - 1 ? <b aria-hidden="true">→</b> : null}
            </React.Fragment>
          ))}
        </div>
      );
    }
    if (block.type === "INFOGRAPHIC" && data && typeof data === "object") {
      return (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass
        <div className="studio-infographic-block" aria-label="Infographic">
          {Object.entries(data as Record<string, unknown>).map(
            ([key, value]) => (
              <div key={key}>
                <strong>{key}</strong>
                <span>{String(value)}</span>
              </div>
            ),
          )}
        </div>
      );
    }
    return (
      <aside className="studio-visual-block">
        <strong>{block.type}</strong>
        <pre>{block.text}</pre>
      </aside>
    );
  }
  return (
    <div
      className="studio-slide-block-view"
      style={
        appearance
          ? ({
              background: appearance.background,
              color: appearance.text,
              textAlign: appearance.textAlign,
              "--slide-font-size": `${appearance.fontSize ?? 26}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {parseSlideBlocks(source).map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "TITLE")
          return (
            <h1 key={key}>
              <InlineText text={block.text} />
            </h1>
          );
        if (block.type === "H1")
          return (
            <h2 key={key}>
              <InlineText text={block.text} />
            </h2>
          );
        if (block.type === "H2" || block.type === "H3") {
          return (
            <h3 key={key}>
              <InlineText text={block.text} />
            </h3>
          );
        }
        if (block.type === "QUOTE")
          return (
            <blockquote key={key}>
              <InlineText text={block.text} />
            </blockquote>
          );
        if (block.type === "CODE") return <pre key={key}>{block.text}</pre>;
        if (block.type === "BULLETS") {
          return (
            <ul key={key}>
              {block.text
                .split(/\n|;\s*/)
                .filter(Boolean)
                .map((item) => (
                  <li key={item}>{item}</li>
                ))}
            </ul>
          );
        }
        if (block.type === "IMG") {
          return <img alt="" key={key} src={block.text} />;
        }
        if (
          block.type === "CHART" ||
          block.type === "DIAGRAM" ||
          block.type === "INFOGRAPHIC"
        )
          return <React.Fragment key={key}>{visual(block)}</React.Fragment>;
        if (block.type === "COLUMNS") {
          return (
            <div className="studio-columns-block" key={key}>
              {block.text}
            </div>
          );
        }
        return (
          <p key={key}>
            <InlineText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
