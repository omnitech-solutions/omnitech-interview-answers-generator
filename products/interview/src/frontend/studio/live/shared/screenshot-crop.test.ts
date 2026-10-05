import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRect,
  cropBlob,
  dragRect,
  fullRect,
  isWholeImage,
  MIN_CROP_SIDE,
  rectBetween,
  withField,
} from "./screenshot-crop";

const SIZE = { w: 800, h: 600 };

describe("clampRect", () => {
  it("keeps the rectangle inside the image", () => {
    expect(clampRect({ x: -10, y: 590, w: 100, h: 100 }, SIZE)).toEqual({
      x: 0,
      y: 500,
      w: 100,
      h: 100,
    });
  });
  it(`never goes below the server's smallest side (${MIN_CROP_SIDE})`, () => {
    const rect = clampRect({ x: 5, y: 5, w: 3, h: 1 }, SIZE);
    expect(rect.w).toBe(MIN_CROP_SIDE);
    expect(rect.h).toBe(MIN_CROP_SIDE);
  });
  it("is aspect-free: width and height are independent", () => {
    expect(clampRect({ x: 0, y: 0, w: 700, h: 40 }, SIZE)).toMatchObject({
      w: 700,
      h: 40,
    });
  });
});

describe("dragRect", () => {
  const start = { x: 100, y: 100, w: 200, h: 150 };
  it("moves the whole box and stops at the image edge", () => {
    expect(dragRect(start, "move", 50, 20, SIZE)).toMatchObject({
      x: 150,
      y: 120,
    });
    expect(dragRect(start, "move", 9999, 9999, SIZE)).toMatchObject({
      x: 600,
      y: 450,
    });
  });
  it("the east handle changes only the width", () => {
    expect(dragRect(start, "e", 40, 99, SIZE)).toEqual({ ...start, w: 240 });
  });
  it("the north-west handle moves the corner, keeping the opposite one", () => {
    const next = dragRect(start, "nw", -30, -20, SIZE);
    expect(next).toEqual({ x: 70, y: 80, w: 230, h: 170 });
  });
  it("dragging past the opposite edge stops at the smallest side, never flipping", () => {
    const next = dragRect(start, "w", 500, 0, SIZE);
    expect(next.w).toBe(MIN_CROP_SIDE);
    expect(next.x + next.w).toBe(300);
  });
  it("does not leave the image", () => {
    expect(dragRect(start, "se", 9999, 9999, SIZE)).toMatchObject({
      w: 700,
      h: 500,
    });
  });
});

describe("selection and numeric entry", () => {
  it("drags a new selection from any corner to the other", () => {
    expect(rectBetween({ x: 300, y: 200 }, { x: 100, y: 50 }, SIZE)).toEqual({
      x: 100,
      y: 50,
      w: 200,
      h: 150,
    });
  });
  it("a typed field changes one number and is clamped", () => {
    const rect = fullRect(SIZE);
    expect(withField(rect, "w", 300, SIZE)).toMatchObject({ w: 300, h: 600 });
    expect(withField(rect, "w", 5, SIZE).w).toBe(MIN_CROP_SIDE);
    expect(withField(rect, "x", Number.NaN, SIZE).x).toBe(0);
  });
  it("knows when nothing is cropped", () => {
    expect(isWholeImage(fullRect(SIZE), SIZE)).toBe(true);
    expect(isWholeImage({ x: 1, y: 0, w: 799, h: 600 }, SIZE)).toBe(false);
  });
});

describe("cropBlob", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubCanvas(): { drawn: unknown[][]; size: () => [number, number] } {
    const drawn: unknown[][] = [];
    let size: [number, number] = [0, 0];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    );
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return real(tag);
      const canvas = {
        set width(value: number) {
          size[0] = value;
        },
        set height(value: number) {
          size[1] = value;
        },
        getContext: () => ({
          drawImage: (...args: unknown[]) => drawn.push(args),
        }),
        toBlob: (done: (blob: Blob | null) => void, type: string) =>
          done(new Blob(["cropped"], { type })),
      };
      size = [0, 0];
      return canvas as unknown as HTMLCanvasElement;
    });
    return { drawn, size: () => size };
  }

  it("draws only the rectangle onto a canvas of exactly that size and returns a NEW blob", async () => {
    const stub = stubCanvas();
    const source = new Blob(["source"], { type: "image/jpeg" });
    const out = await cropBlob(source, { x: 10, y: 20, w: 300, h: 100 });
    expect(out).not.toBe(source);
    expect(out.type).toBe("image/jpeg");
    expect(stub.size()).toEqual([300, 100]);
    expect(stub.drawn[0]?.slice(1)).toEqual([10, 20, 300, 100, 0, 0, 300, 100]);
  });

  it("encodes anything that is not JPEG or WebP as PNG", async () => {
    stubCanvas();
    const out = await cropBlob(new Blob(["s"], { type: "image/gif" }), {
      x: 0,
      y: 0,
      w: 64,
      h: 64,
    });
    expect(out.type).toBe("image/png");
  });

  it("refuses a result under the smallest side", async () => {
    stubCanvas();
    await expect(
      cropBlob(new Blob(["s"]), { x: 0, y: 0, w: MIN_CROP_SIDE - 1, h: 100 }),
    ).rejects.toThrow("too-small");
  });
});
