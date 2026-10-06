import type { ProductMember } from "@omnitech/platform-contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./sidebar";

const lists = {
  questions: [],
  briefings: [],
  briefs: [],
  status: "ready" as const,
  refresh: () => undefined,
};

const renderSidebar = (member?: ProductMember) =>
  render(
    <Sidebar
      view="home"
      artifact="main"
      lists={lists}
      theme="dark"
      onGo={() => undefined}
      onOpenArtifact={() => undefined}
      onOpenPalette={() => undefined}
      onToggleTheme={() => undefined}
      tenant="acme"
      {...(member ? { member } : {})}
    />,
  );

describe("the sidebar's footer", () => {
  it("names the signed-in member and keeps the theme toggle beside the account", () => {
    renderSidebar({
      name: "Alex Morgan",
      email: "alex@example.test",
      kind: "account",
      canSignOut: true,
    });
    expect(
      screen.getByRole("button", { name: "Account: Alex Morgan" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Local user")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use light theme" }),
    ).toBeInTheDocument();
  });

  it("without a member keeps the plain local-user footer and no menu", () => {
    renderSidebar();
    expect(screen.getByText("Local user")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Account/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use light theme" }),
    ).toBeInTheDocument();
  });
});
