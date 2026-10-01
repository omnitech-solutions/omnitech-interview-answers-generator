import type {
  PresentationDocument,
  PresentationTheme,
} from "./domain/index.js";

export type ParityFixtureName =
  | "blank"
  | "ai"
  | "custom-theme"
  | "imported-theme"
  | "diagram"
  | "infographic"
  | "image"
  | "shared"
  | "recorded-exported";

export interface PresentationParityFixture {
  name: ParityFixtureName;
  document: PresentationDocument;
  theme?: PresentationTheme;
  imageDataUrl?: string;
  shareToken?: string;
  recordingDataUrl?: string;
}

const baseDocument = (
  title: string,
  sourceXml: string,
): PresentationDocument => ({
  id: `fixture-${title.toLowerCase().replaceAll(" ", "-")}`,
  title,
  revision: 1,
  slideCount: 1,
  favorite: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  outline: [title],
  themeId: null,
  settings: {},
  slides: [
    {
      id: "fixture-slide",
      position: 0,
      sourceXml,
      content: {},
      revision: 1,
    },
  ],
});

const theme = (
  id: string,
  name: string,
  builtIn: boolean,
): PresentationTheme => ({
  id,
  name,
  description: `${name} parity fixture`,
  builtIn,
  definition: {
    background: "#FFFFFF",
    text: "#111827",
    accent: "#4F46E5",
    fonts: { heading: "Aptos Display", body: "Aptos" },
  },
  favorite: false,
  liked: false,
});

/** Representative product states used to keep the clone honest as features evolve. */
export function createParityFixtures(): readonly PresentationParityFixture[] {
  const imageDataUrl = "data:image/svg+xml;base64,PHN2Zy8+";
  return [
    {
      name: "blank",
      document: baseDocument(
        "Blank presentation",
        '<SECTION layout="vertical"><H1>New presentation</H1><P>Add your content</P></SECTION>',
      ),
    },
    {
      name: "ai",
      document: baseDocument(
        "AI presentation",
        '<SECTION layout="vertical"><H1>AI generated outline</H1><BULLETS>Problem\nStrategy\nOutcome</BULLETS></SECTION>',
      ),
    },
    {
      name: "custom-theme",
      document: baseDocument(
        "Custom theme presentation",
        '<SECTION layout="vertical"><H1>Custom theme</H1></SECTION>',
      ),
      theme: theme("fixture-custom-theme", "Custom theme", false),
    },
    {
      name: "imported-theme",
      document: baseDocument(
        "Imported theme presentation",
        '<SECTION layout="vertical"><H1>Imported theme</H1></SECTION>',
      ),
      theme: theme(
        "fixture-imported-theme",
        "Imported PowerPoint theme",
        false,
      ),
    },
    {
      name: "diagram",
      document: baseDocument(
        "Diagram presentation",
        '<SECTION layout="vertical"><H1>Request flow</H1><DIAGRAM>Client -> API -> Worker</DIAGRAM></SECTION>',
      ),
    },
    {
      name: "infographic",
      document: baseDocument(
        "Infographic presentation",
        '<SECTION layout="vertical"><H1>Results</H1><INFOGRAPHIC>Faster|Safer|Clearer</INFOGRAPHIC></SECTION>',
      ),
    },
    {
      name: "image",
      document: baseDocument(
        "Image presentation",
        `<SECTION layout="vertical"><H1>Visual</H1><IMG url="${imageDataUrl}" /></SECTION>`,
      ),
      imageDataUrl,
    },
    {
      name: "shared",
      document: baseDocument(
        "Shared presentation",
        '<SECTION layout="vertical"><H1>Public review</H1></SECTION>',
      ),
      shareToken: "fixture-share-token-0123456789abcdef",
    },
    {
      name: "recorded-exported",
      document: baseDocument(
        "Recorded presentation",
        '<SECTION layout="vertical"><H1>Recorded walkthrough</H1><P>Export-ready content</P></SECTION>',
      ),
      recordingDataUrl: "data:video/webm;base64,AAAA",
    },
  ];
}
