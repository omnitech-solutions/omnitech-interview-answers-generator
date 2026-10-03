import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installFakeApi,
  Raw,
  routeScreen,
  sampleDocument,
} from "./fake-api.js";

const api = "/api/presentation/v1";

async function mount(routeId: string, segments: string[] = []) {
  const { Screen, props } = await routeScreen(routeId, segments);
  return render(<Screen {...props} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const theme = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "Sunrise",
  description: "Warm",
  builtIn: false,
  definition: { background: "#ffeecc", text: "#112233" },
  favorite: false,
  liked: false,
  ...overrides,
});

describe("theme library", () => {
  it("lists built-in and custom themes", async () => {
    installFakeApi({
      [`GET ${api}/themes`]: [
        theme(),
        theme({ id: "t2", name: "Classic", builtIn: true, definition: {} }),
      ],
    });
    await mount("presentation.themes");
    expect(await screen.findByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("Built in")).toBeInTheDocument();
  });

  it("explains a theme list that cannot load", async () => {
    installFakeApi({
      [`GET ${api}/themes`]: new Raw(
        500,
        JSON.stringify({ error: "Themes unavailable." }),
      ),
    });
    await mount("presentation.themes");
    expect(await screen.findByText("Themes unavailable.")).toBeInTheDocument();
  });

  it("creates a custom theme and clears the form", async () => {
    const fake = installFakeApi({
      [`GET ${api}/themes`]: [],
      [`POST ${api}/themes`]: { id: "t9" },
    });
    await mount("presentation.themes");
    fireEvent.click(screen.getByRole("button", { name: "Save theme" }));
    expect(fake.to("POST", `${api}/themes`)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Night" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Dark" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save theme" }));
    expect(await screen.findByText("Theme saved.")).toBeInTheDocument();
    expect(fake.to("POST", `${api}/themes`)[0]?.body).toMatchObject({
      name: "Night",
      description: "Dark",
      definition: { background: "#f8fafc", text: "#111827" },
    });
    expect(screen.getByRole("heading", { name: "Night" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("reports a theme that fails to save", async () => {
    installFakeApi({
      [`GET ${api}/themes`]: [],
      [`POST ${api}/themes`]: new Raw(
        400,
        JSON.stringify({ error: "Name taken." }),
      ),
    });
    await mount("presentation.themes");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Night" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save theme" }));
    expect(await screen.findByText("Name taken.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Night");
  });

  it("favorites and likes a theme, and toggles them back", async () => {
    const fake = installFakeApi({
      [`GET ${api}/themes`]: [theme()],
      [`PUT ${api}/themes/t1/favorite`]: {},
      [`PUT ${api}/themes/t1/like`]: {},
    });
    await mount("presentation.themes");
    fireEvent.click(await screen.findByRole("button", { name: "☆ Favorite" }));
    fireEvent.click(await screen.findByRole("button", { name: "♡ Like" }));
    expect(
      await screen.findByRole("button", { name: "♥ Liked" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "★ Favorited" }),
    ).toBeInTheDocument();
    expect(fake.to("PUT", `${api}/themes/t1/favorite`)[0]?.body).toEqual({
      enabled: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "★ Favorited" }));
    expect(
      await screen.findByRole("button", { name: "☆ Favorite" }),
    ).toBeInTheDocument();
    expect(fake.to("PUT", `${api}/themes/t1/favorite`)[1]?.body).toEqual({
      enabled: false,
    });
  });

  it("reports a failed reaction", async () => {
    installFakeApi({
      [`GET ${api}/themes`]: [theme()],
      [`PUT ${api}/themes/t1/like`]: new Raw(
        403,
        JSON.stringify({ error: "Read only." }),
      ),
    });
    await mount("presentation.themes");
    fireEvent.click(await screen.findByRole("button", { name: "♡ Like" }));
    expect(await screen.findByText("Read only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "♡ Like" })).toBeInTheDocument();
  });

  it("imports a PowerPoint theme and adds it to the list", async () => {
    const fake = installFakeApi({
      [`GET ${api}/themes`]: [],
      [`POST ${api}/themes/import`]: {
        id: "t5",
        theme: theme({ id: "ignored", name: "Corporate", builtIn: true }),
      },
    });
    await mount("presentation.themes");
    const input = screen.getByLabelText("Import PowerPoint theme");
    fireEvent.change(input, { target: { files: [] } });
    expect(fake.to("POST", `${api}/themes/import`)).toHaveLength(0);

    const file = new File(["PKdata"], "Corporate.PPTX", {
      type: "application/octet-stream",
      lastModified: 42,
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByText("PowerPoint theme imported."),
    ).toBeInTheDocument();
    expect(fake.to("POST", `${api}/themes/import`)[0]?.body).toEqual({
      name: "Corporate",
      fileBase64: btoa("PKdata"),
      sourceImportId: "pptx:Corporate.PPTX:6:42",
    });
    // The imported theme is always shown as a custom one.
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("reports a rejected import", async () => {
    installFakeApi({
      [`GET ${api}/themes`]: [],
      [`POST ${api}/themes/import`]: new Raw(
        422,
        JSON.stringify({ error: "Not a PowerPoint file." }),
      ),
    });
    await mount("presentation.themes");
    fireEvent.change(screen.getByLabelText("Import PowerPoint theme"), {
      target: { files: [new File(["x"], "bad.pptx")] },
    });
    expect(
      await screen.findByText("Not a PowerPoint file."),
    ).toBeInTheDocument();
  });
});

describe("image studio", () => {
  const image = {
    id: "i1",
    assetReference: "https://img.test/1.png",
    providerId: "fal",
    modelId: "flux",
    metadata: {},
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("lists the image library", async () => {
    installFakeApi({ [`GET ${api}/images`]: [image] });
    await mount("presentation.image-studio");
    expect(await screen.findByText("fal · flux")).toBeInTheDocument();
  });

  it("explains an image library that cannot load", async () => {
    installFakeApi({
      [`GET ${api}/images`]: new Raw(
        500,
        JSON.stringify({ error: "No storage." }),
      ),
    });
    await mount("presentation.image-studio");
    expect(await screen.findByText("No storage.")).toBeInTheDocument();
  });

  it("generates an image with the chosen ratio and optional model, then refreshes the library", async () => {
    let images: unknown[] = [];
    const fake = installFakeApi({
      [`GET ${api}/images`]: () => images,
      [`POST ${api}/images/generate`]: () => {
        images = [image];
        return {};
      },
    });
    await mount("presentation.image-studio");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Describe the image"), {
      target: { value: "A red fox" },
    });
    fireEvent.change(screen.getByLabelText("Aspect ratio"), {
      target: { value: "1:1" },
    });
    fireEvent.change(screen.getByLabelText("Provider model (optional)"), {
      target: { value: "  flux-pro " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(
      await screen.findByText("Image generated and persisted."),
    ).toBeInTheDocument();
    expect(fake.to("POST", `${api}/images/generate`)[0]?.body).toEqual({
      prompt: "A red fox",
      profileId: "image-balanced",
      aspectRatio: "1:1",
      modelId: "flux-pro",
    });
    expect(await screen.findByText("fal · flux")).toBeInTheDocument();
  });

  it("omits the model when none is given and reports a failed generation", async () => {
    const fake = installFakeApi({
      [`GET ${api}/images`]: [],
      [`POST ${api}/images/generate`]: new Raw(
        502,
        JSON.stringify({ error: "Provider timed out." }),
      ),
    });
    await mount("presentation.image-studio");
    fireEvent.change(screen.getByLabelText("Describe the image"), {
      target: { value: "A red fox" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Provider timed out.")).toBeInTheDocument();
    expect(fake.to("POST", `${api}/images/generate`)[0]?.body).toEqual({
      prompt: "A red fox",
      profileId: "image-balanced",
      aspectRatio: "16:9",
    });
  });

  it("uploads an image file and refreshes the library", async () => {
    let images: unknown[] = [];
    const fake = installFakeApi({
      [`GET ${api}/images`]: () => images,
      [`POST ${api}/images`]: () => {
        images = [image];
        return { id: "i1" };
      },
    });
    await mount("presentation.image-studio");
    const input = screen.getByLabelText("Upload image");
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(screen.getByText("Choose an image file.")).toBeInTheDocument();

    fireEvent.change(input, {
      target: { files: [new File(["png"], "a.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("Image uploaded.")).toBeInTheDocument();
    expect(fake.to("POST", `${api}/images`)[0]?.body).toEqual({
      assetReference: `data:image/png;base64,${btoa("png")}`,
      mimeType: "image/png",
    });
    expect(await screen.findByText("fal · flux")).toBeInTheDocument();
  });

  it("reports a failed upload", async () => {
    installFakeApi({
      [`GET ${api}/images`]: [],
      [`POST ${api}/images`]: new Raw(
        413,
        JSON.stringify({ error: "Image too large." }),
      ),
    });
    await mount("presentation.image-studio");
    fireEvent.change(screen.getByLabelText("Upload image"), {
      target: {
        files: [new File(["png"], "a.png", { type: "image/png" })],
      },
    });
    expect(await screen.findByText("Image too large.")).toBeInTheDocument();
  });
});

describe("present mode", () => {
  it("steps through the slides with the theme applied", async () => {
    installFakeApi({
      [`GET ${api}/documents/doc-1`]: sampleDocument({
        settings: { theme: "ebony", textAlign: "center" },
      }),
      [`GET ${api}/documents/doc-1/recordings`]: [],
    });
    await mount("presentation.present", ["present", "doc-1"]);
    expect(await screen.findByText("Intro")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByText("Intro").closest("div")).toHaveStyle({
      textAlign: "center",
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Next", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Intro")).toBeInTheDocument();
  });

  it("waits quietly when no presentation is selected", async () => {
    installFakeApi({});
    await mount("presentation.present", ["present"]);
    expect(screen.getByText("Loading presentation…")).toBeInTheDocument();
    expect(screen.getByText("1 / 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("explains a presentation that cannot load", async () => {
    installFakeApi({
      [`GET ${api}/documents/doc-1`]: new Raw(
        404,
        JSON.stringify({ error: "Not found." }),
      ),
      [`GET ${api}/documents/doc-1/recordings`]: [],
    });
    const { container } = await mount("presentation.present", [
      "present",
      "doc-1",
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not found.");
    // The failure replaces the slide, which no longer waits on a load.
    expect(
      container.querySelector(".presentation-mode-slide"),
    ).toContainElement(alert);
    expect(screen.queryByText("Loading presentation…")).not.toBeInTheDocument();
    // A document that did not load cannot be recorded.
    expect(
      screen.queryByRole("button", { name: "Record" }),
    ).not.toBeInTheDocument();
  });

  describe("recording", () => {
    class FakeRecorder {
      static instances: FakeRecorder[] = [];
      mimeType = "video/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: unknown) {
        FakeRecorder.instances.push(this);
      }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob([]) });
        this.ondataavailable?.({ data: new Blob(["frame"]) });
        this.onstop?.();
      }
    }

    function stubScreenCapture() {
      FakeRecorder.instances = [];
      const stopTrack = vi.fn();
      vi.stubGlobal("MediaRecorder", FakeRecorder);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: vi.fn(async () => ({
            getTracks: () => [{ stop: stopTrack }],
          })),
        },
      });
      return stopTrack;
    }

    afterEach(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    });

    it("records the screen, saves the recording and lists it", async () => {
      const stopTrack = stubScreenCapture();
      const fake = installFakeApi({
        [`GET ${api}/documents/doc-1`]: sampleDocument(),
        [`GET ${api}/documents/doc-1/recordings`]: [
          {
            id: "r0",
            assetReference: "data:video/webm;base64,OLD",
            metadata: {},
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
        [`POST ${api}/documents/doc-1/recordings`]: { id: "r1" },
      });
      const { container } = await mount("presentation.present", [
        "present",
        "doc-1",
      ]);
      await waitFor(() =>
        expect(container.querySelectorAll("video")).toHaveLength(1),
      );
      await screen.findByText("Intro");

      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      expect(await screen.findByText("Recording…")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
      expect(await screen.findByText("Recording saved.")).toBeInTheDocument();
      expect(
        fake.to("POST", `${api}/documents/doc-1/recordings`)[0]?.body,
      ).toEqual({
        assetReference: `data:video/webm;base64,${btoa("frame")}`,
        metadata: { mimeType: "video/webm", size: 5 },
      });
      expect(stopTrack).toHaveBeenCalled();
      expect(container.querySelectorAll("video")).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Record" }),
      ).toBeInTheDocument();
    });

    it("reports a recording that cannot be saved", async () => {
      stubScreenCapture();
      installFakeApi({
        [`GET ${api}/documents/doc-1`]: sampleDocument(),
        [`GET ${api}/documents/doc-1/recordings`]: new Raw(500, ""),
        [`POST ${api}/documents/doc-1/recordings`]: new Raw(
          507,
          JSON.stringify({ error: "Storage full." }),
        ),
      });
      await mount("presentation.present", ["present", "doc-1"]);
      await screen.findByText("Intro");
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Stop recording" }),
      );
      expect(await screen.findByText("Storage full.")).toBeInTheDocument();
    });

    it("says so when screen capture is unavailable or refused", async () => {
      installFakeApi({
        [`GET ${api}/documents/doc-1`]: sampleDocument(),
        [`GET ${api}/documents/doc-1/recordings`]: [],
      });
      await mount("presentation.present", ["present", "doc-1"]);
      await screen.findByText("Intro");
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      expect(
        await screen.findByText(
          "Screen recording is not available in this browser.",
        ),
      ).toBeInTheDocument();

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: vi.fn(async () => {
            throw new Error("Permission denied.");
          }),
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      expect(await screen.findByText("Permission denied.")).toBeInTheDocument();
    });
  });
});

describe("shared presentation", () => {
  it("shows a shared deck by token and steps through it without tenant access", async () => {
    const fake = installFakeApi({
      [`GET ${api}/shared/tok-1`]: sampleDocument({ title: "Public deck" }),
    });
    await mount("presentation.shared", ["shared", "tok-1"]);
    expect(
      await screen.findByRole("heading", { name: "Public deck" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(fake.sent[0]?.query).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("shows the server's reason for a revoked or unknown link", async () => {
    installFakeApi({
      [`GET ${api}/shared/gone`]: new Raw(
        404,
        JSON.stringify({ error: "This link was revoked." }),
      ),
      [`GET ${api}/shared/odd`]: new Raw(200, "<html>"),
    });
    await mount("presentation.shared", ["shared", "gone"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link was revoked.",
    );
    cleanup();

    await mount("presentation.shared", ["shared", "odd"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server returned an invalid response.",
    );
  });

  it("encodes a token holding reserved characters into one path segment", async () => {
    const token = "a/b?c#d e";
    const fake = installFakeApi({
      [`GET ${api}/shared/${encodeURIComponent(token)}`]: sampleDocument({
        title: "Encoded deck",
      }),
    });
    await mount("presentation.shared", ["shared", token]);
    expect(
      await screen.findByRole("heading", { name: "Encoded deck" }),
    ).toBeInTheDocument();
    expect(fake.sent[0]?.path).toBe(`${api}/shared/a%2Fb%3Fc%23d%20e`);
  });

  it("stays on the loading state when the link has no token", async () => {
    const fake = installFakeApi({});
    await mount("presentation.shared", ["shared"]);
    expect(
      screen.getByText("Loading presentation…", { selector: "h1" }),
    ).toBeInTheDocument();
    expect(fake.sent).toHaveLength(0);
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    await mount("presentation.shared", ["shared", "tok-1"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load presentation.",
    );
  });
});
