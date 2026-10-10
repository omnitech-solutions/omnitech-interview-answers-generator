import type { LineLayout } from "./render-blank";
import { renderDocxTemplate } from "./render-docx";
import { escapeMarkdownValue } from "./render-markdown";
import {
  decodeXmlText,
  InvalidDocumentTemplateError,
  loadDocxTemplate,
} from "./template-intake";

/** Render the selected DOCX revision as readable Markdown with the same field values. */
export async function renderDocxAsMarkdown(
  source: Buffer,
  values: Record<string, string>,
  layout?: LineLayout,
): Promise<string> {
  const rendered = await renderDocxTemplate(source, values, {
    missing: "blank",
    ...(layout ? { layout } : {}),
  });
  const { parts } = await loadDocxTemplate(rendered);
  const xml = parts.get("word/document.xml");
  if (!xml)
    throw new InvalidDocumentTemplateError(
      "Template is missing its document body.",
    );
  const paragraphs: string[] = [];
  const sortedParts = (kind: "header" | "footer") =>
    Array.from(parts.entries())
      .filter(([name]) => new RegExp(`^word/${kind}\\d+\\.xml$`).test(name))
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );
  for (const [, header] of sortedParts("header"))
    paragraphs.push(...markdownParagraphs(header));
  paragraphs.push(...markdownParagraphs(xml));
  for (const [, footer] of sortedParts("footer"))
    paragraphs.push(...markdownParagraphs(footer));
  return `${paragraphs.join("\n\n")}\n`;
}

function markdownParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const match of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const paragraph = match[1] ?? "";
    const text = Array.from(
      paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
    )
      .map((run) => decodeXmlText(run[1] ?? ""))
      .join("")
      .trim();
    if (!text) continue;
    const style =
      paragraph.match(/<w:pStyle\b[^>]*\bw:val=(?:"([^"]+)"|'([^']+)')/)?.[1] ??
      "";
    const escaped = escapeMarkdownValue(text);
    const heading = /^title$/i.test(style)
      ? "# "
      : /^heading1$/i.test(style)
        ? "## "
        : /^heading2$/i.test(style)
          ? "### "
          : "";
    paragraphs.push(
      heading
        ? `${heading}${escaped}`
        : /<w:numPr\b/.test(paragraph)
          ? `- ${escaped}`
          : escaped,
    );
  }
  return paragraphs;
}
