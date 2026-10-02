"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import React, { useEffect, useState } from "react";

export type StudioWorkspace =
  | "playground"
  | "interview-preparation"
  | "concept-lab"
  | "mock-interview"
  | "library";

const THEME_STORAGE_KEY = "interview-playground.theme";

const workspaces = [
  {
    id: "playground",
    href: "./workspace",
    title: "Solution Builder",
    description: "Create, run, and test answers",
  },
  {
    id: "concept-lab",
    href: "./workspace?view=concept-lab",
    title: "Briefing",
    description: "Prepare concise talking points",
  },
  {
    id: "interview-preparation",
    href: "./workspace?view=interview-preparation",
    title: "Interview preparation",
    description: "Prepare evidence-backed spoken answers",
  },
  {
    id: "library",
    href: "./knowledge",
    title: "Knowledge",
    description: "Search reviewed interview references",
  },
  {
    id: "mock-interview",
    href: "./workspace?view=mock-interview",
    title: "Rehearsal",
    description: "Run a timed, scored rehearsal",
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
    <a
      className="topbar-brand"
      href="./workspace"
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
    workspace:
      | "playground"
      | "concept-lab"
      | "mock-interview"
      | "interview-preparation",
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
              <span className="workspace-navigation-icon" aria-hidden="true">
                <WorkspaceIcon workspace={workspace.id} />
              </span>
              <span className="workspace-navigation-copy">
                <strong>{workspace.title}</strong>
                <span>{workspace.description}</span>
              </span>
              <svg
                className="workspace-navigation-arrow"
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m7 4 6 6-6 6" />
              </svg>
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

function WorkspaceIcon({ workspace }: { workspace: StudioWorkspace }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (workspace === "playground") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </svg>
    );
  }
  if (workspace === "concept-lab") {
    return (
      <svg {...common}>
        <path d="M9 18h6M10 22h4" />
        <path d="M8.4 15.5A7 7 0 1 1 15.6 15.5c-.9.7-1.4 1.4-1.6 2.5h-4c-.2-1.1-.7-1.8-1.6-2.5Z" />
        <path d="M12 5v2M7.5 7l1.4 1.4M16.5 7l-1.4 1.4" />
      </svg>
    );
  }
  if (workspace === "mock-interview") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2M9 3h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22Z" />
    </svg>
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
