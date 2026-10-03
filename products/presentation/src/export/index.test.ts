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

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=";

function withSlide(sourceXml: string, settings = document.settings) {
  return {
    ...document,
    settings,
    slides: [{ ...document.slides[0]!, sourceXml }],
  };
}

async function pptxSlide(doc: PresentationDocument) {
  const zip = await JSZip.loadAsync(
    bytes(await exportPresentation(doc, "pptx")),
  );
  return {
    zip,
    xml: await zip.file("ppt/slides/slide1.xml")!.async("string"),
  };
}

describe("block content in downloads", () => {
  it("flattens markdown emphasis and lists bullets on separate lines", async () => {
    const { xml } = await pptxSlide(
      withSlide(
        "<SECTION><P>**bold** and *soft* and `code`</P><BULLETS>one;two\nthree</BULLETS></SECTION>",
      ),
    );
    expect(xml).toContain("bold and soft and code");
    for (const item of ["• one", "• two", "• three"]) {
      expect(xml).toContain(item);
    }
  });

  it("renders diagram, chart and infographic data as readable text", async () => {
    const { xml } = await pptxSlide(
      withSlide(
        [
          "<SECTION>",
          '<DIAGRAM>{"nodes":["Plan","Build","Ship"]}</DIAGRAM>',
          '<CHART>{"labels":["Q1","Q2"],"values":[10]}</CHART>',
          '<INFOGRAPHIC>{"users":5,"growth":"fast"}</INFOGRAPHIC>',
          "<CHART>not json</CHART>",
          "</SECTION>",
        ].join(""),
      ),
    );
    expect(xml).toContain("Plan → Build → Ship");
    expect(xml).toContain("Q1: 10");
    expect(xml).toContain("Q2: ");
    expect(xml).toContain("users: 5");
    expect(xml).toContain("growth: fast");
    expect(xml).toContain("not json");
  });

  it("applies the document's font size and alignment", async () => {
    const small = await pptxSlide(
      withSlide("<SECTION><P>Body</P></SECTION>", {
        fontSize: "small",
        textAlign: "center",
      }),
    );
    expect(small.xml).toContain('sz="2000"');
    expect(small.xml).toContain('algn="ctr"');
    const large = await pptxSlide(
      withSlide("<SECTION><P>Body</P></SECTION>", {
        fontSize: "large",
        textAlign: "right",
      }),
    );
    expect(large.xml).toContain('sz="3000"');
    expect(large.xml).toContain('algn="r"');
  });

  it("embeds PNG and JPEG uploads in PPTX and PDF downloads", async () => {
    const doc = withSlide(
      `<SECTION><H1>Pictures</H1><IMG url="${PNG}" /><IMG url="${JPEG}" /></SECTION>`,
    );
    const { zip } = await pptxSlide(doc);
    expect(
      Object.keys(zip.files).filter(
        (path) => path.startsWith("ppt/media/") && !path.endsWith("/"),
      ),
    ).toHaveLength(2);
    const pdf = await PDFDocument.load(
      bytes(await exportPresentation(doc, "pdf")),
    );
    expect(pdf.getPageCount()).toBe(1);
  });

  it.each(["left", "center", "right"])(
    "lays out wrapped %s-aligned PDF text on a single page",
    async (textAlign) => {
      const pdf = await PDFDocument.load(
        bytes(
          await exportPresentation(
            withSlide(
              `<SECTION><H1>Title</H1><P>${"wrapped words ".repeat(60)}\nsecond paragraph</P></SECTION>`,
              { textAlign },
            ),
            "pdf",
          ),
        ),
      );
      expect(pdf.getPageCount()).toBe(1);
    },
  );

  it("rejects image stacks that do not fit on the slide", async () => {
    const tall = withSlide(
      `<SECTION>${`<IMG url="${PNG}" />`.repeat(4)}</SECTION>`,
    );
    await expect(exportPresentation(tall, "pdf")).rejects.toThrow(
      "Split it into smaller slides",
    );
  });
});
