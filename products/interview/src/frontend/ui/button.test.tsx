import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "./index";

const variants = Object.keys(BUTTON_VARIANTS) as ButtonVariant[];
const sizes = Object.keys(BUTTON_SIZES) as ButtonSize[];

describe("Button", () => {
  it("is a real button that defaults to type=button, secondary and md", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-variant", "secondary");
    expect(button).toHaveAttribute("data-size", "md");
    expect(button).toHaveAttribute("data-state", "idle");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("lets the caller choose another type", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it.each(variants.flatMap((v) => sizes.map((s) => [v, s] as const)))(
    "renders variant %s at size %s",
    (variant, size) => {
      render(
        <Button variant={variant} size={size}>
          Go
        </Button>,
      );
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("data-variant", variant);
      expect(button).toHaveAttribute("data-size", size);
    },
  );

  it("covers the whole vocabulary", () => {
    expect(variants).toEqual([
      "primary",
      "secondary",
      "ghost",
      "destructive",
      "go",
      "link",
      "glass",
    ]);
    expect(sizes).toEqual(["sm", "md", "lg", "icon"]);
  });

  it("disables natively and ignores clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading disables, sets aria-busy, shows a spinner and ignores clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button loading icon="add" onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-state", "loading");
    expect(
      button.querySelector('[data-slot="button-spinner"]'),
    ).toHaveAttribute("aria-hidden", "true");
    // The spinner replaces the leading icon.
    expect(button.querySelectorAll("svg")).toHaveLength(0);
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pressed sets aria-pressed and data-state", () => {
    const { rerender } = render(<Button pressed>Wrap</Button>);
    const button = screen.getByRole("button", { name: "Wrap" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("data-state", "pressed");
    rerender(<Button pressed={false}>Wrap</Button>);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("data-state", "idle");
  });

  it("calls onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders icons left and right, hidden from assistive tech", () => {
    render(
      <Button icon="add" iconAfter="expand_more">
        Add
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Add" });
    const children = [...button.children];
    expect(children).toHaveLength(2);
    expect(children[0]?.tagName.toLowerCase()).toBe("svg");
    expect(children[1]?.tagName.toLowerCase()).toBe("svg");
    for (const icon of children)
      expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(button.firstChild).toBe(children[0]);
    expect(button.textContent).toBe("Add");
    expect(button.lastChild).toBe(children[1]);
  });

  it("forwards its ref and passes className and other attributes through", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} className="extra" aria-label="Close" title="Close">
        x
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole("button"));
    expect(ref.current).toHaveClass("extra");
    expect(ref.current).toHaveAttribute("title", "Close");
    expect(Button.displayName).toBe("Button");
  });

  describe("asChild", () => {
    it("renders the child element with the data attributes and no asChild leak", () => {
      const ref = createRef<HTMLAnchorElement>();
      render(
        <Button asChild variant="link" size="sm" icon="add" className="extra">
          <a href="/sign-in" ref={ref} className="own">
            Sign in
          </a>
        </Button>,
      );
      const link = screen.getByRole("link", { name: "Sign in" });
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/sign-in");
      expect(link).toHaveAttribute("data-slot", "button");
      expect(link).toHaveAttribute("data-variant", "link");
      expect(link).toHaveAttribute("data-size", "sm");
      expect(link).toHaveClass("own", "extra");
      expect(link).not.toHaveAttribute("type");
      expect(link).not.toHaveAttribute("asChild");
      expect(link).not.toHaveAttribute("aschild");
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(ref.current).toBe(link);
      expect(document.querySelector("button")).toBeNull();
    });

    it("an inert anchor keeps href but is aria-disabled, out of the tab order and ignores clicks", async () => {
      const onClick = vi.fn();
      render(
        <Button asChild disabled onClick={onClick}>
          <a href="/x">Go</a>
        </Button>,
      );
      const link = screen.getByRole("link", { name: "Go" });
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).toHaveAttribute("tabindex", "-1");
      await userEvent.click(link);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("renders nothing when the child is not an element", () => {
      const { container } = render(<Button asChild>text</Button>);
      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("ui.css and tokens.css", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const ui = strip(readFileSync(join(here, "ui.css"), "utf8"));
  const tokens = strip(readFileSync(join(here, "tokens.css"), "utf8"));

  it("ui.css writes no colour literal", () => {
    expect(ui).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ui).not.toMatch(/\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i);
  });

  it("ui.css writes no raw length, duration or opacity: only var(--ui-*)", () => {
    // No unit literal at all (0 has none; the circle radius is a percentage).
    expect(ui).not.toMatch(/\d(px|rem|em|pt|vh|vw|ms|s)\b/);
    const opacity = [...ui.matchAll(/opacity:\s*([^;]+);/g)].map((m) => m[1]);
    expect(opacity.length).toBeGreaterThan(0);
    for (const value of opacity) expect(value).toMatch(/^var\(--ui-/);
    // Every var() it reads is a --ui-* token.
    for (const [, name] of ui.matchAll(/var\((--[\w-]+)/g))
      expect(name).toMatch(/^--ui-/);
  });

  it.each(variants)("has a CSS rule and tokens for variant %s", (variant) => {
    expect(ui).toContain(`[data-variant="${variant}"]`);
    expect(tokens).toMatch(new RegExp(`--ui-${variant}-(bg|fg)\\s*:`));
  });

  it.each(sizes)("has a CSS rule for size %s", (size) => {
    expect(ui).toContain(`[data-size="${size}"]`);
    expect(tokens).toContain(BUTTON_SIZES[size].heightToken);
  });

  it("styles hover, focus-visible, disabled, loading and pressed", () => {
    expect(ui).toContain(":hover:not(:disabled)");
    expect(ui).toContain(":focus-visible");
    expect(ui).toContain(":disabled");
    expect(ui).toContain('[data-state="loading"]');
    expect(ui).toContain('[data-state="pressed"]');
  });

  it("every surface scope maps every colour role", () => {
    const roles = variants.flatMap((variant) =>
      variant === "link"
        ? ["--ui-link-fg", "--ui-link-fg-hover"]
        : ["bg", "fg", "border", "hover"].map((r) => `--ui-${variant}-${r}`),
    );
    roles.push("--ui-ghost-fg-hover", "--ui-glass-edge", "--ui-glass-blur");
    roles.push("--ui-focus-ring");
    const blocks = [...tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: (m[1] ?? "").trim(),
      body: m[2] ?? "",
    }));
    const scopes = [":root", ".studio-app .oa-host", ".ov-root", ".pn-root"];
    for (const scope of scopes) {
      const block = blocks.find((b) => b.selector.startsWith(scope));
      expect(block, scope).toBeDefined();
      for (const role of roles)
        expect(block?.body, `${scope} defines ${role}`).toContain(`${role}:`);
    }
    // The clear-glass scope exists.
    expect(tokens).toContain('.pn-root[data-glass="clear"]');
  });
});
