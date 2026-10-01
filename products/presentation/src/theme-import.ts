import JSZip from "jszip";

export interface ImportedPresentationTheme {
  name: string;
  description: string;
  definition: Readonly<Record<string, unknown>>;
}

function attribute(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`\\b${name}="([^"]+)"`, "i"));
  return match?.[1];
}

function color(xml: string, slot: string): string | undefined {
  const match = xml.match(
    new RegExp(`<a:${slot}[^>]*>[\\s\\S]*?<a:(?:srgbClr|sysClr)[^>]*>`, "i"),
  );
  const value = match?.[0];
  if (!value) return undefined;
  const raw = attribute(value, "val") ?? attribute(value, "lastClr");
  return raw ? `#${raw.replace(/^#/, "").toUpperCase()}` : undefined;
}

function font(
  xml: string,
  slot: "majorFont" | "minorFont",
): string | undefined {
  const match = xml.match(
    new RegExp(`<a:${slot}[\\s\\S]*?<a:latin[^>]*>`, "i"),
  );
  return match ? attribute(match[0], "typeface") : undefined;
}

/** Extract the stable color/font portion of an OOXML PowerPoint theme. */
export async function importPowerPointTheme(
  input: Uint8Array,
  name = "Imported PowerPoint theme",
): Promise<ImportedPresentationTheme> {
  const zip = await JSZip.loadAsync(input);
  const themeEntry = Object.keys(zip.files).find((path) =>
    /^ppt\/theme\/theme\d+\.xml$/i.test(path),
  );
  if (!themeEntry) throw new Error("The PowerPoint file has no theme XML.");
  const xml = await zip.file(themeEntry)?.async("string");
  if (!xml) throw new Error("The PowerPoint theme XML is empty.");

  const definition = {
    background: color(xml, "lt1") ?? "#FFFFFF",
    text: color(xml, "dk1") ?? "#111827",
    accent: color(xml, "accent1") ?? "#4F46E5",
    accents: Object.fromEntries(
      ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
        .map((slot) => [slot, color(xml, slot)])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
    fonts: {
      heading: font(xml, "majorFont") ?? "Aptos Display",
      body: font(xml, "minorFont") ?? "Aptos",
    },
  };
  return {
    name,
    description: `Imported from ${themeEntry}`,
    definition,
  };
}
