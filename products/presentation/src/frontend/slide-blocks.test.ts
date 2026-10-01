import { describe, expect, it } from "vitest";
import { parseSlideBlocks, serializeSlideBlocks } from "./slide-blocks.js";

describe("presentation slide blocks", () => {
  it("parses supported XML blocks and preserves their text", () => {
    expect(
      parseSlideBlocks(
        '<SECTION layout="left"><H1>Plan &amp; ship</H1><P>One step</P></SECTION>',
      ),
    ).toEqual([
      { type: "H1", text: "Plan & ship" },
      { type: "P", text: "One step" },
    ]);
  });

  it("serializes edited blocks into the existing section contract", () => {
    expect(
      serializeSlideBlocks('<SECTION layout="right"></SECTION>', [
        { type: "H2", text: "A <safe> heading" },
      ]),
    ).toBe('<SECTION layout="right"><H2>A &lt;safe&gt; heading</H2></SECTION>');
  });

  it("preserves diagram and visual data blocks", () => {
    const source =
      '<SECTION layout="vertical"><CHART>{"labels":["Q1"],"values":[4]}</CHART><DIAGRAM>{"nodes":["Input","Output"]}</DIAGRAM><INFOGRAPHIC>{"metric":"42%"}</INFOGRAPHIC></SECTION>';
    expect(parseSlideBlocks(source)).toEqual([
      { type: "CHART", text: '{"labels":["Q1"],"values":[4]}' },
      { type: "DIAGRAM", text: '{"nodes":["Input","Output"]}' },
      { type: "INFOGRAPHIC", text: '{"metric":"42%"}' },
    ]);
    expect(serializeSlideBlocks(source, parseSlideBlocks(source))).toContain(
      "<DIAGRAM>",
    );
  });
});

it("keeps images in their original position between text blocks", () => {
  expect(
    parseSlideBlocks(
      '<SECTION><H1>Title</H1><IMG url="data:image/png;base64,abc" /><P>Caption</P></SECTION>',
    ).map((block) => block.type),
  ).toEqual(["H1", "IMG", "P"]);
});
