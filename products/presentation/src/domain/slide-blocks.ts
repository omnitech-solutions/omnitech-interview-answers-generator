export type SlideBlockType =
  | "TITLE"
  | "H1"
  | "H2"
  | "H3"
  | "P"
  | "QUOTE"
  | "CODE"
  | "BULLETS"
  | "COLUMNS"
  | "CHART"
  | "DIAGRAM"
  | "INFOGRAPHIC"
  | "IMG";

export interface SlideBlock {
  type: SlideBlockType;
  text: string;
}

function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function encode(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function parseSlideBlocks(source: string): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  const blockPattern =
    /<(TITLE|H1|H2|H3|P|QUOTE|CODE|BULLETS|COLUMNS|CHART|DIAGRAM|INFOGRAPHIC|IMG)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<IMG\s+(?:url|query)="([^"]+)"\s*\/>/gi;
  for (const match of source.matchAll(blockPattern)) {
    if (match[3] !== undefined) {
      blocks.push({ type: "IMG", text: decode(match[3]) });
    } else if (match[1] && match[2] !== undefined) {
      blocks.push({
        type: match[1].toUpperCase() as SlideBlockType,
        text: decode(match[2]).trim(),
      });
    }
  }
  return blocks.length > 0
    ? blocks
    : [{ type: "P", text: source.replace(/<[^>]+>/g, "").trim() }];
}

export function serializeSlideBlocks(
  source: string,
  blocks: readonly SlideBlock[],
): string {
  const layout =
    source.match(/<SECTION\s+layout="([^"]+)"/i)?.[1] ?? "vertical";
  const body = blocks
    .filter((block) => block.text.trim())
    .map((block) =>
      block.type === "IMG"
        ? `<IMG url="${encode(block.text)}" />`
        : `<${block.type}>${encode(block.text)}</${block.type}>`,
    )
    .join("");
  return `<SECTION layout="${encode(layout)}">${body}</SECTION>`;
}
