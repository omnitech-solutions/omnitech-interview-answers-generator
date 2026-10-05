import { expect, it } from "vitest";
import { slideAppearance } from "./appearance";

it("uses neutral defaults when no theme or option is set", () => {
  expect(slideAppearance({})).toEqual({
    fontSize: 26,
    textAlign: "left",
    background: "#f8fafc",
    text: "#111827",
  });
});

it.each([
  [{ fontSize: "small", textAlign: "center" }, 20, "center"],
  [{ fontSize: "large", textAlign: "right" }, 30, "right"],
  [{ fontSize: "huge", textAlign: "justify" }, 26, "left"],
] as const)("maps %j to size %s and alignment %s", (settings, size, align) => {
  expect(slideAppearance(settings)).toMatchObject({
    fontSize: size,
    textAlign: align,
  });
});

it("resolves a named preset", () => {
  expect(slideAppearance({ theme: "ebony" })).toMatchObject({
    background: "#111827",
    text: "#f8fafc",
  });
});

it("prefers an imported theme definition and ignores invalid colours", () => {
  expect(
    slideAppearance({
      theme: "ebony",
      themeDefinition: { background: "#ABCDEF", text: "red" },
    }),
  ).toMatchObject({ background: "#ABCDEF", text: "#111827" });
  expect(
    slideAppearance({ themeDefinition: null, theme: "nope" }),
  ).toMatchObject({ background: "#f8fafc" });
});
