import type { Readable } from "node:stream";
import JSZip from "jszip";

export type DocumentTemplateFormat = "docx" | "md";
export type TemplateInspection = {
  fields: string[];
  // Canonical field key to the heading it sits under, when the template has
  // at least two headings.
  sections?: Record<string, string>;
};

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 128;
// {{name}} and {name}, camelCase or snake_case, as in a DOCX template.
export const MARKDOWN_FIELD =
  /\{\{([A-Za-z][A-Za-z0-9_]{0,79})\}\}|\{([A-Za-z][A-Za-z0-9_]{0,79})\}/g;
const DOCX_FIELD = /\{([^{}]+)\}/g;
const DOCX_SOURCE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const WORD_PART = /^word\/(?:document|header\d+|footer\d+)\.xml$/;
const HYPERLINK_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

// Page numbering is the only field a template may carry; any other field
// instruction (INCLUDETEXT, DDE, HYPERLINK, MACROBUTTON...) can fetch or run.
const PAGE_FIELD = /^\s*(?:PAGE|NUMPAGES|SECTIONPAGES)(?:\s+\\\*\s+\w+)*\s*$/i;

function hasActiveContent(xml: string): boolean {
  if (/<(?:[A-Za-z_][\w.-]*:)?(?:altChunk|object|OLEObject|svg)\b/i.test(xml))
    return true;
  const instructions = [
    ...Array.from(
      xml.matchAll(
        /<(?:[A-Za-z_][\w.-]*:)?instrText\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?instrText>/gi,
      ),
      (match) => decodeXmlText(match[1] ?? ""),
    ),
    ...Array.from(
      xml.matchAll(
        /<(?:[A-Za-z_][\w.-]*:)?fldSimple\b[^>]*?\bw:instr=(?:"([^"]*)"|'([^']*)')/gi,
      ),
      (match) => decodeXmlText(match[1] ?? match[2] ?? ""),
    ),
  ];
  const declared = (
    xml.match(/<(?:[A-Za-z_][\w.-]*:)?(?:instrText|fldSimple)\b/gi) ?? []
  ).length;
  return (
    instructions.length !== declared ||
    instructions.some((instruction) => !PAGE_FIELD.test(instruction))
  );
}

export class InvalidDocumentTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentTemplateError";
  }
}

function reject(message: string): never {
  throw new InvalidDocumentTemplateError(message);
}

function assertSafeName(name: string): void {
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    reject("Template archive contains an unsafe path.");
  }
  if (/(?:^|\/)(?:vbaProject\.bin|embeddings|activeX|oleObject)/i.test(name)) {
    reject("Template archive contains executable or embedded content.");
  }
  if (/\.(?:svg|html?|xhtml|mht|mhtml|bin)$/i.test(name)) {
    reject("Template archive contains active embedded content.");
  }
}

// Read the ZIP directory before inflating anything, so ordinary ZIP bombs are
// rejected without allocating their advertised expanded size.
function preflightZip(bytes: Buffer): void {
  if (bytes.length > MAX_TEMPLATE_BYTES)
    reject("Template exceeds the size limit.");
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i--
  ) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > bytes.length)
    reject("Template is not a valid DOCX archive.");
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (
    bytes.readUInt16LE(eocd + 4) !== 0 ||
    bytes.readUInt16LE(eocd + 6) !== 0 ||
    bytes.readUInt16LE(eocd + 8) !== entries ||
    entries === 0 ||
    entries > MAX_ENTRIES ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize > eocd
  ) {
    reject("Template archive is unsupported or exceeds its limits.");
  }
  let cursor = directoryOffset;
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      reject("Template archive has an invalid directory.");
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      end > eocd ||
      flags & 1 ||
      (method !== 0 && method !== 8) ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff
    ) {
      reject("Template archive uses an unsupported entry.");
    }
    assertSafeName(
      bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength),
    );
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES)
      reject("Template expands beyond the size limit.");
    cursor = end;
  }
  if (cursor !== directoryOffset + directorySize) {
    reject("Template archive has an invalid directory length.");
  }
}

