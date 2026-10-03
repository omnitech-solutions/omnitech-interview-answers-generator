import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importPowerPointTheme } from "./theme-import.js";

describe("PowerPoint theme import", () => {
  it("extracts the OOXML palette and font pair", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/theme/theme1.xml",
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:themeElements>
          <a:clrScheme>
            <a:dk1><a:sysClr lastClr="102030"/></a:dk1>
            <a:lt1><a:srgbClr val="F8FAFC"/></a:lt1>
            <a:accent1><a:srgbClr val="D946EF"/></a:accent1>
          </a:clrScheme>
          <a:fontScheme>
            <a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
            <a:minorFont><a:latin typeface="Aptos"/></a:minorFont>
          </a:fontScheme>
        </a:themeElements>
      </a:theme>`,
    );
    const archive = await zip.generateAsync({ type: "uint8array" });

    const theme = await importPowerPointTheme(archive, "Board theme");

    expect(theme.name).toBe("Board theme");
    expect(theme.definition).toMatchObject({
      background: "#F8FAFC",
      text: "#102030",
      accent: "#D946EF",
      fonts: { heading: "Aptos Display", body: "Aptos" },
    });
  });

  async function archiveWith(entries: Record<string, string>) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(entries)) {
      zip.file(path, content);
    }
    return zip.generateAsync({ type: "uint8array" });
  }

  it("falls back to the default palette and fonts for a theme without them", async () => {
    const theme = await importPowerPointTheme(
      await archiveWith({ "ppt/theme/theme2.xml": "<a:theme></a:theme>" }),
    );

    expect(theme.name).toBe("Imported PowerPoint theme");
    expect(theme.description).toBe("Imported from ppt/theme/theme2.xml");
    expect(theme.definition).toEqual({
      background: "#FFFFFF",
      text: "#111827",
      accent: "#4F46E5",
      accents: {},
      fonts: { heading: "Aptos Display", body: "Aptos" },
    });
  });

  it("collects every accent colour present, upper-casing hashed values", async () => {
    const theme = await importPowerPointTheme(
      await archiveWith({
        "ppt/theme/theme1.xml": `<a:theme>
          <a:accent1><a:srgbClr val="#ab12cd"/></a:accent1>
          <a:accent2><a:srgbClr val="00ff00"/></a:accent2>
          <a:accent3><a:sysClr/></a:accent3>
        </a:theme>`,
      }),
    );

    expect(theme.definition["accents"]).toEqual({
      accent1: "#AB12CD",
      accent2: "#00FF00",
    });
  });

  it("refuses an archive with no theme part or an empty one", async () => {
    await expect(
      importPowerPointTheme(
        await archiveWith({ "ppt/slides/slide1.xml": "<p/>" }),
      ),
    ).rejects.toThrow("The PowerPoint file has no theme XML.");
    await expect(
      importPowerPointTheme(await archiveWith({ "ppt/theme/theme1.xml": "" })),
    ).rejects.toThrow("The PowerPoint theme XML is empty.");
  });
});
