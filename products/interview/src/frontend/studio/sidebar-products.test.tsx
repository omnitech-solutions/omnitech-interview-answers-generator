import type { ProductLink } from "@omnitech/platform-contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const lists = {
  questions: [],
  briefings: [],
  briefs: [],
  status: "ready" as const,
  refresh: () => undefined,
};
const products: ProductLink[] = [
  {
    productId: "omnitech.interview",
    name: "Interview Studio",
    icon: "sparkles",
    href: "/t/acme/p/interview",
    current: true,
  },
  {
    productId: "omnitech.presentation",
    name: "Presentation Studio",
    icon: "presentation",
    href: "/t/acme/p/presentation",
    current: false,
  },
];

function renderSidebar(
  props: { products?: readonly ProductLink[]; mayLeave?: () => boolean } = {},
) {
  return render(
    <Sidebar
      view="home"
      artifact=""
      lists={lists}
      theme="light"
      onGo={() => undefined}
      onOpenArtifact={() => undefined}
      onOpenPalette={() => undefined}
      onToggleTheme={() => undefined}
      {...props}
    />,
  );
}

describe("the sidebar's products", () => {
  it("links the other installed products, never the current one", () => {
    renderSidebar({ products });
    const nav = screen.getByRole("navigation", { name: "Products" });
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Presentation Studio" }),
    ).toHaveAttribute("href", "/t/acme/p/presentation");
    expect(
      screen.queryByRole("link", { name: "Interview Studio" }),
    ).not.toBeInTheDocument();
  });

  it("shows no products section when there is nowhere else to go", () => {
    renderSidebar({ products: [products[0]!] });
    expect(
      screen.queryByRole("navigation", { name: "Products" }),
    ).not.toBeInTheDocument();
  });

  // Leaving the studio would discard unsaved interview preparation.
  it("asks before leaving, and stays when the person declines", () => {
    const mayLeave = vi.fn(() => false);
    renderSidebar({ products, mayLeave });
    const proceeded = fireEvent.click(
      screen.getByRole("link", { name: "Presentation Studio" }),
    );
    expect(mayLeave).toHaveBeenCalledOnce();
    expect(proceeded).toBe(false);
  });

  it("follows the link when leaving is fine", () => {
    renderSidebar({ products, mayLeave: () => true });
    expect(
      fireEvent.click(
        screen.getByRole("link", { name: "Presentation Studio" }),
      ),
    ).toBe(true);
  });
});