async function readBounded(
  file: JSZip.JSZipObject,
  limit: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, rejectPart) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const stream = file.nodeStream("nodebuffer") as Readable;
    stream.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        stream.destroy();
        rejectPart(
          new InvalidDocumentTemplateError(
            "Template part expands beyond the size limit.",
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () =>
      rejectPart(
        new InvalidDocumentTemplateError(
          "Template archive contains a damaged part.",
        ),
      ),
    );
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// A C0 control character in a link target is never legitimate.
function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) <= 0x1f);
}

function safeHyperlink(target: string): boolean {
  if (
    target.length > 2_048 ||
    /[\s<>]/.test(target) ||
    hasControlCharacter(target)
  )
    return false;
  if (/^mailto:/i.test(target)) {
    return (
      /^mailto:[^@/?#\s]+@[^@/?#\s]+(?:\?[^\s]*)?$/i.test(target) &&
      !/%0[ad]/i.test(target)
    );
  }
  try {
    const url = new URL(target);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname
    );
  } catch {
    return false;
  }
}

function assertSafeRelationships(xml: string): void {
  const relationships = Array.from(
    xml.matchAll(/<Relationship\b([^<>]*)\/?\s*>/g),
  );
  let externalModes = 0;
  for (const match of relationships) {
    const attributes = new Map<string, string>();
    for (const attribute of (match[1] ?? "").matchAll(
      /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g,
    )) {
      if (attribute[1])
        attributes.set(attribute[1], decodeXmlText(attribute[3] ?? ""));
    }
    const mode = attributes.get("TargetMode");
    const target = attributes.get("Target") ?? "";
    const type = attributes.get("Type") ?? "";
    if (
      /(?:\/|#)(?:aFChunk|oleObject|package|activeXControl|attachedTemplate)$/i.test(
        type,
      )
    ) {
      reject("Template contains an unsafe embedded relationship.");
    }
    if (mode !== undefined) {
      externalModes++;
      if (
        mode !== "External" ||
        attributes.get("Type") !== HYPERLINK_RELATIONSHIP ||
        !safeHyperlink(target)
      ) {
        reject("Template contains an unsafe external relationship.");
      }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      reject("Template contains an unsafe external relationship.");
    }
  }
  // A mode outside a well-formed Relationship element must not bypass review.
  const mentionedModes = Array.from(xml.matchAll(/\bTargetMode\s*=/g)).length;
  if (externalModes !== mentionedModes) {
    reject("Template contains an unsafe external relationship.");
  }
}

export async function loadDocxTemplate(bytes: Buffer): Promise<{
  zip: JSZip;
  parts: Map<string, string>;
}> {
  preflightZip(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    reject("Template is not a valid DOCX archive.");
  }
  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    reject("Template is missing required DOCX parts.");
  }
  const parts = new Map<string, string>();
  let expanded = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    assertSafeName(name);
    if (entry.dir) continue;
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      const part = await readBounded(entry, MAX_EXPANDED_BYTES - expanded);
      expanded += part.length;
      const xml = part.toString("utf8");
      if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml))
        reject("Template XML declarations are unsupported.");
      if (hasActiveContent(xml))
        reject("Template contains active field or embedded content.");
      if (name.endsWith(".rels")) assertSafeRelationships(xml);
      if (
        name === "[Content_Types].xml" &&
        /macroEnabled|vbaProject|activeX/i.test(xml)
      ) {
        reject("Template contains executable content.");
      }
      if (WORD_PART.test(name)) parts.set(name, xml);
    }
  }
  return { zip, parts };
}

export function decodeXmlText(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|\d+));/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      const value = named[entity.toLowerCase()];
      if (value !== undefined) return value;
      const number = entity.slice(2, -1);
      const code = number.startsWith("x")
        ? Number.parseInt(number.slice(1), 16)
        : Number(number);
      return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    },
  );
}

export function extractDocxPartFields(xml: string): string[] {
  const fields: string[] = [];
  for (const paragraph of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const text = Array.from(
      paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
    )
      .map((match) => decodeXmlText(match[1] ?? ""))
      .join("");
    for (const match of text.matchAll(DOCX_FIELD)) {
      if (match[1]) fields.push(match[1]);
    }
  }
  return fields;
}

