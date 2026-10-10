import { blankLine, type LineLayout } from "./render-blank";
import { MISSING_DOCUMENT_FIELD } from "./render-markdown";
import {
  canonicalDocumentField,
  collectDocxFields,
  decodeXmlText,
  InvalidDocumentTemplateError,
  loadDocxTemplate,
} from "./template-intake";

const FIELD = /\{([^{}]+)\}/g;
// A tagged preview wraps each value as START key SPLIT value END, which the
// browser turns back into a clickable field once the document is rendered.
export const FIELD_START = "\uE000";
export const FIELD_SPLIT = "\uE001";
export const FIELD_END = "\uE002";
const TAG_CHARS = /[\uE000-\uE002]/g;

const TEXT_RUN = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;

// [SAFETY] Characters XML 1.0 forbids: C0 controls except tab, LF and CR, plus
// the two noncharacters. Checked by code unit, so no control character is spelled
// inside a regular expression.
function isXmlIllegalCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0xfffe ||
    code === 0xffff
  );
}

function escapeXml(value: string): string {
  return [...value]
    .filter((char) => !isXmlIllegalCharacter(char))
    .join("")
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
  tagged = false,
  layout?: LineLayout,
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

  // [DOMAIN] A finished document shows no scaffolding around a value that is
  // not there, and no block that does not apply. The preview (tagged) keeps
  // empty values so they can be clicked, and loses only the absent blocks.
  const textOf = (source: string): string => {
    const key = canonicalDocumentField(source);
    const field = Object.hasOwn(values, key) ? values[key] : undefined;
    return typeof field === "string" ? field : "";
  };
  let deleted: boolean[] | null = null;
  if (missingValue === "" || tagged) {
    const placeholders = matches.map((match) => {
      const key = canonicalDocumentField(match.key);
      return {
        start: match.start,
        end: match.end,
        key,
        // The preview drops a line only for a block that does not apply.
        empty: tagged
          ? (layout?.absent.has(key) ?? false)
          : textOf(match.key).trim() === "",
      };
    });
    const decided = blankLine(
      text,
      placeholders,
      tagged
        ? { layout: { absent: layout?.absent ?? new Set(), header: new Set() } }
        : {
            listItem: /<w:numPr\b/.test(paragraph),
            ...(layout ? { layout } : {}),
          },
    );
    if (decided === "remove") {
      // A paragraph that carries the section's page setup stays, emptied.
      if (!/<w:sectPr\b/.test(paragraph)) return "";
      deleted = Array.from({ length: text.length }, () => true);
    } else if (!tagged) deleted = decided;
  }

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
        if (!deleted?.[cursor]) value += text[cursor];
        continue;
      }
      if (cursor === placeholder.start && !deleted?.[cursor]) {
        const key = canonicalDocumentField(placeholder.key);
        const field = Object.hasOwn(values, key) ? values[key] : undefined;
        if (field !== undefined && typeof field !== "string") {
          throw new InvalidDocumentTemplateError(
            "Document field values must be text.",
          );
        }
        value += tagged
          ? `${FIELD_START}${key}${FIELD_SPLIT}${(field ?? "").replace(TAG_CHARS, "")}${FIELD_END}`
          : field
            ? field
            : missingValue;
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
  tagged = false,
  layout?: LineLayout,
): string {
  return (
    xml
      .replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) =>
        replaceParagraph(paragraph, values, missingValue, tagged, layout),
      )
      // [GUARD] A table cell must hold a paragraph: one emptied by a removed
      // line gets an empty paragraph back, or Word refuses the file.
      .replace(
        /(<w:tc>(?:(?!<\/?w:tc>)[\s\S])*?)(<\/w:tc>)/g,
        (cell: string, body: string, close: string) =>
          /<w:p[\s>/]/.test(body) ? cell : `${body}<w:p/>${close}`,
      )
  );
}

export async function renderDocxTemplate(
  source: Buffer,
  values: Record<string, string>,
  options: {
    missing?: "marker" | "blank" | "tagged";
    draftLabel?: string;
    // Which blocks do not apply and which fields head one that does
    // (`documentLayout`); without it only empty values are tidied.
    layout?: LineLayout;
  } = {},
): Promise<Buffer> {
  const { zip, parts } = await loadDocxTemplate(source);
  collectDocxFields(parts);
  for (const [name, xml] of parts) {
    const filled = replacePart(
      xml,
      values,
      options.missing === "blank" ? "" : MISSING_DOCUMENT_FIELD,
      options.missing === "tagged",
      options.layout,
    );
    zip.file(
      name,
      name === "word/document.xml" && options.draftLabel
        ? filled.replace(
            /<w:body>/,
            `<w:body><w:p><w:r><w:t>${escapeXml(options.draftLabel)}</w:t></w:r></w:p>`,
          )
        : filled,
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
