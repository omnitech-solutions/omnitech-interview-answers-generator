// The viewer draws the image at the size the model says (F5): zooming enlarges
// the drawn image past the stage, Fit leaves it to the stylesheet, 100% is one
// image pixel per CSS pixel. jsdom has no layout, so the drawn size is the
// inline style the component sets; the stylesheet guard below keeps a zoomed
// image from being shrunk back by the stage's flex layout.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImageViewer } from "./image-viewer";
import type { ShotView } from "./use-screenshots-view";

afterEach(cleanup);

const shot: ShotView = {
  key: "s1",
  label: "S1",
  time: "10:00",
  displayLabel: null,
  revisions: [],
  src: "blob:s1",
  staged: false,
  text: "",
  sentAs: null,
  sentLine: null,
  willBe: null,
};

function open() {
  render(<ImageViewer shot={shot} onClose={() => {}} />);
  const image = screen.getByAltText("Screenshot S1") as HTMLImageElement;
  Object.defineProperty(image, "naturalWidth", { value: 400 });
  Object.defineProperty(image, "naturalHeight", { value: 300 });
  fireEvent.load(image);
  return image;
}
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("the viewer's drawn size", () => {
  it("leaves Fit to the stylesheet", () => {
    const image = open();
    expect(screen.getByTestId("viewer-zoom")).toHaveTextContent("Fit");
    expect(image.style.width).toBe("");
    expect(image.style.transform).toBe("");
  });

  it("draws 100% at the natural width, exactly", () => {
    const image = open();
    press("100%");
    expect(image.style.width).toBe("400px");
    expect(image.style.maxWidth).toBe("none");
  });

  it("draws a larger image at every zoom in, wider than the stage", () => {
    const image = open();
    press("100%");
    press("Zoom in");
    expect(screen.getByTestId("viewer-zoom")).toHaveTextContent("150%");
    expect(image.style.width).toBe("600px");
    press("Zoom in");
    expect(image.style.width).toBe("800px");
    press("Zoom out");
    press("Zoom out");
    press("Zoom out");
    expect(screen.getByTestId("viewer-zoom")).toHaveTextContent("75%");
    expect(image.style.width).toBe("300px");
  });

  it("returns to Fit and to 100% exactly, and pans at a zoom", () => {
    const image = open();
    press("100%");
    press("Zoom in");
    fireEvent.keyDown(screen.getByTestId("image-viewer"), { key: "ArrowLeft" });
    expect(image.style.transform).toBe("translate(48px, 0px)");
    press("Fit");
    expect(image.style.width).toBe("");
    press("100%");
    expect(image.style.width).toBe("400px");
    expect(image.style.transform).toBe("translate(0px, 0px)");
  });
});

describe("the viewer's stylesheet", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "screenshots.css"),
    "utf8",
  );
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[.:()[\]]/g, "\\$&")}\\s*{([^}]*)}`).exec(
      css,
    )?.[1] ?? "";

  it("never lets the flex stage shrink a zoomed image back to its width", () => {
    const zoomed = rule(".ss-viewer-stage:not([data-fit]) img");
    expect(zoomed).toMatch(/flex:\s*none/);
    expect(zoomed).toMatch(/max-width:\s*none/);
  });
});
