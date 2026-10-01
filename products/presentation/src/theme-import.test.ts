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
});
