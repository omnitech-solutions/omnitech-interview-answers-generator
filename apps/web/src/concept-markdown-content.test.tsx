import { type ReactNode, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@oc-tech/omni-ui-components", () => ({
  Collapse: ({
    className,
    defaultActiveKey,
    items,
  }: {
    className?: string;
    defaultActiveKey?: string;
    items: Array<{ children: ReactNode; key: string; label: string }>;
  }) => {
    const [open, setOpen] = useState<string[]>([defaultActiveKey ?? ""]);
    return (
      <div className={className}>
        {items.map((item) => (
          <div key={item.key}>
            <button
              type="button"
              aria-expanded={open.includes(item.key)}
              onClick={() =>
                setOpen((current) =>
                  current.includes(item.key)
                    ? current.filter((key) => key !== item.key)
                    : [...current, item.key],
                )
              }
            >
              {item.label}
            </button>
            {open.includes(item.key) ? <div>{item.children}</div> : null}
          </div>
        ))}
      </div>
    );
  },
}));
import { ConceptMarkdownContent } from "./concept-markdown-content";

describe("ConceptMarkdownContent", () => {
  it("renders a simple answer directly with highlighted keywords and code", () => {
    const { container } = render(
      <ConceptMarkdownContent>
        {
          "# React rendering\n\n## Answer\n\n> **Answer:** React compares state during `Object.is` checks.\n\n## Usage example\n\n> **Example:** A setter with the same state can bail out."
        }
      </ConceptMarkdownContent>,
    );

    expect(screen.queryByRole("button", { name: /Question/ })).toBeNull();
    expect(container.querySelector(".markdown-keyword")).toHaveTextContent(
      "state",
    );
    expect(
      container.querySelector(".markdown-inline-code-highlighted"),
    ).toHaveTextContent("Object.is");
  });

  it("renders multipart questions as collapsible blue headers with answer panels", async () => {
    const user = userEvent.setup();
    render(
      <ConceptMarkdownContent>
        {
          "# Rendering\n\n## Questions\n\n### Question 1: What triggers it?\n\n> **Answer:** State.\n\n> **Example:** Call a setter.\n\n### Question 2: Does DOM always change?\n\n> **Answer:** No.\n\n> **Example:** Equal output commits nothing."
        }
      </ConceptMarkdownContent>,
    );

    expect(
      screen.getByRole("button", {
        name: "Question 1: What triggers it?",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    const second = screen.getByRole("button", {
      name: "Question 2: Does DOM always change?",
    });
    expect(second).toHaveAttribute("aria-expanded", "false");
    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Equal output commits nothing.")).toBeVisible();
  });

  it("renders a single numbered question as one collapse", () => {
    render(
      <ConceptMarkdownContent>
        {
          "# Rendering\n\n## Questions\n\n### Question #1: What triggers a render?\n\n- **Direct answer:** State, parents, and context.\n\n#### Talking points\n\n- Refs do not trigger renders."
        }
      </ConceptMarkdownContent>,
    );

    expect(
      screen.getByRole("button", {
        name: "Question #1: What triggers a render?",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Refs do not trigger renders.")).toBeVisible();
  });
});
