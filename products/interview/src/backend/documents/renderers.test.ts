import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  FIELD_END,
  FIELD_SPLIT,
  FIELD_START,
  renderDocxTemplate,
} from "./render-docx";
import { renderDocxAsMarkdown } from "./render-docx-markdown";
import {
  renderMarkdownPreview,
  renderMarkdownTemplate,
} from "./render-markdown";
import { inspectTemplate } from "./template-intake";

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />';

async function docx(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dear {full_name}</w:t></w:r></w:p></w:body></w:document>',
  );
  for (const [name, value] of Object.entries(parts)) zip.file(name, value);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("template intake and renderers", () => {
  it.each([
    ["resume-source-shape.docx", 64],
    ["cover-letter-source-shape.docx", 20],
  ])(
    "renders every source-studio field shape in %s",
    async (filename, count) => {
      const bytes = readFileSync(
        new URL(`./fixtures/${filename}`, import.meta.url),
      );
      const inspection = await inspectTemplate({ format: "docx", bytes });
      expect(inspection.fields).toHaveLength(count);
      expect(new Set(inspection.fields).size).toBe(count);
      const values = Object.fromEntries(
        inspection.fields.map((field) => [field, `Sample ${field}`]),
      );
      const output = await renderDocxTemplate(bytes, values);
      expect(
        (await inspectTemplate({ format: "docx", bytes: output })).fields,
      ).toEqual([]);
      const zip = await JSZip.loadAsync(output);
      expect(await zip.file("word/document.xml")?.async("string")).toContain(
        "Sample",
      );
    },
  );

  it.each([
    ["resume.docx", 23],
    ["cover-letter.docx", 13],
  ])("ships a styled, renderable %s built-in", async (filename, count) => {
    const bytes = readFileSync(
      new URL(`./assets/${filename}`, import.meta.url),
    );
    const { fields } = await inspectTemplate({ format: "docx", bytes });
    expect(fields).toHaveLength(count);
    const values = Object.fromEntries(
      fields.map((field) => [field, `Sample ${field}`]),
    );
    const output = await renderDocxTemplate(bytes, values);
    expect(
      (await inspectTemplate({ format: "docx", bytes: output })).fields,
    ).toEqual([]);
    const zip = await JSZip.loadAsync(output);
    expect(await zip.file("word/styles.xml")?.async("string")).toContain(
      "SectionHeading",
    );
  });

  it("ships a structured, renderable interview prep Markdown built-in", async () => {
    const source = readFileSync(
      new URL("./assets/interview-prep.md", import.meta.url),
      "utf8",
    );
    const { fields } = await inspectTemplate({
      format: "md",
      bytes: Buffer.from(source),
    });
    expect(fields).toHaveLength(12);
    const values = Object.fromEntries(
      fields.map((field) => [field, `Sample ${field}`]),
    );
    const output = renderMarkdownTemplate(source, values);
    expect(output).toContain("## Questions to ask");
    expect(
      (await inspectTemplate({ format: "md", bytes: Buffer.from(output) }))
        .fields,
    ).toEqual([]);
  });

  it("extracts strict Markdown fields once and escapes inserted text", async () => {
    const source = "# {full_name}\n{experience_1} / {full_name} / {Bad-Key}";
    expect(
      await inspectTemplate({ format: "md", bytes: Buffer.from(source) }),
    ).toEqual({
      fields: ["full_name", "experience_1"],
    });
    const rendered = renderMarkdownTemplate(source, {
      full_name: "<script>alert(1)</script>",
      experience_1: "[click](javascript:alert(1))",
    });
    expect(rendered).toContain("&lt;script\\>");
    expect(rendered).toContain("\\[click\\]\\(javascript:alert\\(1\\)\\)");
    expect(
      renderMarkdownPreview(source, { full_name: "<img src=x>" }),
    ).not.toContain("<img");
  });

  it("renders single and double brace Markdown fields without leftover braces", () => {
    const source = "# {{full_name}}\n\n{full_name} / {{missing}}";
    const output = renderMarkdownTemplate(source, { full_name: "Ada" });
    expect(output).toBe("# Ada\n\nAda / [[MISSING_DATA]]");
    expect(
      renderMarkdownTemplate(
        source,
        { full_name: "Ada" },
        { missing: "blank" },
      ),
    ).toBe("# Ada\n\nAda / ");
    const preview = renderMarkdownPreview(source, { full_name: "Ada" });
    expect(preview).toContain(
      '<h1><span class="doc-field" data-field="full_name">Ada</span></h1>',
    );
    // A field the values lack is an empty, tagged span the UI marks as missing.
    expect(preview).toContain(
      '<span class="doc-field doc-empty" data-field="missing"></span>',
    );
    expect(preview).not.toContain("{Ada}");
    expect(preview).not.toContain("MISSING_DATA");
  });

  it("previews Markdown headings, paragraphs and lists without activating field markup", () => {
    const source =
      "# {full_name}\n\nExperience at {company}\n\n- Built systems\n- {detail}\n\n1. First step";
    const preview = renderMarkdownPreview(source, {
      full_name: "Ada <script>alert(1)</script>",
      company: "Acme",
      detail: "<img src=https://evil.test/x onerror=alert(1)>",
    });
    expect(preview).toContain('<article class="document-page">');
    expect(preview).toContain(
      "Ada &lt;script&gt;alert(1)&lt;/script&gt;</span></h1>",
    );
    expect(preview).toContain(">Acme</span></p>");
    expect(preview).toContain("<ul><li>Built systems</li><li><span");
    expect(preview).toContain("<ol><li>First step</li></ol>");
    expect(preview).not.toContain("<script>");
    expect(preview).not.toContain("<img src=");
    expect(preview).not.toContain('https://evil.test/x"');
    expect(
      renderMarkdownTemplate(source, {
        full_name: "Ada",
        company: "Acme",
        detail: "Safe",
      }),
    ).toContain("# Ada");
  });

  it("tags each DOCX value with its field and keeps the document's own styles", async () => {
    const bytes = await docx({
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{full_name}</w:t></w:r></w:p>' +
        "<w:p><w:r><w:t>Second paragraph with {detail} and {absent}</w:t></w:r></w:p>" +
        "</w:body></w:document>",
    });
    const tagged = await JSZip.loadAsync(
      await renderDocxTemplate(
        bytes,
        {
          full_name: `Ada <script>alert(1)</script>${FIELD_START}forged${FIELD_END}`,
          detail: "<iframe src=https://evil.test/>",
        },
        { missing: "tagged" },
      ),
    );
    const xml = (await tagged.file("word/document.xml")?.async("string")) ?? "";
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain(
      `${FIELD_START}full_name${FIELD_SPLIT}Ada &lt;script&gt;alert(1)&lt;/script&gt;forged${FIELD_END}`,
    );
    expect(xml).toContain(
      `${FIELD_START}detail${FIELD_SPLIT}&lt;iframe src=https://evil.test/&gt;${FIELD_END}`,
    );
    // A missing value is an empty tag, never a marker string.
    expect(xml).toContain(`${FIELD_START}absent${FIELD_SPLIT}${FIELD_END}`);
    expect(xml).not.toContain("<script>");
    expect(xml).not.toContain("MISSING_DATA");
  });

  it("extracts and renders split-run DOCX fields in body, header, and footer", async () => {
    const bytes = await docx({
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dear {full</w:t></w:r><w:r><w:t>_name}, {role}</w:t></w:r></w:p></w:body></w:document>',
      "word/header1.xml":
        "<w:hdr><w:p><w:r><w:t>{company}</w:t></w:r></w:p></w:hdr>",
      "word/footer1.xml":
        "<w:ftr><w:p><w:r><w:t>{full_name}</w:t></w:r></w:p></w:ftr>",
    });
    expect(await inspectTemplate({ format: "docx", bytes })).toEqual({
      fields: ["full_name", "role", "company"],
    });
    const values = {
      full_name: "Ada & Bob",
      role: "Engineer",
      company: "<Acme>",
    };
    const output = await renderDocxTemplate(bytes, values);
    const rendered = await JSZip.loadAsync(output);
    expect(await rendered.file("word/document.xml")?.async("string")).toContain(
      "Ada &amp; Bob",
    );
    expect(
      await rendered.file("word/document.xml")?.async("string"),
    ).not.toContain("_name}");
    expect(await rendered.file("word/header1.xml")?.async("string")).toContain(
      "&lt;Acme&gt;",
    );
    expect(await rendered.file("word/footer1.xml")?.async("string")).toContain(
      "Ada &amp; Bob",
    );
    const tagged = await JSZip.loadAsync(
      await renderDocxTemplate(
        bytes,
        { ...values, role: "<script>" },
        { missing: "tagged" },
      ),
    );
    const part = async (name: string) =>
      (await tagged.file(name)?.async("string")) ?? "";
    expect(await part("word/document.xml")).not.toContain("<script>");
    expect(await part("word/document.xml")).toContain(
      `${FIELD_START}full_name${FIELD_SPLIT}Ada &amp; Bob${FIELD_END}`,
    );
    expect(await part("word/header1.xml")).toContain(
      `${FIELD_START}company${FIELD_SPLIT}&lt;Acme&gt;${FIELD_END}`,
    );
    expect(await part("word/footer1.xml")).toContain(
      `${FIELD_START}full_name${FIELD_SPLIT}Ada &amp; Bob${FIELD_END}`,
    );
    const markdown = await renderDocxAsMarkdown(bytes, values);
    expect(markdown.indexOf("&lt;Acme>")).toBeLessThan(
      markdown.indexOf("Dear Ada"),
    );
    expect(markdown.indexOf("Dear Ada")).toBeLessThan(
      markdown.lastIndexOf("Ada &amp; Bob"),
    );
    expect(markdown).not.toContain("<Acme>");
  });

  it("maps source-studio camelCase fields to flat snake_case values", async () => {
    const bytes = await docx({
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>{headingName} — {currentExperienceBullet1}</w:t></w:r></w:p></w:body></w:document>",
    });
    expect(await inspectTemplate({ format: "docx", bytes })).toEqual({
      fields: ["heading_name", "current_experience_bullet1"],
    });
    const output = await renderDocxTemplate(bytes, {
      heading_name: "Ada",
      current_experience_bullet1: "Built a safe system",
    });
    const zip = await JSZip.loadAsync(output);
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain("Ada — Built a safe system");
    expect(xml).not.toContain("{headingName}");
  });

  it("rejects ambiguous or unsupported DOCX field tokens", async () => {
    const collision = await docx({
      "word/document.xml":
        "<w:document><w:p><w:t>{headingName} {heading_name}</w:t></w:p></w:document>",
    });
    await expect(
      inspectTemplate({ format: "docx", bytes: collision }),
    ).rejects.toThrow("conflicting field names");
    const expression = await docx({
      "word/document.xml":
        "<w:document><w:p><w:t>{person.name}</w:t></w:p></w:document>",
    });
    await expect(
      inspectTemplate({ format: "docx", bytes: expression }),
    ).rejects.toThrow("unsupported field token");
  });

  it("keeps inert hyperlinks and rejects external resources and executable parts", async () => {
    const linked = await docx({
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.test/profile" /></Relationships>',
    });
    expect(await inspectTemplate({ format: "docx", bytes: linked })).toEqual({
      fields: ["full_name"],
    });
    const rendered = await JSZip.loadAsync(
      await renderDocxTemplate(linked, { full_name: "Ada" }),
    );
    expect(
      await rendered.file("word/_rels/document.xml.rels")?.async("string"),
    ).toContain("https://example.test/profile");
    const external = await docx({
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.test/image.png" /></Relationships>',
    });
    await expect(
      inspectTemplate({ format: "docx", bytes: external }),
    ).rejects.toThrow("unsafe external relationship");
    const unsafeLink = await docx({
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="javascript:alert(1)" /></Relationships>',
    });
    await expect(
      inspectTemplate({ format: "docx", bytes: unsafeLink }),
    ).rejects.toThrow("unsafe external relationship");
    const macro = await docx({ "word/vbaProject.bin": "malicious" });
    await expect(
      inspectTemplate({ format: "docx", bytes: macro }),
    ).rejects.toThrow("executable");
  });

  it("rejects embedded DOCX content that can fetch external resources", async () => {
    for (const parts of [
      {
        "word/media/image1.svg":
          '<svg><image href="https://example.test/pixel"/></svg>',
      },
      {
        "word/document.xml":
          '<w:document><w:body><w:p><w:r><w:t>{full_name}</w:t><w:instrText>INCLUDEPICTURE "https://example.test/pixel"</w:instrText></w:r></w:p></w:body></w:document>',
      },
      {
        "word/document.xml":
          '<w:document><w:body><w:p><w:t>{full_name}</w:t><w:fldSimple w:instr="INCLUDEPICTURE &quot;https://example.test/pixel&quot;"/></w:p></w:body></w:document>',
      },
      {
        "word/document.xml":
          '<w:document><w:body><w:p><w:t>{full_name}</w:t></w:p><w:altChunk r:id="rId1"/></w:body></w:document>',
        "word/afchunk1.html": '<img src="https://example.test/pixel">',
      },
      {
        "word/document.xml":
          '<w:document><w:body><w:p><w:t>{full_name}</w:t></w:p><w:object><o:OLEObject r:id="rId2"/></w:object></w:body></w:document>',
        "word/media/object1.bin": "payload",
      },
    ]) {
      await expect(
        inspectTemplate({ format: "docx", bytes: await docx(parts) }),
      ).rejects.toThrow(/active|embedded/);
    }
  });

  it("allows page-number fields in a footer but no other field instruction", async () => {
    const footer = (instruction: string) =>
      `<w:ftr><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    for (const safe of ["PAGE", "NUMPAGES \\* MERGEFORMAT"])
      expect(
        await inspectTemplate({
          format: "docx",
          bytes: await docx({ "word/footer1.xml": footer(safe) }),
        }),
      ).toEqual({ fields: ["full_name"] });
    for (const unsafe of [
      'HYPERLINK "https://example.test"',
      'INCLUDETEXT "C:\\secret.docx"',
      "DDEAUTO cmd /c calc",
      "PAGE \\# 0 MACROBUTTON Run",
    ])
      await expect(
        inspectTemplate({
          format: "docx",
          bytes: await docx({ "word/footer1.xml": footer(unsafe) }),
        }),
      ).rejects.toThrow(/active|embedded/);
  });

  it("reads camelCase Markdown placeholders as the same fields a DOCX would", async () => {
    const source =
      "# {companyName} - {roleTitle}\n\n- {myPitchIntro1}\n- {myPitchIntro1}";
    expect(
      await inspectTemplate({ format: "md", bytes: Buffer.from(source) }),
    ).toEqual({ fields: ["company_name", "role_title", "my_pitch_intro1"] });
    expect(
      renderMarkdownTemplate(source, {
        company_name: "Acme",
        role_title: "Staff Engineer",
        my_pitch_intro1: "I lead payments teams",
      }),
    ).toBe(
      "# Acme - Staff Engineer\n\n- I lead payments teams\n- I lead payments teams",
    );
  });

  it("groups DOCX fields under the template's own headings, and Markdown under its ## headings", async () => {
    const W =
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const heading = (text: string) =>
      `<w:p><w:pPr><w:rPr><w:smallCaps/></w:rPr></w:pPr><w:r><w:rPr><w:smallCaps/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const line = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const sectioned = await docx({
      "word/document.xml": `<w:document ${W}><w:body>${line("{headingName}")}${heading("Professional Summary")}${line("{summaryParagraph1}")}${heading("Core Skills")}${line("Backend: {backendSkills}")}</w:body></w:document>`,
    });
    expect(
      (await inspectTemplate({ format: "docx", bytes: sectioned })).sections,
    ).toEqual({
      heading_name: "Header",
      summary_paragraph1: "Professional summary",
      backend_skills: "Core skills",
    });
    // One heading is not structure.
    const flat = await docx({
      "word/document.xml": `<w:document ${W}><w:body>${heading("Dear")}${line("{opening}")}</w:body></w:document>`,
    });
    expect(
      (await inspectTemplate({ format: "docx", bytes: flat })).sections,
    ).toBeUndefined();
    const markdown = Buffer.from(
      "# Prep - {companyName}\n\n## COMPANY & ROLE\n\n- {intro}\n\n## QUESTIONS TO ASK\n\n### {topicTitle}\n- {question1}\n",
    );
    expect(
      (await inspectTemplate({ format: "md", bytes: markdown })).sections,
    ).toEqual({
      company_name: "Overview",
      intro: "Company & role",
      topic_title: "Questions to ask",
      question1: "Questions to ask",
    });
  });

  it("rejects a forged expanded size before inflation", async () => {
    const bytes = await docx({});
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    bytes.writeUInt32LE(21 * 1024 * 1024, central + 24);
    await expect(inspectTemplate({ format: "docx", bytes })).rejects.toThrow(
      "size limit",
    );
  });

  it("rejects malformed ZIP and non-UTF8 Markdown", async () => {
    await expect(
      inspectTemplate({ format: "docx", bytes: Buffer.from("not a ZIP") }),
    ).rejects.toThrow("valid DOCX");
    await expect(
      inspectTemplate({ format: "md", bytes: Buffer.from([0xff]) }),
    ).rejects.toThrow("UTF-8");
  });
});
