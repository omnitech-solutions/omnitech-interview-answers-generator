"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import React, { useEffect, useState } from "react";
import { useStudio } from "./studio/context";

const THEME_STORAGE_KEY = "interview-playground.theme";

export function useStudioTheme() {
  const studio = useStudio();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (studio) return;
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset["theme"] = nextTheme;
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      document.documentElement.dataset["theme"] = nextTheme;
      return nextTheme;
    });
  }

  // Inside the studio shell, its theme is the only one.
  return studio
    ? { theme: studio.theme, toggleTheme: studio.toggleTheme }
    : { theme, toggleTheme };
}

export function StudioBrand({
  subtitle = "Think clearly. Code confidently.",
}: {
  subtitle?: string;
}) {
  return (
    <a
      className="topbar-brand"
      href="./knowledge"
      aria-label="Interview product home"
    >
      <span className="brand-symbol" aria-hidden="true">
        <BrandMark />
      </span>
      <div className="brand-copy">
        <h1 aria-label="Interview Studio">
          Interview<span>Studio</span>
        </h1>
        <p>{subtitle}</p>
      </div>
    </a>
  );
}

export function ThemeToggle({
  theme,
  onClick,
}: {
  theme: "light" | "dark";
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={onClick}
      icon={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
            </>
          ) : (
            <path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z" />
          )}
        </svg>
      }
    />
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 38 38"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 8.5h19v14h-9l-6.5 5v-5H9.5z" />
      <path d="m14 13 3 3-3 3M20 19h4" />
      <path d="m28.5 5 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}
