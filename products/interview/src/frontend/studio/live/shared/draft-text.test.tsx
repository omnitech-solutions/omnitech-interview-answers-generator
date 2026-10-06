// A drafted answer is Markdown point form the model wrote: bullets and **bold**
// only. Everything else (HTML, links, images, headings, code) stays inert text.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DraftPoints, InlineBold, plainDraft } from "./draft-text";

afterEach(cleanup);

const SCRIPT = "<script>window.__pwned = true</script>";

describe("InlineBold", () => {
  it("renders **term** as strong and everything else as text", () => {
    const { container } = render(
      <p>
        <InlineBold text="Use **idempotency keys** and **retries**, not guesses" />
      </p>,
    );
    expect(
      [...container.querySelectorAll("strong")].map((el) => el.textContent),
    ).toEqual(["idempotency keys", "retries"]);
    expect(container.textContent).toBe(
      "Use idempotency keys and retries, not guesses",
    );
  });

  it("leaves unbalanced or empty markers as literal text", () => {
    const { container } = render(
      <p>
        <InlineBold text="an unclosed **marker, nothing else" />
      </p>,
    );
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("an unclosed **marker, nothing else");
  });

  it("keeps script and HTML inside bold as inert text", () => {
    const { container } = render(
      <p>
        <InlineBold text={`**${SCRIPT}** <b>x</b>`} />
      </p>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe(SCRIPT);
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned,
    ).toBeUndefined();
  });
});

describe("DraftPoints", () => {
  const draft = [
    "- **Situation:** led the **PHP to Laravel** move",
    "- **Result:** **80%** less scaffolding",
    "",
    "Say it plainly.",
  ].join("\n");

  it("renders bullets as a list with bold key terms and prose as a paragraph", () => {
    const { container } = render(<DraftPoints text={draft} />);
    const items = [...container.querySelectorAll("ul > li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "Situation: led the PHP to Laravel move",
      "Result: 80% less scaffolding",
    ]);
    expect(
      [...container.querySelectorAll("li strong")].map((el) => el.textContent),
    ).toEqual(["Situation:", "PHP to Laravel", "Result:", "80%"]);
    expect(container.querySelector("p")?.textContent).toBe("Say it plainly.");
  });

  it("accepts * and numbered markers as bullets", () => {
    const { container } = render(<DraftPoints text={"* one\n2. two"} />);
    expect(
      [...container.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["one", "two"]);
  });

  it("renders old plain paragraphs unchanged", () => {
    const { container } = render(<DraftPoints text={"First.\n\nSecond."} />);
    expect(
      [...container.querySelectorAll("p")].map((p) => p.textContent),
    ).toEqual(["First.", "Second."]);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("makes script, HTML, links, images, headings and code inert", () => {
    const hostile = [
      `- ${SCRIPT}`,
      '- <img src="https://x.test/p.png" onerror="alert(1)">',
      "- [click](https://x.test) ![pic](https://x.test/i.png)",
      "# Heading",
      "```js\nalert(1)\n```",
    ].join("\n");
    const { container } = render(<DraftPoints text={hostile} />);
    for (const selector of [
      "script",
      "img",
      "a",
      "h1",
      "pre",
      "code",
      "iframe",
    ])
      expect(container.querySelector(selector)).toBeNull();
    expect(container.textContent).toContain(SCRIPT);
    expect(container.textContent).toContain("[click](https://x.test)");
    expect(container.textContent).toContain("# Heading");
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned,
    ).toBeUndefined();
  });
});

describe("plainDraft", () => {
  it("drops the bold markers and keeps the points for copying", () => {
    expect(plainDraft("- **Notice period:** two weeks\n- plain")).toBe(
      "- Notice period: two weeks\n- plain",
    );
  });
  it("leaves unbalanced markers alone", () => {
    expect(plainDraft("a ** b")).toBe("a ** b");
  });
});
