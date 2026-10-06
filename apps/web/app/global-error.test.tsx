// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

describe("the global error page", () => {
  // AGENTS rule 8: an error's text and digest can quote content.
  it("shows a fixed message, never the error text or its digest", () => {
    const error = Object.assign(new Error("prompt SECRET-PROMPT-TEXT leaked"), {
      digest: "DIGEST-1234",
    });
    const page = GlobalError({ error, reset: vi.fn() });
    // The element tree carries every string the page would render.
    const html = JSON.stringify(page);
    expect(page.type).toBe("html");
    expect(page.props.lang).toBe("en");
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("SECRET-PROMPT-TEXT");
    expect(html).not.toContain("DIGEST-1234");
  });

  it("offers a retry that calls reset", () => {
    const reset = vi.fn();
    const onClicks: Array<() => void> = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const element = node as {
        type?: unknown;
        props?: { onClick?: () => void; children?: unknown };
      };
      if (element.type === "button" && element.props?.onClick)
        onClicks.push(element.props.onClick);
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children])
        walk(child);
    };
    walk(GlobalError({ error: new Error("x"), reset }));
    expect(onClicks).toHaveLength(1);
    onClicks[0]?.();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
