"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import React, { useEffect, useState } from "react";

export type StudioWorkspace =
  | "playground"
  | "concept-lab"
  | "mock-interview"
  | "library";

const THEME_STORAGE_KEY = "interview-playground.theme";

const workspaces = [
  {
    id: "playground",
    href: "/",
    title: "Playground",
    description: "Solve, run, and test code",
  },
  {
    id: "concept-lab",
    href: "/?view=concept-lab",
    title: "Concept Lab",
    description: "Prepare concise talking points",
  },
  {
    id: "mock-interview",
    href: "/?view=mock-interview",
    title: "Mock Interview",
    description: "Run a timed, scored rehearsal",
  },
  {
    id: "library",
    href: "/library",
    title: "Library",
    description: "Search reviewed interview references",
  },
] as const;

export function useStudioTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
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

  return { theme, toggleTheme };
}

export function StudioBrand({
  subtitle = "Think clearly. Code confidently.",
}: {
  subtitle?: string;
}) {
  return (
    <a className="topbar-brand" href="/" aria-label="Interview Studio home">
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

export function NavigationToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      className="navigation-toggle"
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
      onClick={onClick}
      icon={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      }
    />
  );
}

export function StudioNavigation({
  active,
  onSelect,
  onClose,
}: {
  active: StudioWorkspace;
  onSelect?: (
    workspace: "playground" | "concept-lab" | "mock-interview",
  ) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button
        className="navigation-scrim"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <nav className="studio-navigation" aria-label="Studio">
        <span className="eyebrow">WORKSPACES</span>
        {workspaces.map((workspace) => {
          const content = (
            <>
              <strong>{workspace.title}</strong>
              <span>{workspace.description}</span>
            </>
          );
          if (onSelect && workspace.id !== "library") {
            return (
              <button
                type="button"
                key={workspace.id}
                className={active === workspace.id ? "active" : ""}
                aria-current={active === workspace.id ? "page" : undefined}
                onClick={() => {
                  onSelect(workspace.id);
                  onClose();
                }}
              >
                {content}
              </button>
            );
          }
          return (
            <a
              key={workspace.id}
              className={active === workspace.id ? "active" : ""}
              aria-current={active === workspace.id ? "page" : undefined}
              href={workspace.href}
              onClick={onClose}
            >
              {content}
            </a>
          );
        })}
      </nav>
    </>
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
