// The DevDocs importer's pure steps: HTML to Markdown, a page to a library
// item, and the NestJS source clean-up. Nothing here downloads a page or
// reads or writes the library's data file.
import { describe, expect, it } from "vitest";
import {
  DOCUMENTATION,
  decodeEntities,
  htmlToMarkdown,
  itemOf,
  nestMarkdown,
  slugOf,
  // @ts-expect-error: a plain .mjs script without types.
} from "./import-devdocs.mjs";

describe("the documentation sets", () => {
  it("each name a DevDocs slug, a library collection and a publisher, with no slug twice", () => {
    const slugs = DOCUMENTATION.map((each: { slug: string }) => each.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const each of DOCUMENTATION) {
      expect(each.slug).toMatch(/^[a-z0-9~._-]+$/);
      expect(each.collection).toMatch(/^[a-z0-9-]+$/);
      expect(each.publisher).not.toBe("");
    }
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hexadecimal entities", () => {
    expect(decodeEntities("a &lt; b &amp;&amp; c &gt; d")).toBe(
      "a < b && c > d",
    );
    expect(decodeEntities("&#39;x&#39; &#x2192; &quot;y&quot;")).toBe(
      "'x' → \"y\"",
    );
  });

  it("leaves a name it does not know as it was written", () => {
    expect(decodeEntities("&unknownname; &amp;")).toBe("&unknownname; &");
  });
});

describe("slugOf", () => {
  it("is lowercase words joined by single hyphens, with none at either end", () => {
    expect(slugOf("  Next.js: App Router / Caching!  ")).toBe(
      "next-js-app-router-caching",
    );
  });

  it("is at most 96 characters and never ends on a hyphen", () => {
    const slug = slugOf(`${"a".repeat(95)} ${"b".repeat(20)}`);
    expect(slug).toBe("a".repeat(95));
    expect(slugOf("a".repeat(200))).toHaveLength(96);
  });

  it("is empty for text with nothing to keep", () => {
    expect(slugOf("—!?")).toBe("");
  });
});

describe("htmlToMarkdown", () => {
  it("turns headings, paragraphs and inline marks into Markdown", () => {
    expect(
      htmlToMarkdown(
        '<h1>Caching</h1><p>Use <code>revalidate</code> for <strong>fresh</strong> and <em>fast</em> pages.</p><h2 id="x">Why</h2>',
      ),
    ).toBe(
      "# Caching\n\nUse `revalidate` for **fresh** and *fast* pages.\n\n## Why",
    );
  });

  it("turns list items into bullets", () => {
    expect(
      htmlToMarkdown("<ul><li>One</li><li>Two <code>2</code></li></ul>"),
    ).toBe("- One\n- Two `2`");
  });

  it("keeps a code block exactly, with its language, and decodes its entities", () => {
    expect(
      htmlToMarkdown(
        '<p>Before</p><pre data-language="ts"><span>const a = 1 &lt; 2;</span>\n  <b>if</b> (a) {}\n</pre><p>After</p>',
      ),
    ).toBe("Before\n\n```ts\nconst a = 1 < 2;\n  if (a) {}\n```\n\nAfter");
  });

  it("reads the language from a language- class when there is no data-language", () => {
    expect(htmlToMarkdown('<pre class="x language-js">let a;</pre>')).toBe(
      "```js\nlet a;\n```",
    );
  });

  it("turns a table into a Markdown table, padding short rows and escaping bars", () => {
    expect(
      htmlToMarkdown(
        "<table><tr><th>Option</th><th>Meaning</th></tr><tr><td>a|b</td><td>Either</td></tr><tr><td>c</td></tr></table>",
      ),
    ).toBe("| Option | Meaning |\n| --- | --- |\n| a\\|b | Either |\n| c |  |");
  });

  it("turns a blockquote into a quoted line", () => {
    expect(htmlToMarkdown("<blockquote><p>Good to know</p></blockquote>")).toBe(
      "> Good to know",
    );
  });

  it("drops scripts, styles, navigation, buttons and comments, and every other tag", () => {
    expect(
      htmlToMarkdown(
        '<nav><a href="/">Home</a></nav><script>alert(1)</script><style>p{}</style><!-- note --><button>Copy</button><p>Kept <span class="x">text</span> <a href="/docs">here</a>.</p>',
      ),
    ).toBe("Kept text here.");
  });
});

describe("itemOf", () => {
  const documentation = {
    slug: "nextjs",
    collection: "nextjs",
    publisher: "Next.js",
  };
  const entry = {
    name: "`use cache` &amp; friends",
    path: "app/caching",
    type: "App Router",
  };
  const page = `<h1>Caching</h1><p>${"Next.js caches rendered work and data requests to make pages fast. ".repeat(4)}</p>`;

  it("makes a published official reference that keeps its publisher, version and address", () => {
    const item = itemOf(documentation, "15.1", entry, page);
    expect(item).toMatchObject({
      slug: "nextjs-docs-app-caching",
      title: "Next.js: use cache & friends",
      contentType: "official-reference",
      collection: "nextjs",
      tags: ["nextjs", "official-docs", "app-router"],
      source: {
        publisher: "Next.js",
        canonicalUrl: "https://devdocs.io/nextjs/app/caching",
        official: true,
        version: "15.1",
      },
    });
    expect(item.source.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.body.startsWith("# Caching\n\n")).toBe(true);
  });

  it("summarises with the first real paragraph, bounded and without marks", () => {
    const item = itemOf(documentation, "15.1", entry, page);
    expect(item.summary.startsWith("Next.js caches rendered work")).toBe(true);
    expect(item.summary.length).toBeLessThanOrEqual(200);
    expect(item.summary).not.toMatch(/[`*]/);
  });

  it("gives a page with no heading its entry's name as the title line", () => {
    const item = itemOf(
      documentation,
      "15.1",
      entry,
      `<p>${"Plain words about caching. ".repeat(12)}</p>`,
    );
    expect(item.body.startsWith("# use cache & friends\n\n")).toBe(true);
  });

  it("leaves out the version when the set has none, and the section tag when the entry has none", () => {
    const item = itemOf(
      documentation,
      undefined,
      { ...entry, type: undefined },
      page,
    );
    expect(item.source).not.toHaveProperty("version");
    expect(item.tags).toEqual(["nextjs", "official-docs"]);
  });

  it("is nothing for a page with no real content (a redirect stub, an index of links)", () => {
    expect(itemOf(documentation, "15.1", entry, "<p>Moved.</p>")).toBeNull();
  });
});

describe("nestMarkdown", () => {
  it("keeps the TypeScript variant of a code block and names its file in a comment", () => {
    expect(
      nestMarkdown(
        "```typescript\n@@filename(cats.controller)\nexport class CatsController {}\n@@switch\nexport class CatsControllerJs {}\n```",
      ),
    ).toBe(
      "```typescript\n// cats.controller\nexport class CatsController {}\n```",
    );
  });

  it("raises headings two levels, so a page's sections sit under its title", () => {
    expect(nestMarkdown("### Controllers\n\n#### Routing\n\n## Kept")).toBe(
      "# Controllers\n\n## Routing\n\n## Kept",
    );
  });

  it("drops callout words, figures and site tags, and unlinks links within the site", () => {
    expect(
      nestMarkdown(
        '> info **Hint** Read on.\n\n<figure><img src="/a.png" /></figure>\n\n<app-banner-courses></app-banner-courses>\n\nSee [providers](/providers) and [this part](#scope), or [the site](https://nestjs.com).',
      ),
    ).toBe(
      "> **Hint** Read on.\n\nSee providers and this part, or [the site](https://nestjs.com).",
    );
  });
});
