import {
  escapePreviewHtml,
  MISSING_DOCUMENT_FIELD,
  wrapDocumentPreview,
} from "./render-markdown";
import {
  canonicalDocumentField,
  collectDocxFields,
  decodeXmlText,
  InvalidDocumentTemplateError,
  loadDocxTemplate,
} from "./template-intake";

const FIELD = /\{([^{}]+)\}/g;
const TEXT_RUN = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replaceParagraph(
  paragraph: string,
  values: Record<string, string>,
  missingValue = MISSING_DOCUMENT_FIELD,
): string {
  const nodes = Array.from(paragraph.matchAll(TEXT_RUN), (match) => ({
    start: match.index,
    full: match[0],
    content: decodeXmlText(match[1] ?? ""),
    open: match[0].slice(0, match[0].indexOf(">") + 1),
  }));
  if (nodes.length === 0) return paragraph;
  const text = nodes.map((node) => node.content).join("");
  const matches = Array.from(text.matchAll(FIELD), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    key: match[1] ?? "",
  }));
  if (matches.length === 0) return paragraph;

  let position = 0;
  let matchIndex = 0;
  const replacements = nodes.map((node) => {
    const start = position;
    const end = start + node.content.length;
    position = end;
    let value = "";
    for (let cursor = start; cursor < end; cursor++) {
      while (
        matchIndex < matches.length &&
        cursor >= matches[matchIndex]!.end
      ) {
        matchIndex++;
      }
      const next = matches[matchIndex];
      const placeholder =
        next && next.start <= cursor && cursor < next.end ? next : undefined;
      if (!placeholder) {
        value += text[cursor];
        continue;
      }
      if (cursor === placeholder.start) {
        const key = canonicalDocumentField(placeholder.key);
        const field = Object.hasOwn(values, key) ? values[key] : undefined;
        if (field !== undefined && typeof field !== "string") {
          throw new InvalidDocumentTemplateError(
            "Document field values must be text.",
          );
        }
        value += field ? field : missingValue;
      }
    }
    return `${node.open}${escapeXml(value)}</w:t>`;
  });

  let result = "";
  let last = 0;
  nodes.forEach((node, index) => {
    result += paragraph.slice(last, node.start) + replacements[index];
    last = node.start + node.full.length;
  });
  return result + paragraph.slice(last);
}

function replacePart(
  xml: string,
  values: Record<string, string>,
  missingValue = MISSING_DOCUMENT_FIELD,
): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) =>
    replaceParagraph(paragraph, values, missingValue),
  );
}

export async function renderDocxTemplate(
  source: Buffer,
  values: Record<string, string>,
  options: { missing?: "marker" | "blank" } = {},
): Promise<Buffer> {
  const { zip, parts } = await loadDocxTemplate(source);
  collectDocxFields(parts);
  for (const [name, xml] of parts) {
    zip.file(
      name,
      replacePart(
        xml,
        values,
        options.missing === "blank" ? "" : MISSING_DOCUMENT_FIELD,
      ),
    );
  }
  const output = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (output.length > 20 * 1024 * 1024) {
    throw new InvalidDocumentTemplateError(
      "Rendered document exceeds the size limit.",
    );
  }
  return output;
}

function previewPart(xml: string, values: Record<string, string>): string {
  const rendered = replacePart(xml, values);
  const blocks: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length) blocks.push(`<ul>${bullets.join("")}</ul>`);
    bullets = [];
  };
  for (const match of rendered.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const content = Array.from(paragraph.matchAll(TEXT_RUN), (run) =>
      decodeXmlText(run[1] ?? ""),
    ).join("");
    const text = escapePreviewHtml(content).replace(/\r\n?|\n/g, "<br>");
    const style = paragraph.match(
      /<w:pStyle\b[^>]*\bw:val=(?:"([^"]+)"|'([^']+)')/i,
    );
    const styleName = (style?.[1] ?? style?.[2] ?? "").toLowerCase();
    const heading = /^(?:title|heading\s*1)$/.test(styleName)
      ? "h1"
      : /^(?:subtitle|sectionheading|heading\s*2)$/.test(styleName)
        ? "h2"
        : /^heading\s*3$/.test(styleName)
          ? "h3"
          : null;
    if (/<w:numPr\b/.test(paragraph)) {
      bullets.push(`<li>${text || "&nbsp;"}</li>`);
      continue;
    }
    flushBullets();
    if (heading) blocks.push(`<${heading}>${text}</${heading}>`);
    else blocks.push(`<p>${text || "&nbsp;"}</p>`);
  }
  flushBullets();
  return blocks.join("");
}

export async function renderDocxPreview(
  source: Buffer,
  values: Record<string, string>,
): Promise<string> {
  const { parts } = await loadDocxTemplate(source);
  collectDocxFields(parts);
  const document = parts.get("word/document.xml");
  if (!document)
    throw new InvalidDocumentTemplateError(
      "Template is missing its document body.",
    );
  const sortedParts = (kind: "header" | "footer") =>
    Array.from(parts.entries())
      .filter(([name]) => new RegExp(`^word/${kind}\\d+\\.xml$`).test(name))
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map(([, xml]) => previewPart(xml, values))
      .filter(Boolean)
      .join("");
  const header = sortedParts("header");
  const footer = sortedParts("footer");
  return wrapDocumentPreview(
    `${header ? `<header class="document-header">${header}</header>` : ""}` +
      previewPart(document, values) +
      `${footer ? `<footer class="document-footer">${footer}</footer>` : ""}`,
  );
}
