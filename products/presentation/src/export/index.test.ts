import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PresentationDocument } from "../domain/index.js";
import { exportPresentation } from "./index.js";

const document: PresentationDocument = {
  id: "document",
  title: "Garden plan",
  revision: 1,
  slideCount: 2,
  favorite: false,
  updatedAt: "2026-09-30T00:00:00Z",
  outline: [],
  themeId: null,
  settings: { theme: "ebony" },
  slides: [
    {
      id: "one",
      position: 0,
      revision: 1,
      content: {},
      sourceXml:
        "<SECTION><H1>Garden plan</H1><BULLETS>Choose a site;Invite neighbours</BULLETS></SECTION>",
    },
    {
      id: "two",
      position: 1,
      revision: 1,
      content: {},
      sourceXml:
        "<SECTION><H1>Next steps</H1><P>Réserver le terrain.</P></SECTION>",
    },
  ],
};

function bytes(reference: string) {
  return Buffer.from(reference.split(",")[1]!, "base64");
}

describe("presentation downloads", () => {
  it("creates readable PPTX slides with separate blocks and the selected theme", async () => {
    const zip = await JSZip.loadAsync(
      bytes(await exportPresentation(document, "pptx")),
    );
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toContain("Garden plan");
    expect(slide).toContain("Choose a site");
    expect(slide).toContain("111827");
    expect(slide.match(/<p:sp>/g)).toHaveLength(2);
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
  });
  it("creates one wide PDF page per slide", async () => {
    const pdf = await PDFDocument.load(
      bytes(await exportPresentation(document, "pdf")),
    );
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 1280, height: 720 });
    expect(pdf.getTitle()).toBe("Garden plan");
  });
  it("rejects remote image export with a useful message instead of dropping the image", async () => {
    const remote = {
      ...document,
      slides: [
        {
          ...document.slides[0]!,
          sourceXml:
            '<SECTION><IMG url="https://example.com/image.png" /></SECTION>',
        },
      ],
    };
    await expect(exportPresentation(remote, "pptx")).rejects.toThrow(
      "Upload PNG or JPEG",
    );
    await expect(exportPresentation(remote, "pdf")).rejects.toThrow(
      "Upload PNG or JPEG",
    );
  });
});

it("rejects unsupported PDF scripts while preserving them in PPTX", async () => {
  const multilingual = {
    ...document,
    slides: [
      {
        ...document.slides[0]!,
        sourceXml: "<SECTION><H1>こんにちは</H1></SECTION>",
      },
    ],
  };
  await expect(exportPresentation(multilingual, "pdf")).rejects.toThrow(
    "Use PPTX",
  );
  const zip = await JSZip.loadAsync(
    bytes(await exportPresentation(multilingual, "pptx")),
  );
  expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    "こんにちは",
  );
});

it.each(["pdf", "pptx"] as const)(
  "rejects overflowing %s slides instead of silently clipping content",
  async (format) => {
    const overflowing = {
      ...document,
      slides: [
        {
          ...document.slides[0]!,
          sourceXml: `<SECTION><P>${"Garden planning details ".repeat(500)}</P></SECTION>`,
        },
      ],
    };
    await expect(exportPresentation(overflowing, format)).rejects.toThrow(
      "Split it into smaller slides",
    );
  },
);
