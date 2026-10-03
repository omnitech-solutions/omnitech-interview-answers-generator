import { expect, it } from "vitest";
import { parseSlideBlocks, serializeSlideBlocks } from "./slide-blocks.js";

it("parses typed blocks, decoding entities and trimming text", () => {
  expect(
    parseSlideBlocks(
      '<SECTION layout="left"><h1> A &amp; B </h1><BULLETS>x;y</BULLETS><QUOTE>&lt;q&gt; &quot;z&quot;</QUOTE></SECTION>',
    ),
  ).toEqual([
    { type: "H1", text: "A & B" },
    { type: "BULLETS", text: "x;y" },
    { type: "QUOTE", text: '<q> "z"' },
  ]);
});

it("parses self-closing image references", () => {
  expect(
    parseSlideBlocks(
      '<SECTION><IMG url="https://x.test/a.png?a=1&amp;b=2" /></SECTION>',
    ),
  ).toEqual([{ type: "IMG", text: "https://x.test/a.png?a=1&b=2" }]);
  expect(parseSlideBlocks('<IMG query="a red barn"/>')).toEqual([
    { type: "IMG", text: "a red barn" },
  ]);
});

it("treats unstructured source as one paragraph of its text", () => {
  expect(parseSlideBlocks("<SECTION> just words </SECTION>")).toEqual([
    { type: "P", text: "just words" },
  ]);
});

it("serializes blocks into the source's layout, dropping empty ones and escaping text", () => {
  const xml = serializeSlideBlocks('<SECTION layout="right"></SECTION>', [
    { type: "H1", text: "Q&A <live>" },
    { type: "P", text: "   " },
    { type: "IMG", text: 'https://x.test/a.png?q="1"' },
  ]);
  expect(xml).toBe(
    '<SECTION layout="right"><H1>Q&amp;A &lt;live&gt;</H1><IMG url="https://x.test/a.png?q=&quot;1&quot;" /></SECTION>',
  );
  expect(parseSlideBlocks(xml)).toEqual([
    { type: "H1", text: "Q&A <live>" },
    { type: "IMG", text: 'https://x.test/a.png?q="1"' },
  ]);
  expect(serializeSlideBlocks("<SECTION></SECTION>", [])).toBe(
    '<SECTION layout="vertical"></SECTION>',
  );
});
