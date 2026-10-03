"use client";

import type { DocumentField } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";

export type PreviewPayload =
  | { kind: "docx"; docx: string }
  | { kind: "html"; html: string };

// The frame holds a document the member uploaded, so it is inert: no scripts
// (the sandbox omits allow-scripts) and no network (the policy). The parent
// renders into it, which is why it needs the same origin.
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
const FRAME = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><body>`;
const STYLE = `
  html, body { margin: 0; }
  .docx-wrapper { background: transparent !important; padding: 16px 0 !important; }
  .docx-wrapper > section.docx { box-shadow: 0 2px 4px rgba(15,23,42,.06), 0 18px 48px rgba(15,23,42,.18) !important; border-radius: 3px; margin-bottom: 20px !important; }
  /* docx-preview gives every span the document's default font, which would
     reset the run a value sits in; a field takes its run's look. */
  .doc-field { font: inherit !important; color: inherit; letter-spacing: inherit; text-transform: inherit; font-variant: inherit; cursor: pointer; border-radius: 3px; transition: background .2s, box-shadow .2s; }
  .doc-field:hover { background: #eef3fd; }
  .doc-field[data-selected] { background: #e3ecfd; box-shadow: 0 0 0 2px #2f6fdb; }
  .doc-field.doc-missing { background: #fff3d6 !important; color: #8a5a00 !important; box-shadow: inset 0 0 0 1px #e3b341; font-family: system-ui, sans-serif !important; font-size: .85em !important; padding: 0 4px; }
  .doc-empty:not(.doc-missing):not(.doc-pending) { display: none; }
  /* Being written: a gap shimmers, and a value lands with a soft flash. */
  .doc-field.doc-pending { color: transparent !important; background: linear-gradient(90deg, #e6eaf2 25%, #f3f5f9 50%, #e6eaf2 75%) !important; background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 4px; box-shadow: none !important; cursor: default; }
  .doc-field.doc-fresh { animation: freshen 2s ease-out; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @keyframes freshen { from { background: #cdeed7; box-shadow: 0 0 0 3px #cdeed7; } to { background: transparent; box-shadow: 0 0 0 0 transparent; } }
`;
// Word draws bullets as private-use characters in Symbol or Wingdings, which
// a browser has no font for. These are what they stand for.
const BULLETS: Record<string, string> = {
  "\uf0b7": "\u2022",
  "\uf0a7": "\u25aa",
  "\uf0d8": "\u27a2",
  "\uf0fc": "\u2713",
  "\uf076": "\u2756",
};
function drawBullets(styles: HTMLElement) {
  for (const style of styles.querySelectorAll("style"))
    style.textContent = (style.textContent ?? "").replace(
      /([^{}]*:before\s*\{)([^}]*)\}/g,
      (rule, head: string, body: string) =>
        /content:\s*"[\uf000-\uf0ff]/.test(body)
          ? `${head}${body
              .replace(
                /content:\s*"([\uf000-\uf0ff])/,
                (_m, glyph: string) =>
                  `content: "${BULLETS[glyph] ?? "\u2022"}`,
              )
              .replace(/font-family:\s*[^;]+;?/i, "font-family: Arial;")}}`
          : rule,
    );
}

const FIELD_TAG = /([^]*)([^]*)/g;

const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;

// Turn the server's invisible delimiters back into clickable field spans.
function tagFields(root: HTMLElement) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.nodeValue?.includes("")) texts.push(node as Text);
  for (const text of texts) {
    const source = text.nodeValue ?? "";
    const parts: Array<string | HTMLElement> = [];
    let last = 0;
    for (const match of source.matchAll(FIELD_TAG)) {
      parts.push(source.slice(last, match.index));
      const span = document.createElement("span");
      span.className = match[2] ? "doc-field" : "doc-field doc-empty";
      span.dataset["field"] = match[1] ?? "";
      span.textContent = match[2] ?? "";
      parts.push(span);
      last = match.index + match[0].length;
    }
    parts.push(source.slice(last));
    text.replaceWith(
      ...parts
        .filter((part) => part !== "")
        .map((part) =>
          typeof part === "string" ? document.createTextNode(part) : part,
        ),
    );
  }
}

// An empty required field shows its name, so a gap reads as "still to do".
// While a document is still being written the gap is "coming", not "missing".
function markMissing(
  root: HTMLElement,
  fields: readonly DocumentField[],
  writing: boolean,
) {
  for (const span of root.querySelectorAll<HTMLElement>(".doc-empty")) {
    const field = fields.find((item) => item.key === span.dataset["field"]);
    if (!field?.required) continue;
    span.classList.add(writing ? "doc-pending" : "doc-missing");
    span.textContent = field.label;
    span.title = writing
      ? `Writing ${field.label}…`
      : `${field.label} is missing`;
  }
}

export function DocumentPreview({
  preview,
  fields,
  selected,
  onSelect,
  writing = false,
  zoom = "fit",
}: {
  preview: PreviewPayload | null;
  fields: readonly DocumentField[];
  selected: string | null;
  onSelect(key: string): void;
  // The document is being written: gaps shimmer and new values flash in.
  writing?: boolean;
  // "fit" scales the page to the pane; a number is a fixed scale.
  zoom?: "fit" | number;
}) {
  const filled = useRef(new Set<string>());
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const choose = useRef(onSelect);
  choose.current = onSelect;

  // One click handler for the life of the frame.
  useEffect(() => {
    const document = ready ? frame.current?.contentDocument : null;
    if (!document) return;
    const click = (event: MouseEvent) => {
      const key = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-field]",
      )?.dataset["field"];
      if (key) choose.current(key);
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [ready]);

  useEffect(() => {
    const document = ready ? frame.current?.contentDocument : null;
    if (!document?.body || !preview) return;
    let current = true;
    const canvas = frame.current
      ? getComputedStyle(frame.current.parentElement ?? frame.current)
          .backgroundColor
      : "";
    (async () => {
      const style = document.createElement("style");
      style.textContent = `${STYLE} body { background: ${canvas || "transparent"}; }`;
      const styles = document.createElement("div");
      const host = document.createElement("div");
      if (preview.kind === "docx") {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(bytesOf(preview.docx), host, styles, {
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });
      } else {
        host.innerHTML = preview.html;
      }
      if (!current) return;
      drawBullets(styles);
      tagFields(host);
      markMissing(host, fields, writing);
      if (writing)
        for (const span of host.querySelectorAll<HTMLElement>(
          ".doc-field:not(.doc-empty)",
        )) {
          const key = span.dataset["field"] ?? "";
          if (!filled.current.has(key)) span.classList.add("doc-fresh");
          filled.current.add(key);
        }
      // Redrawing keeps the reader's place.
      const top = document.documentElement.scrollTop;
      document.body.replaceChildren(style, styles, host);
      document.documentElement.scrollTop = top;
      setFailed(false);
    })().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [ready, preview, fields, writing]);

  // Fit the page to the pane (a Letter page is wider than a narrow pane), or
  // hold the scale the person chose.
  useEffect(() => {
    const element = frame.current;
    const document = ready ? element?.contentDocument : null;
    if (!element || !document?.body) return;
    const apply = () => {
      if (zoom !== "fit") {
        document.body.style.zoom = String(zoom);
        return;
      }
      document.body.style.zoom = "1";
      const width =
        document.querySelector("section.docx")?.getBoundingClientRect().width ??
        0;
      document.body.style.zoom = width
        ? String(Math.min(1, Math.max(0.4, (element.clientWidth - 32) / width)))
        : "1";
    };
    const watcher =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    watcher?.observe(element);
    const mutations = new MutationObserver(apply);
    mutations.observe(document.body, { childList: true });
    apply();
    return () => {
      watcher?.disconnect();
      mutations.disconnect();
    };
  }, [ready, zoom]);

  // The field being edited is lit in the page, and brought into view.
  useEffect(() => {
    const document = ready ? frame.current?.contentDocument : null;
    if (!document) return;
    for (const item of document.querySelectorAll("[data-selected]"))
      item.removeAttribute("data-selected");
    if (!selected) return;
    const target = document.querySelector<HTMLElement>(
      `[data-field="${selected.replace(/[^A-Za-z0-9_]/g, "")}"]`,
    );
    target?.setAttribute("data-selected", "");
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [ready, selected, preview]);

  return (
    <>
      <iframe
        ref={frame}
        className="dx-preview-frame"
        title="Document preview"
        sandbox="allow-same-origin"
        srcDoc={FRAME}
        onLoad={() => setReady(true)}
      />
      {failed && (
        <p role="alert" className="dx-error dx-preview-error">
          The preview could not be drawn. The fields on the left are still
          saved.
        </p>
      )}
    </>
  );
}
