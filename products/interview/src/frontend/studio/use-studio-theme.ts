import { useCallback, useEffect, useState } from "react";

// The studio's light/dark theme, remembered in this browser.
const THEME_STORAGE_KEY = "interview-playground.theme";

export function useStudioTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const nextTheme =
      window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
        ? "dark"
        : "light";
    setTheme(nextTheme);
    document.documentElement.dataset["theme"] = nextTheme;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      document.documentElement.dataset["theme"] = nextTheme;
      return nextTheme;
    });
  }, []);

  return { theme, toggleTheme };
}
