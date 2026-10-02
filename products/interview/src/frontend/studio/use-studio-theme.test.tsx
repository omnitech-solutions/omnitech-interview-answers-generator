import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioTheme } from "./use-studio-theme";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("useStudioTheme", () => {
  it("starts from the remembered theme and remembers a change", async () => {
    window.localStorage.setItem("interview-playground.theme", "dark");
    const { result } = renderHook(() => useStudioTheme());
    await waitFor(() => expect(result.current.theme).toBe("dark"));
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(window.localStorage.getItem("interview-playground.theme")).toBe(
      "light",
    );
  });
});
