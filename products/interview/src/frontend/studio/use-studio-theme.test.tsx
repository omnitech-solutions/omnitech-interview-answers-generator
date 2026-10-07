import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioTheme } from "./use-studio-theme";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("useStudioTheme", () => {
  it("follows the theme the platform shell applied to the document", async () => {
    document.documentElement.dataset["theme"] = "dark";
    const { result } = renderHook(() => useStudioTheme());
    await waitFor(() => expect(result.current.theme).toBe("dark"));

    act(() => {
      document.documentElement.dataset["theme"] = "light";
    });
    await waitFor(() => expect(result.current.theme).toBe("light"));
  });

  it("asks the shell to change the theme instead of writing the document or storage", async () => {
    document.documentElement.dataset["theme"] = "dark";
    const asked = vi.fn();
    window.addEventListener("platform-theme-change", asked);
    const { result } = renderHook(() => useStudioTheme());
    await waitFor(() => expect(result.current.theme).toBe("dark"));

    act(() => result.current.toggleTheme());
    window.removeEventListener("platform-theme-change", asked);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(
      (asked.mock.calls[0]![0] as CustomEvent<{ theme: string }>).detail,
    ).toEqual({ theme: "light" });
    expect(result.current.theme).toBe("light");
    // The shell, not the hook, owns the DOM attribute and the saved choice.
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.length).toBe(0);
  });
});
