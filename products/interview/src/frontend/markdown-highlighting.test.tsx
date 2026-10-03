import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";

// [DOMAIN] Every language an answer, brief or reference may show, by the
// name an author writes on the fence (aliases included).
const FENCES = [
  ["ts", "const total: number = 1;"],
  ["tsx", "const view = <p>{total}</p>;"],
  ["js", "const total = 1;"],
  ["jsx", "const view = <p>{total}</p>;"],
  ["react", "export function Counter() { return null; }"],
  ["php", "<?php $total = array_sum([1, 2]);"],
  ["rb", "total = [1, 2].sum"],
  ["json", '{ "total": 1 }'],
  ["sh", "echo $TOTAL"],
  ["sql", "SELECT count(*) FROM orders;"],
  ["html", "<p class='total'>1</p>"],
  ["css", ".total { color: red; }"],
  ["yml", "total: 1"],
  ["diff", "- old\n+ new"],
  ["py", "total = sum([1, 2])"],
] as const;

describe("code highlighting", () => {
  it.each(FENCES)("colours %s code", async (language, source) => {
    const { container } = render(
      <MarkdownContent>{`\`\`\`${language}\n${source}\n\`\`\``}</MarkdownContent>,
    );
    // Highlighted code has tokens in more than one colour; plain text has one.
    const colours = () =>
      new Set(
        [...container.querySelectorAll(".shiki span[style]")].map((span) =>
          span.getAttribute("style"),
        ),
      ).size;
    await waitFor(() => expect(colours()).toBeGreaterThan(1), {
      timeout: 10_000,
    });
  });

  it("shows a language it does not know as plain text", async () => {
    const { container } = render(
      <MarkdownContent>{"```cobol\nDISPLAY 'TOTAL'.\n```"}</MarkdownContent>,
    );
    await waitFor(() =>
      expect(container.querySelector(".shiki")).not.toBeNull(),
    );
    expect(container.querySelector(".shiki")?.textContent).toContain(
      "DISPLAY 'TOTAL'.",
    );
    expect(
      new Set(
        [...container.querySelectorAll(".shiki span[style]")].map((span) =>
          span.getAttribute("style"),
        ),
      ).size,
    ).toBeLessThanOrEqual(1);
  });
});
