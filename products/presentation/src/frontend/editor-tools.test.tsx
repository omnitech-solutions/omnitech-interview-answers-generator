import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Handler,
  installFakeApi,
  Raw,
  routeScreen,
  sampleDocument,
} from "./fake-api";

const doc = "/api/presentation/v1/documents/doc-1";
const jobs = "/api/platform/v1/agent-jobs";

async function openEditor(routes: Record<string, Handler> = {}) {
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
  render(<Screen {...props} />);
  await screen.findByLabelText("Presentation title");
  return api;
}

const tool = (name: string) => screen.getByRole("button", { name });
const blockTexts = () =>
  screen
    .getAllByLabelText("Rich text content")
    .map((area) => (area as HTMLTextAreaElement).value);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("presentation editor: insert panels", () => {
  it("adds text and element blocks to the selected slide from their cards", async () => {
    await openEditor();
    fireEvent.click(tool("Text"));
    expect(screen.getByRole("heading", { name: "Text" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Blockquote/ }));
    expect(blockTexts()).toEqual(["Intro", "Hello", "A memorable quote"]);
    expect(
      screen.getAllByText("quote added to slide. Save slide to publish.")
        .length,
    ).toBeGreaterThan(0);

    fireEvent.click(tool("Add elements"));
    expect(
      screen.getByRole("heading", { name: "Add elements" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    expect(blockTexts().at(-1)).toBe("Now\nNext\nLater");
  });

  it("filters the cards by search and closes the panel", async () => {
    await openEditor();
    fireEvent.click(tool("Text"));
    fireEvent.change(screen.getByLabelText("Search panel"), {
      target: { value: "heading" },
    });
    expect(
      screen
        .getAllByRole("button")
        .filter(
          (button) =>
            /^Heading \d$/.test(button.textContent ?? "") ||
            /Heading \d$/.test(button.textContent ?? ""),
        ),
    ).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Blockquote/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(screen.queryByLabelText("Search panel")).toBeNull();
  });

  it("adds chart and diagram blocks that draw as visuals", async () => {
    await openEditor();
    fireEvent.click(tool("Add Charts"));
    fireEvent.click(screen.getByRole("button", { name: /Bar chart/ }));
    expect(
      screen.getAllByRole("img", { name: "Chart" }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(tool("Add Diagrams"));
    fireEvent.click(screen.getByRole("button", { name: /Process flow/ }));
    expect(screen.getAllByLabelText("Diagram").length).toBeGreaterThan(0);
  });

  it("inserts an image from the library into the slide", async () => {
    await openEditor({
      "GET /api/presentation/v1/images": [
        {
          id: "i1",
          assetReference: "data:image/png;base64,AAAA",
          providerId: "fal",
          modelId: "flux",
          metadata: {},
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    fireEvent.click(tool("Media Embeds"));
    expect(
      screen.getByRole("link", { name: "Upload an image in Image Studio" }),
    ).toHaveAttribute("href", "/t/acme/p/presentation/images");
    fireEvent.change(await screen.findByLabelText("Image from library"), {
      target: { value: "i1" },
    });
    expect(blockTexts().at(-1)).toBe("data:image/png;base64,AAAA");
    expect(
      screen.getAllByText("img added to slide. Save slide to publish.").length,
    ).toBeGreaterThan(0);

    // Choosing the placeholder adds nothing.
    fireEvent.change(screen.getByLabelText("Image from library"), {
      target: { value: "" },
    });
    expect(blockTexts()).toHaveLength(3);
  });

  it("points recording at present mode", async () => {
    await openEditor();
    fireEvent.click(tool("Record"));
    expect(
      screen.getByRole("link", { name: "Open presentation" }),
    ).toHaveAttribute("href", "/t/acme/p/presentation/present/doc-1");
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(
      screen.queryByText("Record your screen from Present mode."),
    ).toBeNull();
  });
});

describe("presentation editor: generate a slide with AI", () => {
  it("adds the generated slide as an unsaved draft using the chosen AI profile", async () => {
    window.localStorage.setItem("platform.aiProfileId", "fast");
    const api = await openEditor({
      [`POST ${doc}/slides/generate`]: {
        result: {
          sourceXml: '<SECTION layout="vertical"><H1>Generated</H1></SECTION>',
        },
        position: 2,
      },
    });
    fireEvent.click(tool("AI tools"));
    expect(
      screen.getByRole("button", { name: "Generate slide" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Slide generation prompt"), {
      target: { value: "A closing slide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate slide" }));
    expect(
      (
        await screen.findAllByText(
          "Slide draft ready; save it to keep the changes.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(api.to("POST", `${doc}/slides/generate`)[0]?.body).toEqual({
      prompt: "A closing slide",
      profileId: "fast",
      position: 2,
    });
    expect(blockTexts()).toEqual(["Generated"]);
    expect(screen.getByLabelText("Slide generation prompt")).toHaveValue("");
  });

  it("falls back to the default profile and reports empty and failed generations", async () => {
    const api = await openEditor({
      [`POST ${doc}/slides/generate`]: { result: {}, position: 2 },
    });
    fireEvent.click(tool("AI tools"));
    fireEvent.change(screen.getByLabelText("Slide generation prompt"), {
      target: { value: "Anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate slide" }));
    expect(
      (await screen.findAllByText("Generated slide was empty.")).length,
    ).toBeGreaterThan(0);
    expect(
      (
        api.to("POST", `${doc}/slides/generate`)[0]?.body as {
          profileId: string;
        }
      ).profileId,
    ).toBe("document-fast");
    cleanup();

    await openEditor({
      [`POST ${doc}/slides/generate`]: new Raw(
        503,
        JSON.stringify({ error: "Model unavailable." }),
      ),
    });
    fireEvent.click(tool("AI tools"));
    fireEvent.change(screen.getByLabelText("Slide generation prompt"), {
      target: { value: "Anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate slide" }));
    expect(
      (await screen.findAllByText("Model unavailable.")).length,
    ).toBeGreaterThan(0);
  });
});

describe("presentation editor: design agent", () => {
  const candidate = '<SECTION layout="vertical"><H1>Agent title</H1></SECTION>';

  async function startAgent(routes: Record<string, Handler>) {
    const api = await openEditor({
      [`POST ${jobs}`]: { id: "job-1", status: "queued" },
      ...routes,
    });
    fireEvent.click(tool("AI tools"));
    fireEvent.change(screen.getByLabelText("Agent instruction"), {
      target: { value: "Tighten the wording" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Run presentation agent" }),
    );
    return api;
  }

  it("runs the agent, streams output and applies the staged result locally", async () => {
    const api = await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "text-delta", text: "Thinking " } },
        {
          sequence: 2,
          event: { type: "completed", result: { output: "short" } },
        },
      ],
      [`GET ${jobs}/job-1`]: { result: { output: { sourceXml: candidate } } },
    });
    const apply = await screen.findByRole("button", {
      name: "Apply staged result",
    });
    expect(api.to("POST", jobs)[0]?.body).toMatchObject({
      productId: "omnitech.presentation",
      profileId: "presentation-editor",
      prompt: expect.stringContaining("Tighten the wording"),
    });
    expect(
      (api.to("POST", jobs)[0]?.body as { prompt: string }).prompt,
    ).toContain("<H1>Intro</H1>");
    expect(screen.getByLabelText("Agent instruction")).toHaveValue("");

    fireEvent.click(apply);
    expect(blockTexts()).toEqual(["Agent title"]);
    expect(
      screen.getAllByText(
        "Staged agent result applied locally; save to publish.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Apply staged result" }),
    ).toBeNull();
  });

  it("accepts a completed job whose durable result is a bare slide source string", async () => {
    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "completed" } },
      ],
      [`GET ${jobs}/job-1`]: { result: candidate },
    });
    expect(
      await screen.findByRole("button", { name: "Apply staged result" }),
    ).toBeInTheDocument();
  });

  it("keeps the streamed result when the durable job cannot be read", async () => {
    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        {
          sequence: 1,
          event: {
            type: "completed",
            result: { output: { sourceXml: candidate } },
          },
        },
      ],
      [`GET ${jobs}/job-1`]: new Raw(500, "down"),
    });
    expect(
      await screen.findByRole("button", { name: "Apply staged result" }),
    ).toBeInTheDocument();
  });

  it("shows no staged result for output that is not slide markup", async () => {
    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        {
          sequence: 1,
          event: { type: "completed", result: { output: { note: "ok" } } },
        },
      ],
      [`GET ${jobs}/job-1`]: { result: { output: 7 } },
    });
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply staged result" }),
    ).toBeNull();
  });

  it("reports an agent failure, an awaiting-input pause and a polling error", async () => {
    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        {
          sequence: 1,
          event: { type: "failed", error: { message: "Sandbox died." } },
        },
      ],
    });
    expect(
      (await screen.findAllByText("Sandbox died.")).length,
    ).toBeGreaterThan(0);
    cleanup();

    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "failed" } },
      ],
    });
    expect(
      (await screen.findAllByText("Agent failed.")).length,
    ).toBeGreaterThan(0);
    cleanup();

    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "awaiting-input" } },
      ],
    });
    expect(
      (
        await screen.findAllByText(
          "Agent is waiting for approval or more input.",
        )
      ).length,
    ).toBeGreaterThan(0);
    cleanup();

    await startAgent({
      [`GET ${jobs}/job-1/events`]: new Raw(
        500,
        JSON.stringify({ error: "Events unavailable." }),
      ),
    });
    expect(
      (await screen.findAllByText("Events unavailable.")).length,
    ).toBeGreaterThan(0);
  });

  it("polls again after an empty batch and then picks up the next events", async () => {
    let calls = 0;
    const api = await startAgent({
      [`GET ${jobs}/job-1/events`]: () => {
        calls += 1;
        return calls === 1
          ? []
          : [
              {
                sequence: 4,
                event: { type: "failed", error: { message: "Late." } },
              },
            ];
      },
    });
    expect(
      (await screen.findAllByText("Late.", {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0);
    expect(api.to("GET", `${jobs}/job-1/events`).map((r) => r.query)).toEqual([
      "tenant=acme&after=0",
      "tenant=acme&after=0",
    ]);
  });

  it("reports a failed start", async () => {
    await openEditor({
      [`POST ${jobs}`]: new Raw(
        403,
        JSON.stringify({ error: "Agents are disabled." }),
      ),
    });
    fireEvent.click(tool("AI tools"));
    expect(
      screen.getByRole("button", { name: "Run presentation agent" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Agent instruction"), {
      target: { value: "Go" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Run presentation agent" }),
    );
    expect(
      (await screen.findAllByText("Agents are disabled.")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Cancel agent" })).toBeNull();
  });

  it("cancels a running job and resumes a paused one with a new prompt", async () => {
    const api = await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "awaiting-input" } },
      ],
      [`DELETE ${jobs}/job-1`]: {},
      [`POST ${jobs}/job-1/resume`]: {},
    });
    await screen.findAllByText("Agent is waiting for approval or more input.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel agent" }));
    expect(
      (await screen.findAllByText("Agent cancellation requested.")).length,
    ).toBeGreaterThan(0);
    expect(api.to("DELETE", `${jobs}/job-1`)).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Agent instruction"), {
      target: { value: "Yes, continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume with prompt" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Agent instruction")).toHaveValue(""),
    );
    expect(api.to("POST", `${jobs}/job-1/resume`)[0]?.body).toEqual({
      prompt: "Yes, continue",
    });
    await waitFor(() =>
      expect(api.to("GET", `${jobs}/job-1/events`).length).toBeGreaterThan(1),
    );
  });

  it("reports failed cancel and resume requests", async () => {
    await startAgent({
      [`GET ${jobs}/job-1/events`]: [
        { sequence: 1, event: { type: "awaiting-input" } },
      ],
      [`DELETE ${jobs}/job-1`]: new Raw(
        409,
        JSON.stringify({ error: "Already finished." }),
      ),
      [`POST ${jobs}/job-1/resume`]: new Raw(500, ""),
    });
    await screen.findAllByText("Agent is waiting for approval or more input.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel agent" }));
    expect(
      (await screen.findAllByText("Already finished.")).length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Agent instruction"), {
      target: { value: "More" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume with prompt" }));
    expect(
      (await screen.findAllByText("Request failed (500).")).length,
    ).toBeGreaterThan(0);
  });
});
