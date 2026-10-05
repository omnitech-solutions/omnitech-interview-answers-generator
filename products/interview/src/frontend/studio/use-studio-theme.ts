import { useCallback, useEffect, useRef, useState } from "react";

type StudioTheme = "light" | "dark";

// The platform shell owns the document theme (and the member's saved
// preference). The studio follows `data-theme` and asks the shell to change it.
const THEME_CHANGE_EVENT = "platform-theme-change";

const documentTheme = (): StudioTheme =>
  document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";

export function useStudioTheme() {
  const [theme, setTheme] = useState<StudioTheme>("light");
  const current = useRef(theme);
  current.current = theme;

  useEffect(() => {
    setTheme(documentTheme());
    const observer = new MutationObserver(() => setTheme(documentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = useCallback(() => {
    const next = current.current === "dark" ? "light" : "dark";
    // Optimistic: the shell applies it to the document right after.
    setTheme(next);
    window.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }),
    );
  }, []);

  return { theme, toggleTheme };
}