const sentenceCase = (text: string) => {
  const lower = text.trim().replace(/\s+/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

// Group fields under the headings a template already has. The first fields,
// above any heading, are the header. One heading is no structure.
function groupBySection(
  entries: ReadonlyArray<{ heading?: string; keys: string[] }>,
  intro: string,
): Record<string, string> | undefined {
  const sections: Record<string, string> = {};
  let current = intro;
  let headings = 0;
  for (const entry of entries) {
    if (entry.heading) {
      current = entry.heading;
      headings++;
    }
    for (const key of entry.keys)
      if (!Object.hasOwn(sections, key)) sections[key] = current;
  }
  return headings >= 2 ? sections : undefined;
}

function docxSections(parts: Map<string, string>) {
  const entries: Array<{ heading?: string; keys: string[] }> = [];
  for (const paragraph of (parts.get("word/document.xml") ?? "").matchAll(
    /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,
  )) {
    const text = Array.from(
      paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
      (run) => decodeXmlText(run[1] ?? ""),
    ).join("");
    const keys = Array.from(text.matchAll(DOCX_FIELD), (match) => {
      try {
        return canonicalDocumentField(match[1] ?? "");
      } catch {
        return "";
      }
    }).filter(Boolean);
    const label = text.trim();
    // A heading has no placeholders, is short, and is set apart: a heading
    // style, small caps, all caps or a shaded bar.
    const heading =
      !keys.length &&
      label.length >= 3 &&
      label.length <= 60 &&
      (/<w:pStyle\b[^>]*w:val="(?:Heading\d?|Title|Subtitle)"/i.test(
        paragraph[0],
      ) ||
        /<w:(?:smallCaps|caps)\b/.test(paragraph[0]) ||
        /<w:shd\b/.test(paragraph[0]) ||
        (label === label.toUpperCase() && /[A-Z]/.test(label)));
    entries.push({
      ...(heading ? { heading: sentenceCase(label) } : {}),
      keys,
    });
  }
  return groupBySection(entries, "Header");
}

function markdownSections(source: string) {
  const entries: Array<{ heading?: string; keys: string[] }> = [];
  for (const line of source.split(/\r\n?|\n/)) {
    const heading = /^\s{0,3}##\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    const keys = Array.from(line.matchAll(MARKDOWN_FIELD), (match) =>
      canonicalDocumentField(match[1] ?? match[2] ?? ""),
    );
    entries.push({
      ...(heading && !keys.length ? { heading: sentenceCase(heading) } : {}),
      keys,
    });
  }
  return groupBySection(entries, "Overview");
}

export function canonicalDocumentField(sourceKey: string): string {
  if (!DOCX_SOURCE_KEY.test(sourceKey)) {
    reject("Template contains an unsupported field token.");
  }
  const key = sourceKey
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    reject("Template contains an unsupported field token.");
  }
  return key;
}

export function collectDocxFields(parts: Map<string, string>): string[] {
  const byCanonical = new Map<string, string>();
  for (const xml of parts.values()) {
    for (const sourceKey of extractDocxPartFields(xml)) {
      const canonical = canonicalDocumentField(sourceKey);
      const previous = byCanonical.get(canonical);
      if (previous && previous !== sourceKey) {
        reject("Template contains conflicting field names.");
      }
      byCanonical.set(canonical, sourceKey);
    }
  }
  return [...byCanonical.keys()];
}

export async function inspectTemplate(input: {
  format: DocumentTemplateFormat;
  bytes: Buffer;
}): Promise<TemplateInspection> {
  if (input.bytes.length > MAX_TEMPLATE_BYTES)
    reject("Template exceeds the size limit.");
  if (input.format === "md") {
    const source = input.bytes.toString("utf8");
    if (Buffer.from(source, "utf8").compare(input.bytes) !== 0)
      reject("Markdown must be UTF-8.");
    const byCanonical = new Map<string, string>();
    for (const match of source.matchAll(MARKDOWN_FIELD)) {
      const sourceKey = match[1] ?? match[2] ?? "";
      const canonical = canonicalDocumentField(sourceKey);
      const previous = byCanonical.get(canonical);
      if (previous && previous !== sourceKey)
        reject("Template contains conflicting field names.");
      byCanonical.set(canonical, sourceKey);
    }
    const sections = markdownSections(source);
    return {
      fields: [...byCanonical.keys()],
      ...(sections ? { sections } : {}),
    };
  }
  const { parts } = await loadDocxTemplate(input.bytes);
  const sections = docxSections(parts);
  return {
    fields: collectDocxFields(parts),
    ...(sections ? { sections } : {}),
  };
}
