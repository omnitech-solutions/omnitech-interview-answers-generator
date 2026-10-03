import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, routeScreen, sampleDocument } from "./fake-api.js";

const api = "/api/presentation/v1";
const targets = "/api/platform/v1/ai-targets";

interface Journey {
  screen: string;
  routeId: string;
  segments: string[];
  routes: Record<string, unknown>;
  /** The requests one load of the screen should make: resource → count. */
  onLoad: Record<string, number>;
}

const journeys: Journey[] = [
  {
    screen: "PresentationLibrary",
    routeId: "presentation.library",
    segments: [],
    routes: { [`GET ${api}/documents`]: [], [`GET ${targets}`]: [] },
    onLoad: { [`GET ${api}/documents`]: 1, [`GET ${targets}`]: 1 },
  },
  {
    screen: "PresentationCreate",
    routeId: "presentation.create",
    segments: [],
    routes: { [`GET ${targets}`]: [] },
    onLoad: { [`GET ${targets}`]: 1 },
  },
  {
    screen: "PresentationEditor",
    routeId: "presentation.editor",
    segments: ["editor", "doc-1"],
    routes: {
      [`GET ${api}/documents/doc-1`]: sampleDocument(),
      [`GET ${api}/images`]: [],
      [`GET ${api}/themes`]: [],
    },
    onLoad: {
      [`GET ${api}/documents/doc-1`]: 1,
      [`GET ${api}/images`]: 1,
      [`GET ${api}/themes`]: 1,
    },
  },
  {
    screen: "ThemeLibrary",
    routeId: "presentation.themes",
    segments: [],
    routes: { [`GET ${api}/themes`]: [] },
    onLoad: { [`GET ${api}/themes`]: 1 },
  },
  {
    screen: "ImageStudio",
    routeId: "presentation.image-studio",
    segments: [],
    routes: { [`GET ${api}/images`]: [] },
    onLoad: { [`GET ${api}/images`]: 1 },
  },
  {
    screen: "PresentationMode",
    routeId: "presentation.present",
    segments: ["present", "doc-1"],
    routes: {
      [`GET ${api}/documents/doc-1`]: sampleDocument(),
      [`GET ${api}/documents/doc-1/recordings`]: [],
    },
    onLoad: {
      [`GET ${api}/documents/doc-1`]: 1,
      [`GET ${api}/documents/doc-1/recordings`]: 1,
    },
  },
  {
    screen: "SharedPresentation",
    routeId: "presentation.shared",
    segments: ["shared", "tok-1"],
    routes: { [`GET ${api}/shared/tok-1`]: sampleDocument() },
    onLoad: { [`GET ${api}/shared/tok-1`]: 1 },
  },
];

async function load(journey: Journey, strict: boolean) {
  const fake = installFakeApi(journey.routes);
  const { Screen, props } = await routeScreen(
    journey.routeId,
    journey.segments,
  );
  const element = <Screen {...props} />;
  const view = render(
    strict ? <React.StrictMode>{element}</React.StrictMode> : element,
  );
  await waitFor(() =>
    expect(Object.keys(fake.issued()).sort()).toEqual(
      Object.keys(journey.onLoad).sort(),
    ),
  );
  // Let every response settle so a late duplicate or stale update would show.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { fake, view };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(journeys)("$screen requests on load", (journey) => {
  it("asks for each resource exactly once", async () => {
    const { fake } = await load(journey, false);
    expect(fake.issued()).toEqual(journey.onLoad);
  });

  it("under StrictMode leaves exactly one live request per resource, aborting the rest", async () => {
    const { fake, view } = await load(journey, true);
    expect(fake.live()).toEqual(journey.onLoad);
    // The dev re-run may re-ask, but only after cancelling the first request.
    for (const [resource, issued] of Object.entries(fake.issued())) {
      expect(issued).toBeLessThanOrEqual(2);
      const aborted = fake.sent.filter(
        (request) =>
          `${request.method} ${request.path}` === resource && request.aborted,
      );
      expect(aborted).toHaveLength(issued - 1);
    }
    // An aborted request must not surface as a load error.
    expect(view.container.textContent).not.toMatch(/abort/i);
  });
});
