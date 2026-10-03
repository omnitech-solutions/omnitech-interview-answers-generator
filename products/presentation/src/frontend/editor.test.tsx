import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureNavigation,
  installFakeApi,
  Raw,
  routeScreen,
  sampleDocument,
} from "./fake-api.js";

const docs = "/api/presentation/v1/documents";
const doc = `${docs}/doc-1`;

async function openEditor(routes: Record<string, unknown> = {}) {
  const api = installFakeApi({
    [`GET ${doc}`]: sampleDocument(),
    "GET /api/presentation/v1/images": [],
    "GET /api/presentation/v1/themes": [],
    ...routes,
  });
  const { Screen, props } = await routeScreen("presentation.editor", [
    "editor",
    "doc-1",
  ]);
  const view = render(<Screen {...props} />);
  await screen.findByLabelText("Presentation title");
  return { api, ...view };
}

const slideIds = (container: HTMLElement) =>
  [...container.querySelectorAll("article[data-slide-id]")].map((card) =>
    card.getAttribute("data-slide-id"),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("presentation editor: opening", () => {
  it("offers the library when no presentation is selected", async () => {
    installFakeApi({});
    const { Screen, props } = await routeScreen("presentation.editor", [
      "editor",
    ]);
    render(<Screen {...props} />);
    expect(
      screen.getByRole("link", { name: "Open presentation library" }),
    ).toHaveAttribute("href", "/t/acme/p/presentation/library");
  });

  it("shows the server's reason when the presentation cannot be loaded", async () => {
    installFakeApi({
      [`GET ${doc}`]: new Raw(404, JSON.stringify({ error: "Not found." })),
    });
    const { Screen, props } = await routeScreen("presentation.editor", [
      "editor",
      "doc-1",
    ]);
    render(<Screen {...props} />);
    expect(await screen.findByText("Not found.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Loading…" }),
    ).toBeInTheDocument();
  });

  it("renders every slide in the rail and canvas with the first selected", async () => {
    const { container } = await openEditor();
    expect(slideIds(container)).toEqual(["s1", "s2"]);
    expect(screen.getByLabelText("Select slide 1")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByLabelText("Presentation title")).toHaveValue("Roadmap");
    expect(screen.getByRole("link", { name: "Present" })).toHaveAttribute(
      "href",
      "/t/acme/p/presentation/present/doc-1",
    );
    // Only the selected slide has the block editor open.
    expect(screen.getAllByLabelText("Rich text content")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Select slide 2"));
    expect(screen.getAllByLabelText("Rich text content")).toHaveLength(1);
    expect(screen.getByLabelText("Select slide 2")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("presentation editor: slide editing", () => {
  it("keeps an edit local until Save slide, then sends the slide and clears the unsaved warning", async () => {
    const { api } = await openEditor({
      [`PUT ${doc}/slides`]: { id: "s1", revision: 2 },
    });
    const warn = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(warn()).toBe(false);

    fireEvent.change(screen.getAllByLabelText("Rich text content")[1]!, {
      target: { value: "Hello team" },
    });
    expect(
      screen.getAllByText("Unsaved changes. Save slide to keep this edit.")
        .length,
    ).toBeGreaterThan(0);
    expect(warn()).toBe(true);
    expect(api.to("PUT", `${doc}/slides`)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Save slide" }));
    await waitFor(() => expect(warn()).toBe(false));
    expect(api.to("PUT", `${doc}/slides`)[0]?.body).toMatchObject({
      id: "s1",
      sourceXml:
        '<SECTION layout="vertical"><H1>Intro</H1><P>Hello team</P></SECTION>',
    });
    expect(screen.getAllByText("Saved.").length).toBeGreaterThan(0);
  });

  it("reports a save failure and keeps the edit", async () => {
    await openEditor({
      [`PUT ${doc}/slides`]: new Raw(
        409,
        JSON.stringify({ error: "Slide changed elsewhere." }),
      ),
    });
    fireEvent.change(screen.getAllByLabelText("Rich text content")[1]!, {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save slide" }));
    expect(
      (await screen.findAllByText("Slide changed elsewhere.")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Rich text content")[1]).toHaveValue(
      "Mine",
    );
  });

  it("changes block types and adds a block through the block editor", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Block 2 type"), {
      target: { value: "QUOTE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add content block" }));
    expect(
      screen
        .getAllByLabelText("Rich text content")
        .map((area) => (area as HTMLTextAreaElement).value),
    ).toEqual(["Intro", "Hello", "New paragraph"]);
  });

  it("adds a new slide as a draft that must be saved", async () => {
    const { container, api } = await openEditor({
      [`PUT ${doc}/slides`]: (request: { body: { id: string } }) => ({
        id: request.body.id,
        revision: 1,
      }),
    });
    fireEvent.click(screen.getByLabelText("Add slide"));
    expect(slideIds(container)).toHaveLength(3);
    expect(screen.getByLabelText("Select slide 3")).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save slide" }));
    await waitFor(() => expect(api.to("PUT", `${doc}/slides`)).toHaveLength(1));
    expect(api.to("PUT", `${doc}/slides`)[0]?.body).toMatchObject({
      position: 2,
      sourceXml: expect.stringContaining("New slide"),
    });
  });

  it("deletes a saved slide and refreshes the revision", async () => {
    let revision = 3;
    const { container, api } = await openEditor({
      [`GET ${doc}`]: () => sampleDocument({ revision }),
      [`DELETE ${doc}/slides/s1`]: () => {
        revision = 4;
        return {};
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    expect(await screen.findAllByText("Slide deleted.")).not.toHaveLength(0);
    expect(api.to("DELETE", `${doc}/slides/s1`)).toHaveLength(1);
    expect(slideIds(container)).toEqual(["s2"]);
    // The last remaining slide cannot be deleted.
    expect(screen.getByRole("button", { name: "Delete slide" })).toBeDisabled();
  });

  it("refuses to delete a slide with unsaved changes", async () => {
    const { api } = await openEditor();
    fireEvent.change(screen.getAllByLabelText("Rich text content")[0]!, {
      target: { value: "Edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    expect(
      await screen.findAllByText("Save slide changes before deleting."),
    ).not.toHaveLength(0);
    expect(api.to("DELETE", `${doc}/slides/s1`)).toHaveLength(0);
  });

  it("reports a failed delete", async () => {
    const { container } = await openEditor({
      [`DELETE ${doc}/slides/s1`]: new Raw(
        403,
        JSON.stringify({ error: "Read only." }),
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    expect(await screen.findAllByText("Read only.")).not.toHaveLength(0);
    expect(slideIds(container)).toEqual(["s1", "s2"]);
  });

  it("moves a slide and sends the new position", async () => {
    const { container, api } = await openEditor({
      [`PATCH ${doc}/slides/s2`]: {},
    });
    expect(screen.getByLabelText("Move slide 1 up")).toBeDisabled();
    expect(screen.getByLabelText("Move slide 2 down")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Move slide 2 up"));
    expect(await screen.findAllByText("Slide moved.")).not.toHaveLength(0);
    expect(api.to("PATCH", `${doc}/slides/s2`)[0]?.body).toEqual({
      position: 0,
    });
    expect(slideIds(container)).toEqual(["s2", "s1"]);
  });

  it("refuses to reorder while slide changes are unsaved, and reports a failed move", async () => {
    await openEditor({
      [`PATCH ${doc}/slides/s1`]: new Raw(500, ""),
    });
    fireEvent.click(screen.getByLabelText("Move slide 1 down"));
    expect(
      await screen.findAllByText("Request failed (500)."),
    ).not.toHaveLength(0);

    fireEvent.change(screen.getAllByLabelText("Rich text content")[0]!, {
      target: { value: "Dirty" },
    });
    fireEvent.click(screen.getByLabelText("Move slide 1 down"));
    expect(
      await screen.findAllByText("Save slide changes before reordering."),
    ).not.toHaveLength(0);
  });

  it("undoes and redoes edits from the menu", async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    const menu = within(screen.getByLabelText("Presentation menu"));
    expect(menu.getByRole("button", { name: "↶ Undo" })).toBeDisabled();

    fireEvent.change(screen.getAllByLabelText("Rich text content")[1]!, {
      target: { value: "Changed" },
    });
    fireEvent.click(menu.getByRole("button", { name: "↶ Undo" }));
    expect(screen.getAllByLabelText("Rich text content")[1]).toHaveValue(
      "Hello",
    );
    expect(menu.getByRole("button", { name: "↷ Redo" })).toBeEnabled();

    fireEvent.click(menu.getByRole("button", { name: "↷ Redo" }));
    expect(screen.getAllByLabelText("Rich text content")[1]).toHaveValue(
      "Changed",
    );
  });
});

describe("presentation editor: document settings", () => {
  it("saves a renamed title on blur with the loaded revision", async () => {
    const { api } = await openEditor({ [`PATCH ${doc}`]: { revision: 4 } });
    const title = screen.getByLabelText("Presentation title");
    fireEvent.change(title, { target: { value: "Roadmap 2027" } });
    fireEvent.blur(title);
    expect((await screen.findAllByText("Saved.")).length).toBeGreaterThan(0);
    expect(api.to("PATCH", doc)[0]?.body).toMatchObject({
      title: "Roadmap 2027",
      expectedRevision: 3,
    });
  });

  it("surfaces a revision conflict instead of overwriting", async () => {
    await openEditor({
      [`PATCH ${doc}`]: new Raw(
        409,
        JSON.stringify({
          error: "The presentation changed since it was loaded.",
        }),
      ),
    });
    fireEvent.blur(screen.getByLabelText("Presentation title"));
    expect(
      await screen.findAllByText(
        "The presentation changed since it was loaded.",
      ),
    ).not.toHaveLength(0);
  });

  it("saves page setup font size and alignment immediately", async () => {
    const { api } = await openEditor({ [`PATCH ${doc}`]: { revision: 4 } });
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(screen.getByRole("button", { name: "⚙ Page Setup" }));
    expect(screen.queryByLabelText("Presentation menu")).toBeNull();

    fireEvent.change(screen.getByLabelText("Slide font size"), {
      target: { value: "large" },
    });
    await waitFor(() => expect(api.to("PATCH", doc)).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Slide text alignment"), {
      target: { value: "center" },
    });
    await waitFor(() => expect(api.to("PATCH", doc)).toHaveLength(2));
    expect(api.to("PATCH", doc)[1]?.body).toMatchObject({
      settings: { fontSize: "large", textAlign: "center" },
      expectedRevision: 4,
    });
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(screen.queryByLabelText("Slide font size")).toBeNull();
  });

  it("applies a saved theme to the document and shows the empty-theme hint without any", async () => {
    const themes = [
      {
        id: "t1",
        name: "Sunrise",
        description: "",
        builtIn: false,
        definition: { background: "#ffeecc", text: "#112233" },
        favorite: false,
        liked: false,
      },
      {
        id: "t2",
        name: "Plain",
        description: "",
        builtIn: true,
        definition: {},
        favorite: false,
        liked: false,
      },
    ];
    const { api } = await openEditor({
      "GET /api/presentation/v1/themes": themes,
      [`PATCH ${doc}`]: { revision: 4 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.click(await screen.findByRole("button", { name: /Sunrise/ }));
    await waitFor(() => expect(api.to("PATCH", doc)).toHaveLength(1));
    expect(api.to("PATCH", doc)[0]?.body).toMatchObject({
      themeId: "t1",
      settings: { themeDefinition: { background: "#ffeecc", text: "#112233" } },
    });
    expect(screen.getByRole("button", { name: /Plain/ })).toBeInTheDocument();
    // The toolbar button toggles the panel closed again.
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.queryByRole("link", { name: "＋ New Theme" })).toBeNull();
  });

  it("explains how to get themes when the tenant has none", async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(screen.getByRole("button", { name: "◈ Theme Panel" }));
    expect(
      screen.getByText(/Create or import a theme to add it to this panel/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "＋ New Theme" })).toHaveAttribute(
      "href",
      "/t/acme/p/presentation/themes",
    );
  });

  it("zooms the canvas within 50 to 150 percent", async () => {
    await openEditor();
    for (let step = 0; step < 8; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "−" }));
    }
    expect(screen.getByText("50%")).toBeInTheDocument();
    for (let step = 0; step < 12; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "＋" }));
    }
    expect(screen.getByText("150%")).toBeInTheDocument();
  });
});

describe("presentation editor: file menu", () => {
  it("navigates from the menu", async () => {
    await openEditor();
    const assign = captureNavigation();
    const open = () =>
      fireEvent.click(screen.getByLabelText("Open presentation menu"));
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "＋ New Presentation" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "← Back to prompt" }));
    fireEvent.click(
      screen.getByRole("button", { name: "▦ All Presentations" }),
    );
    expect(assign.mock.calls.map(([path]) => path)).toEqual([
      "/t/acme/p/presentation/create",
      "/t/acme/p/presentation/create",
      "/t/acme/p/presentation/library",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "✎ Rename" }));
    expect(screen.getByLabelText("Presentation title")).toHaveFocus();
  });

  it("duplicates the presentation and opens the copy", async () => {
    await openEditor({ [`POST ${doc}/duplicate`]: { id: "doc-2" } });
    const assign = captureNavigation();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate presentation" }),
    );
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "/t/acme/p/presentation/editor/doc-2",
      ),
    );
  });

  it("reports a failed duplicate", async () => {
    await openEditor({
      [`POST ${doc}/duplicate`]: new Raw(
        500,
        JSON.stringify({ error: "Quota." }),
      ),
    });
    const assign = captureNavigation();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate presentation" }),
    );
    expect(await screen.findAllByText("Quota.")).not.toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it("creates a share link and revokes it", async () => {
    const { api } = await openEditor({
      [`POST ${doc}/shares`]: { id: "sh-1", token: "tok-abc" },
      "DELETE /api/presentation/v1/shares/sh-1": {},
    });
    captureNavigation();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    expect(
      screen.queryByRole("button", { name: "Revoke share link" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share presentation" }));
    expect(
      await screen.findByText("https://app.test/share/presentation/tok-abc"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke share link" }));
    expect(await screen.findAllByText("Share link revoked.")).not.toHaveLength(
      0,
    );
    expect(api.to("DELETE", "/api/presentation/v1/shares/sh-1")).toHaveLength(
      1,
    );
    expect(
      screen.queryByText("https://app.test/share/presentation/tok-abc"),
    ).toBeNull();
  });

  it("reports share and revoke failures", async () => {
    await openEditor({
      [`POST ${doc}/shares`]: new Raw(
        403,
        JSON.stringify({ error: "Sharing disabled." }),
      ),
    });
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(screen.getByRole("button", { name: "Share presentation" }));
    expect(await screen.findAllByText("Sharing disabled.")).not.toHaveLength(0);
    cleanup();

    await openEditor({
      [`POST ${doc}/shares`]: { id: "sh-1", token: "tok-abc" },
      "DELETE /api/presentation/v1/shares/sh-1": new Raw(
        500,
        JSON.stringify({ error: "Could not revoke." }),
      ),
    });
    captureNavigation();
    fireEvent.click(screen.getByLabelText("Open presentation menu"));
    fireEvent.click(screen.getByRole("button", { name: "Share presentation" }));
    await screen.findByText("https://app.test/share/presentation/tok-abc");
    fireEvent.click(screen.getByRole("button", { name: "Revoke share link" }));
    expect(await screen.findAllByText("Could not revoke.")).not.toHaveLength(0);
    expect(
      screen.getByText("https://app.test/share/presentation/tok-abc"),
    ).toBeInTheDocument();
  });
});

describe("presentation editor: export", () => {
  function captureDownloads() {
    const downloads: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, download: this.download });
    });
    return downloads;
  }

  it("exports PPTX and PDF and downloads the produced asset", async () => {
    const downloads = captureDownloads();
    const { api } = await openEditor({
      [`POST ${doc}/exports`]: { assetReference: "https://files.test/a.bin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PPTX" }));
    expect(await screen.findAllByText("PPTX exported.")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(await screen.findAllByText("PDF exported.")).not.toHaveLength(0);
    expect(
      api
        .to("POST", `${doc}/exports`)
        .map((r) => (r.body as { format: string }).format),
    ).toEqual(["pptx", "pdf"]);
    expect(downloads).toEqual([
      { href: "https://files.test/a.bin", download: "Roadmap.pptx" },
      { href: "https://files.test/a.bin", download: "Roadmap.pdf" },
    ]);
  });

  it("can be dismissed, and is blocked while slide edits are unsaved", async () => {
    const downloads = captureDownloads();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByLabelText("Close export"));
    expect(screen.queryByLabelText("Export presentation")).toBeNull();

    fireEvent.change(screen.getAllByLabelText("Rich text content")[0]!, {
      target: { value: "Dirty" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(
      await screen.findAllByText("Save your slide changes before exporting."),
    ).not.toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });

  it("reports an export failure", async () => {
    const downloads = captureDownloads();
    await openEditor({
      [`POST ${doc}/exports`]: new Raw(
        500,
        JSON.stringify({ error: "Renderer unavailable." }),
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PPTX" }));
    expect(
      await screen.findAllByText("Renderer unavailable."),
    ).not.toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });
});
