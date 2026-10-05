import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import { slideAppearance } from "../domain/appearance";
import type { PresentationDocument } from "../domain/index";
import { parseSlideBlocks, type SlideBlock } from "../domain/slide-blocks";

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function textFor(block: SlideBlock): string {
  const text = block.text.replace(
    /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g,
    "$1$2$3",
  );
  if (block.type === "BULLETS")
    return text
      .split(/\n|;\s*/)
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join("\n");
  if (["CHART", "DIAGRAM", "INFOGRAPHIC"].includes(block.type)) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(data["nodes"])) return data["nodes"].join(" → ");
      if (Array.isArray(data["labels"]) && Array.isArray(data["values"])) {
        const values = data["values"];
        return data["labels"]
          .map((label, index) => `${label}: ${values[index] ?? ""}`)
          .join("\n");
      }
      return Object.entries(data)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("\n");
    } catch {
      return text;
    }
  }
  return text;
}

async function exportPptx(document: PresentationDocument): Promise<string> {
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "Omnitech Studio";
  presentation.title = document.title;
  const appearance = slideAppearance(document.settings);
  for (const slide of document.slides) {
    const page = presentation.addSlide();
    page.background = { color: appearance.background.slice(1) };
    const blocks = parseSlideBlocks(slide.sourceXml);
    let y = 0.5;
    for (const block of blocks) {
      if (block.type === "IMG") {
        if (!/^data:image\/(png|jpe?g);base64,/i.test(block.text)) {
          throw new ExportRefusedError(
            "Upload PNG or JPEG images before exporting. Remote image exports are not supported.",
          );
        }
        page.addImage({
          data: block.text,
          x: 0.7,
          y,
          w: 6,
          h: 2.8,
          sizing: { type: "contain", w: 6, h: 2.8 },
        });
        y += 2.9;
        continue;
      }
      const heading = ["TITLE", "H1", "H2", "H3"].includes(block.type);
      const text = textFor(block);
      const height = heading
        ? 0.8
        : Math.max(
            0.6,
            Math.ceil(text.length / 95) * 0.35 +
              (text.split("\n").length - 1) * 0.3,
          );
      if (y + height > 7)
        throw new ExportRefusedError(
          "This slide has too much content to export. Split it into smaller slides.",
        );
      page.addText(text, {
        x: 0.7,
        y,
        w: 11.9,
        h: height,
        color: appearance.text.slice(1),
        fontFace: "Aptos",
        fontSize: heading ? appearance.fontSize * 1.4 : appearance.fontSize,
        align: appearance.textAlign,
        bold: heading,
        margin: 0,
        breakLine: false,
        fit: "shrink",
      });
      y += height + 0.15;
    }
  }
  const bytes = (await presentation.write({ outputType: "arraybuffer" })) as
    | ArrayBuffer
    | Uint8Array;
  return dataUrl(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
}

async function exportPdf(document: PresentationDocument): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const appearance = slideAppearance(document.settings);
  const pdfColor = (hex: string) =>
    rgb(
      Number.parseInt(hex.slice(1, 3), 16) / 255,
      Number.parseInt(hex.slice(3, 5), 16) / 255,
      Number.parseInt(hex.slice(5, 7), 16) / 255,
    );
  for (const slide of document.slides) {
    const page = pdf.addPage([1280, 720]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      color: pdfColor(appearance.background),
    });
    let y = 650;
    for (const block of parseSlideBlocks(slide.sourceXml)) {
      if (block.type === "IMG") {
        const match = block.text.match(
          /^data:image\/(png|jpe?g);base64,(.+)$/i,
        );
        if (!match?.[2])
          throw new ExportRefusedError(
            "Upload PNG or JPEG images before exporting. Remote image exports are not supported.",
          );
        // pdf-lib's JPEG reader ignores byteOffset, so give it an unshared copy
        // (a small Buffer is a view into Node's shared pool).
        const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
        const image =
          match[1]?.toLowerCase() === "png"
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        const dimensions = image.scaleToFit(700, 260);
        if (y - dimensions.height < 40)
          throw new ExportRefusedError(
            "This slide has too much content to export. Split it into smaller slides.",
          );
        page.drawImage(image, {
          x: 56,
          y: y - dimensions.height,
          ...dimensions,
        });
        y -= dimensions.height + 20;
        continue;
      }
      const heading = ["TITLE", "H1", "H2", "H3"].includes(block.type);
      const font = heading ? bold : normal;
      const size = heading ? appearance.fontSize * 1.4 : appearance.fontSize;
      const text = textFor(block).replaceAll("→", "->");
      const lines: string[] = [];
      for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const next = line ? `${line} ${word}` : word;
          try {
            const width = font.widthOfTextAtSize(next, size);
            if (line && width > 1168) {
              lines.push(line);
              line = word;
            } else line = next;
          } catch {
            throw new ExportRefusedError(
              "PDF export supports Latin text. Use PPTX for slides containing other scripts or emoji.",
            );
          }
        }
        lines.push(line);
      }
      for (const line of lines) {
        if (y < 40)
          throw new ExportRefusedError(
            "This slide has too much content to export. Split it into smaller slides.",
          );
        page.drawText(line, {
          x:
            appearance.textAlign === "center"
              ? (1280 - font.widthOfTextAtSize(line, size)) / 2
              : appearance.textAlign === "right"
                ? 1224 - font.widthOfTextAtSize(line, size)
                : 56,
          y,
          size,
          font,
          color: pdfColor(appearance.text),
        });
        y -= size * 1.3;
      }
      y -= 16;
    }
  }
  return dataUrl("application/pdf", await pdf.save());
}

/** A refusal whose message is fixed text written for the person exporting. */
export class ExportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRefusedError";
  }
}

export function exportPresentation(
  document: PresentationDocument,
  format: "pptx" | "pdf",
): Promise<string> {
  return format === "pptx" ? exportPptx(document) : exportPdf(document);
}
