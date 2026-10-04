import {
  canonicalDocumentField,
  MARKDOWN_FIELD as FIELD,
  InvalidDocumentTemplateError,
} from "./template-intake";

export const MISSING_DOCUMENT_FIELD = "[[MISSING_DATA]]";

export function escapePreviewHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function wrapDocumentPreview(body: string): string {
  return `<style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:#e9edf2;color:#17212d;font:15px/1.55 Georgia,serif}
    .document-page{max-width:760px;min-height:940px;margin:auto;padding:64px 68px;background:#fff;box-shadow:0 3px 18px #14203020;overflow-wrap:anywhere}
    h1,h2,h3,h4,h5,h6{font-family:Arial,sans-serif;line-height:1.25;margin:1.4em 0 .45em}
    h1{font-size:28px}h2{font-size:21px}h3{font-size:17px}
    p{margin:.55em 0 1em}ul,ol{padding-left:1.5em;margin:.5em 0 1em}li{margin:.2em 0}
    code{font:13px/1.4 ui-monospace,monospace;background:#f1f3f5;padding:.1em .25em}
    pre{white-space:pre-wrap;background:#f1f3f5;padding:12px;overflow-wrap:anywhere}
    .document-header{border-bottom:1px solid #cfd5dd;margin-bottom:22px;padding-bottom:8px;color:#506075}
    .document-footer{border-top:1px solid #cfd5dd;margin-top:28px;padding-top:8px;color:#506075}
    @media(max-width:700px){body{padding:8px}.document-page{min-height:0;padding:26px 22px}}
  </style><article class="document-page">${body}</article>`;
}

export function escapeMarkdownValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+.!|>~-])/g, "\\$1")
    .replace(/</g, "&lt;")
    .replace(/&(?!(?:lt|gt|amp|quot|#\d+);)/g, "&amp;");
}

export function renderMarkdownTemplate(
  source: string,
  values: Record<string, string>,
  options: { missing?: "marker" | "blank" } = {},
): string {
  return source.replace(
    FIELD,
    (_whole, doubleKey: string | undefined, singleKey: string | undefined) => {
      const key = canonicalDocumentField(doubleKey ?? singleKey!);
      if (!Object.hasOwn(values, key))
        return options.missing === "blank" ? "" : MISSING_DOCUMENT_FIELD;
      const value = values[key];
      if (typeof value !== "string") {
        throw new InvalidDocumentTemplateError(
          "Document field values must be text.",
        );
      }
      return value.length === 0
        ? options.missing === "blank"
          ? ""
          : MISSING_DOCUMENT_FIELD
        : escapeMarkdownValue(value);
    },
  );
}

export function renderMarkdownPreview(
  source: string,
  values: Record<string, string>,
): string {
  const inline = (text: string): string => {
    let result = "";
    let last = 0;
    for (const match of text.matchAll(FIELD)) {
      const key = canonicalDocumentField(match[1] ?? match[2]!);
      result += escapePreviewHtml(text.slice(last, match.index));
      const value = Object.hasOwn(values, key) ? values[key] : undefined;
      if (value !== undefined && typeof value !== "string")
        throw new InvalidDocumentTemplateError(
          "Document field values must be text.",
        );
      // Each value is tagged with its field, so a click can select it.
      result += `<span class="doc-field${value ? "" : " doc-empty"}" data-field="${key}">${
        value ? escapePreviewHtml(value).replace(/\r\n?|\n/g, "<br>") : ""
      }</span>`;
      last = match.index + match[0].length;
    }
    result += escapePreviewHtml(text.slice(last));
    return result;
  };

  const blocks: string[] = [];
  const paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let code: string[] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.join(" ")}</p>`);
    paragraph.length = 0;
  };
  const flushList = () => {
    if (listType)
      blocks.push(`<${listType}>${listItems.join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };
  const flushCode = () => {
    if (code) blocks.push(`<pre><code>${code.join("\n")}</code></pre>`);
    code = null;
  };
  for (const line of source.split(/\r\n?|\n/)) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      if (code) flushCode();
      else code = [];
      continue;
    }
    if (code) {
      code.push(inline(line));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || number) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (listType !== type) {
        flushList();
        listType = type;
      }
      listItems.push(`<li>${inline((bullet ?? number)![1]!)}</li>`);
      continue;
    }
    flushList();
    paragraph.push(inline(line.trim()));
  }
  flushParagraph();
  flushList();
  flushCode();
  return wrapDocumentPreview(blocks.join(""));
}
