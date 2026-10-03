import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureNavigation,
  installFakeApi,
  Raw,
  routeScreen,
} from "./fake-api.js";

const docs = "/api/presentation/v1/documents";
const targets = "/api/platform/v1/ai-targets";

const summaries = [
  {
    id: "d-old",
    title: "Zebra review",
    revision: 2,
    slideCount: 3,
    favorite: false,
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "d-new",
    title: "Alpha roadmap",
    revision: 5,
    slideCount: 8,
    favorite: true,
    updatedAt: "2026-03-01T00:00:00Z",
  },
];

const aiTargets = [
  {
    id: "fast",
    label: "Fast",
    modelId: "m-fast",
    family: "direct-model",
    kind: "language",
    capabilities: [],
  },
  {
    id: "pic",
    label: "Picture",
    family: "direct-model",
    kind: "image",
    capabilities: [],
  },
  {
    id: "agent",
    label: "Agent",
    family: "agent",
    kind: "language",
    capabilities: [],
  },
];

async function mount(routeId: string, segments: string[] = []) {
  const { Screen, props } = await routeScreen(routeId, segments);
  return render(<Screen {...props} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("presentation library", () => {
  it("lists documents newest first and filters by search, favorites and title order", async () => {
    installFakeApi({
      [`GET ${docs}`]: summaries,
      [`GET ${targets}`]: aiTargets,
    });
    await mount("presentation.library");

    const links = async () =>
      (await screen.findAllByRole("link")).map((link) =>
        link.getAttribute("href"),
      );
    await waitFor(async () =>
      expect(await links()).toEqual([
        "/t/acme/p/presentation/editor/d-new",
        "/t/acme/p/presentation/editor/d-old",
      ]),
    );
    expect(screen.getByRole("link", { name: /Alpha roadmap/ })).toHaveAttribute(
      "href",
      "/t/acme/p/presentation/editor/d-new",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sort presentations by title" }),
    );
    expect(
      screen.getByRole("button", { name: "Sort presentations by title" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect((await links())[0]).toBe("/t/acme/p/presentation/editor/d-new");
    expect(screen.getByText("8 slides · revision 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "☆ Favorites" }));
    expect(screen.queryByText("Zebra review")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "▣ All" }));
    fireEvent.change(screen.getByLabelText("Search presentations"), {
      target: { value: "nothing" },
    });
    expect(
      screen.getByText("No presentations match this search or filter."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "☷ List" }));
    expect(screen.getByRole("button", { name: "☷ List" })).toHaveClass(
      "active",
    );
    fireEvent.click(screen.getByRole("button", { name: "▦ Grid" }));
    expect(screen.getByRole("button", { name: "▦ Grid" })).toHaveClass(
      "active",
    );
  });

  it("shows the empty state, and an alert when the list cannot load", async () => {
    installFakeApi({
      [`GET ${docs}`]: [],
      [`GET ${targets}`]: new Raw(500, "boom"),
    });
    await mount("presentation.library");
    expect(
      await screen.findByText("No presentations yet. Create one above."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("AI model")).toHaveDisplayValue(
      "AI unavailable",
    );
    cleanup();

    installFakeApi({
      [`GET ${docs}`]: new Raw(
        500,
        JSON.stringify({ error: "Database down." }),
      ),
    });
    await mount("presentation.library");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database down.",
    );
    cleanup();

    installFakeApi({ [`GET ${docs}`]: new Raw(502, "<html>") });
    await mount("presentation.library");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request failed (502).",
    );
    cleanup();

    installFakeApi({ [`GET ${docs}`]: new Raw(200, "<html>") });
    await mount("presentation.library");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server returned an invalid response.",
    );
  });

  it("toggles a favorite on the server and reports a failed update", async () => {
    const api = installFakeApi({
      [`GET ${docs}`]: summaries,
      [`GET ${targets}`]: aiTargets,
      [`PUT ${docs}/d-old/favorite`]: {},
      [`PUT ${docs}/d-new/favorite`]: new Raw(
        409,
        JSON.stringify({ error: "Locked." }),
      ),
    });
    await mount("presentation.library");

    fireEvent.click(
      await screen.findByRole("button", { name: "Add Zebra review favorite" }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Remove Zebra review favorite",
      }),
    ).toBeInTheDocument();
    expect(api.to("PUT", `${docs}/d-old/favorite`)[0]?.body).toEqual({
      enabled: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Alpha roadmap favorite" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Locked.");
    expect(
      screen.getByRole("button", { name: "Remove Alpha roadmap favorite" }),
    ).toBeInTheDocument();
  });

  it("falls back to a bare status when a favorite failure has no JSON body", async () => {
    installFakeApi({
      [`GET ${docs}`]: summaries,
      [`PUT ${docs}/d-old/favorite`]: new Raw(500, ""),
    });
    await mount("presentation.library");
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Zebra review favorite" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request failed (500).",
    );
  });

  it("hands the prompt and chosen options to the create screen", async () => {
    installFakeApi({
      [`GET ${docs}`]: summaries,
      [`GET ${targets}`]: aiTargets,
    });
    const assign = captureNavigation();
    window.localStorage.setItem("platform.aiProfileId", "fast");
    await mount("presentation.library");

    expect(
      await screen.findByRole("option", { name: "Fast · m-fast" }),
    ).toBeInTheDocument();
    // Only direct-model language targets are offered.
    expect(screen.queryByRole("option", { name: /Picture/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Agent/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Presentation prompt"), {
      target: { value: "  Quarterly results  " },
    });
    fireEvent.change(screen.getByLabelText("Slide count"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("Presentation layout"), {
      target: { value: "minimal" },
    });
    fireEvent.change(screen.getByLabelText("Presentation language"), {
      target: { value: "French" },
    });
    fireEvent.change(screen.getByLabelText("AI model"), {
      target: { value: "fast" },
    });
    expect(window.localStorage.getItem("platform.aiProfileId")).toBe("fast");

    fireEvent.click(
      screen.getByRole("button", { name: "Create presentation" }),
    );
    expect(assign).toHaveBeenCalledWith("/t/acme/p/presentation/create");
    expect(
      JSON.parse(
        window.sessionStorage.getItem("presentation.create-settings") ?? "{}",
      ),
    ).toEqual({
      prompt: "Quarterly results",
      slideCount: 15,
      layout: "minimal",
      language: "French",
      targetId: "fast",
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ Create new" }));
    expect(assign).toHaveBeenCalledTimes(3);
  });
});

describe("presentation create", () => {
  const savedSettings = {
    prompt: "Launch plan. Details follow.",
    slideCount: 5,
    layout: "classic",
    language: "Spanish",
    targetId: "fast",
  };

  it("prefills from the library hand-off, drafts an outline and creates the document", async () => {
    window.sessionStorage.setItem(
      "presentation.create-settings",
      JSON.stringify(savedSettings),
    );
    const api = installFakeApi({
      [`GET ${targets}`]: aiTargets,
      "POST /api/presentation/v1/generate/outline": {
        result: { title: "Launch Plan", outline: ["Why", "How"] },
      },
      [`POST ${docs}`]: { id: "doc-9" },
    });
    const assign = captureNavigation();
    await mount("presentation.create");

    expect(screen.getByLabelText("Presentation title")).toHaveValue(
      "Launch plan",
    );
    expect(screen.getByLabelText("Presentation prompt")).toHaveValue(
      savedSettings.prompt,
    );
    expect(screen.getByLabelText("Slide count")).toHaveValue("5");
    expect(
      window.sessionStorage.getItem("presentation.create-settings"),
    ).toBeNull();
    await screen.findByRole("option", { name: "Fast · m-fast" });

    fireEvent.click(screen.getByRole("button", { name: "✣ Generate Outline" }));
    expect(await screen.findByText("Outline ready.")).toBeInTheDocument();
    expect(screen.getByLabelText("Presentation title")).toHaveValue(
      "Launch Plan",
    );
    expect(
      api.to("POST", "/api/presentation/v1/generate/outline")[0]?.body,
    ).toMatchObject({
      prompt: savedSettings.prompt,
      profileId: "fast",
      slideCount: 5,
      language: "Spanish",
      layout: "classic",
    });

    fireEvent.change(screen.getByLabelText("Slide 2 outline"), {
      target: { value: "How, precisely" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create presentation" }),
    );
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "/t/acme/p/presentation/editor/doc-9",
      ),
    );
    const created = api.to("POST", docs)[0]?.body as {
      title: string;
      outline: string[];
      settings: Record<string, unknown>;
      idempotencyKey: string;
    };
    expect(created.title).toBe("Launch Plan");
    expect(created.outline).toEqual(["Why", "How, precisely"]);
    expect(created.settings).toMatchObject({
      theme: "ebony",
      targetId: "fast",
    });
    expect(created.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
  });

  it("lets the user pick density, audience and theme before generating", async () => {
    const api = installFakeApi({
      [`GET ${targets}`]: aiTargets,
      "POST /api/presentation/v1/generate/outline": { result: {} },
    });
    await mount("presentation.create");
    expect(
      screen.getByRole("button", { name: "✣ Generate Outline" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Presentation prompt"), {
      target: { value: "Cloud costs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));
    fireEvent.change(screen.getByLabelText("Tone"), {
      target: { value: "Business" },
    });
    fireEvent.change(screen.getByLabelText("Audience"), {
      target: { value: "Investor" },
    });
    fireEvent.change(screen.getByLabelText("Scenario"), {
      target: { value: "Teacher" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Mystique/ }));
    expect(screen.getByRole("button", { name: /Mystique/ })).toHaveClass(
      "selected",
    );
    fireEvent.change(screen.getByLabelText("Presentation layout"), {
      target: { value: "minimal" },
    });
    fireEvent.change(screen.getByLabelText("Presentation language"), {
      target: { value: "French" },
    });
    fireEvent.change(screen.getByLabelText("Slide count"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "⟳ Regenerate" }));
    await screen.findByText("Outline ready.");

    expect(
      api.to("POST", "/api/presentation/v1/generate/outline")[0]?.body,
    ).toEqual({
      prompt: "Cloud costs",
      profileId: "document-fast",
      slideCount: 20,
      language: "French",
      layout: "minimal",
      textContent: "detailed",
      tone: "Business",
      audience: "Investor",
      scenario: "Teacher",
    });
    // An empty outline keeps the create button hidden.
    expect(
      screen.queryByRole("button", { name: "Create presentation" }),
    ).toBeNull();
  });

  it("persists the chosen AI model and ignores corrupt hand-off data", async () => {
    window.sessionStorage.setItem("presentation.create-settings", "{not json");
    installFakeApi({ [`GET ${targets}`]: aiTargets });
    const heard = vi.fn();
    window.addEventListener("platform-ai-profile-change", heard);
    await mount("presentation.create");
    await screen.findByRole("option", { name: "Fast · m-fast" });
    expect(
      window.sessionStorage.getItem("presentation.create-settings"),
    ).toBeNull();
    expect(screen.getByLabelText("Presentation title")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("AI model"), {
      target: { value: "fast" },
    });
    expect(window.localStorage.getItem("platform.aiProfileId")).toBe("fast");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("platform-ai-profile-change", heard);
  });

  it("reports generation and creation failures without losing the form", async () => {
    window.sessionStorage.setItem(
      "presentation.create-settings",
      JSON.stringify({ prompt: "Plan" }),
    );
    installFakeApi({
      [`GET ${targets}`]: new Raw(500, "x"),
      "POST /api/presentation/v1/generate/outline": new Raw(
        503,
        JSON.stringify({ error: "No model configured." }),
      ),
      [`POST ${docs}`]: new Raw(400, JSON.stringify({ error: "Bad title." })),
    });
    const assign = captureNavigation();
    await mount("presentation.create");

    fireEvent.click(screen.getByRole("button", { name: "✣ Generate Outline" }));
    expect(await screen.findByText("No model configured.")).toBeInTheDocument();
    expect(screen.getByLabelText("Presentation prompt")).toHaveValue("Plan");
    expect(screen.queryByLabelText("Slide 1 outline")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("reports a failed document creation and stays on the page", async () => {
    window.sessionStorage.setItem(
      "presentation.create-settings",
      JSON.stringify({ prompt: "Plan" }),
    );
    installFakeApi({
      [`GET ${targets}`]: aiTargets,
      "POST /api/presentation/v1/generate/outline": {
        result: { outline: ["One"] },
      },
      [`POST ${docs}`]: new Raw(400, JSON.stringify({ error: "Bad title." })),
    });
    const assign = captureNavigation();
    await mount("presentation.create");
    fireEvent.click(screen.getByRole("button", { name: "✣ Generate Outline" }));
    await screen.findByLabelText("Slide 1 outline");
    fireEvent.click(
      screen.getByRole("button", { name: "Create presentation" }),
    );
    expect(await screen.findByText("Bad title.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
