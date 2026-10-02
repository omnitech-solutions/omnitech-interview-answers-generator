"use client";

import {
  type AssistantConfig,
  AssistantRoot,
  useAssistantHost,
} from "@omnitech-assistant/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assistantFeatures,
  assistantPrompts,
  assistantStarters,
  assistantSurfaces,
} from "../assistant-config";
import { useStudioTheme } from "../studio-shell";
import type { WorkspaceAssistant } from "./workspace/workspace-view";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { DockResizer, useDockWidth } from "./dock-resizer";
import { available, type StudioActions } from "./config/commands";
import { viewById } from "./config/views";
import {
  StudioContext,
  type StudioContextValue,
  type StudioViewBinding,
} from "./context";
import { Icon } from "./icon";
import { Sidebar } from "./sidebar";
import { useShortcuts } from "./use-shortcuts";
import { useStudioLists } from "./use-studio-lists";
import { type StudioNavigation, useStudioRoute } from "./use-studio-route";
import { ViewBoundary } from "./view-boundary";

export type StudioProps = {
  // The assistant connection; the artifact comes from the URL.
  assistant: Omit<WorkspaceAssistant, "artifactId">;
};

// Below these widths the sidebar shrinks to icons: always, or while the
// assistant dock is open and needs the room.
const RAIL_WIDTH = 900;
const RAIL_WIDTH_WITH_ASSISTANT = 1400;

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const LEAVE_PREPARATION =
  "Your interview preparation has unsaved changes. Discard them and leave?";

// Interview Studio: sidebar, the current view, and the docked assistant.
// Views, commands and shortcuts all come from config/.
export function Studio({ assistant }: StudioProps) {
  const { theme, toggleTheme } = useStudioTheme();
  const { route, navigate } = useStudioRoute();
  const tenant = /^\/t\/([^/]+)/.exec(route.base)?.[1] ?? "local";
  const lists = useStudioLists({ workspaceId: assistant.workspaceId, tenant });
  const [binding, setBinding] = useState<StudioViewBinding>({});
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const preparationDirty = useRef(false);
  const dock = useDockWidth();

  // [GUARD] Unsaved interview preparation is never discarded silently.
  const mayLeave = useCallback(
    () => !preparationDirty.current || window.confirm(LEAVE_PREPARATION),
    [],
  );
  const leave = useCallback(
    (next: StudioNavigation) => {
      if (!mayLeave()) return;
      preparationDirty.current = false;
      navigate(next);
    },
    [mayLeave, navigate],
  );

  const bindView = useCallback((next: StudioViewBinding) => {
    setBinding(next);
    return () => setBinding((current) => (current === next ? {} : current));
  }, []);
  const context = useMemo<StudioContextValue>(
    () => ({
      theme,
      toggleTheme,
      headerSlot,
      bindView,
      refreshLists: lists.refresh,
    }),
    [theme, toggleTheme, headerSlot, bindView, lists.refresh],
  );

  const workspaceAssistant = useMemo(
    () => ({ ...assistant, artifactId: route.artifact }),
    [assistant, route.artifact],
  );
  // The assistant follows whichever view lent it a draft; hooks are read at
  // call time so the bound view stays in control of its own draft.
  const config: AssistantConfig = {
    client: assistant.client,
    origin: binding.origin ?? {
      workspaceId: assistant.workspaceId,
      artifactId: route.artifact,
      artifactRevision: 0,
    },
    profileId: assistant.profileId,
    product: {
      name: "Interview Studio",
      description:
        "I can read and edit the Question, Main Solution and Tests in Interview Studio. Changes are always proposed first — nothing is applied without you.",
    },
    user: { name: "Local user", initials: "LU" },
    features: assistantFeatures,
    starters: assistantStarters,
    prompts: assistantPrompts,
    surfaces: assistantSurfaces,
    theme,
    layout: { mode: "panel", open: false, width: dock.width },
    // ⌘K belongs to the studio palette.
    shortcuts: { search: "mod+shift+k" },
    host: {
      prepareSend: async () =>
        (await binding.hooks?.current.prepareSend?.()) ??
        binding.origin ??
        config.origin,
      beforeApply: async (record) => {
        await binding.hooks?.current.beforeApply?.(record);
      },
      onApplied: async (receipt, origin) => {
        await binding.hooks?.current.onApplied?.(receipt, origin);
        lists.refresh();
      },
      onReverted: async (record) => {
        await binding.hooks?.current.onReverted?.(record);
        lists.refresh();
      },
      onPreview: (record) => binding.hooks?.current.onPreview?.(record),
      onContextChange: (surfaces) =>
        binding.hooks?.current.onContextChange?.(surfaces),
      onThemeChange: (next) => {
        if (next !== theme) toggleTheme();
      },
      onOpenBinding: ({ workspaceId, artifactId }) => {
        if (workspaceId === assistant.workspaceId)
          leave({ view: "work", artifact: artifactId });
      },
    },
  };

  return (
    <StudioContext.Provider value={context}>
      <div className="studio-app" data-view={route.view}>
        <AssistantRoot config={config}>
          <StudioFrame
            route={route}
            lists={lists}
            theme={theme}
            paletteOpen={paletteOpen}
            setPaletteOpen={setPaletteOpen}
            setHeaderSlot={setHeaderSlot}
            leave={leave}
            runTests={() => binding.runTests?.()}
            toggleTheme={toggleTheme}
            dock={dock}
            renderView={(actions) => (
              <ViewBoundary key={route.view}>
                {viewById(route.view).render({
                  route,
                  assistant: workspaceAssistant,
                  lists,
                  actions,
                  onDirtyChange: (dirty) => {
                    preparationDirty.current = dirty;
                  },
                })}
              </ViewBoundary>
            )}
          />
        </AssistantRoot>
      </div>
    </StudioContext.Provider>
  );
}

// Inside AssistantRoot, so the assistant host (⌘J, open state) is reachable.
function StudioFrame({
  route,
  lists,
  theme,
  paletteOpen,
  setPaletteOpen,
  setHeaderSlot,
  leave,
  runTests,
  toggleTheme,
  dock,
  renderView,
}: {
  route: ReturnType<typeof useStudioRoute>["route"];
  lists: ReturnType<typeof useStudioLists>;
  theme: "light" | "dark";
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  setHeaderSlot(slot: HTMLElement | null): void;
  leave(next: StudioNavigation): void;
  runTests(): void;
  toggleTheme(): void;
  dock: ReturnType<typeof useDockWidth>;
  renderView(actions: StudioActions): ReactNode;
}) {
  const host = useAssistantHost();
  const view = viewById(route.view);
  const width = useWindowWidth();
  const rail =
    width < RAIL_WIDTH || (host.open && width < RAIL_WIDTH_WITH_ASSISTANT);
  const actions: StudioActions = {
    go: (next) => leave({ view: next }),
    openArtifact: (artifact) => leave({ view: "work", artifact }),
    openBriefing: (artifact) => leave({ view: "briefings", rest: [artifact] }),
    openBrief: (id) => leave({ view: "briefings", rest: ["brief", id] }),
    newQuestion: () =>
      leave({ view: "work", artifact: `q-${Date.now().toString(36)}` }),
    runTests,
    toggleTheme,
    toggleAssistant: host.toggle,
  };
  const context = { view: route.view };
  useShortcuts([
    { shortcut: "mod+k", run: () => setPaletteOpen(true) },
    ...available(context)
      .filter((command) => command.shortcut && !command.boundByAssistant)
      .map((command) => ({
        shortcut: command.shortcut!,
        run: () => command.run(actions),
      })),
  ]);
  const paletteItems: PaletteItem[] = [
    ...available(context).map((command) => ({
      id: command.id,
      group: command.group,
      label: command.label,
      icon: command.icon,
      shortcut: command.shortcut,
      run: () => command.run(actions),
    })),
    ...lists.questions.map((question) => ({
      id: `question-${question.artifactId}`,
      group: "Questions",
      label: question.title,
      icon: "code" as const,
      run: () => actions.openArtifact(question.artifactId),
    })),
    ...lists.briefs.map((brief) => ({
      id: `brief-${brief.id}`,
      group: "Briefings",
      label: brief.title,
      icon: "lightbulb" as const,
      run: () => actions.openBrief(brief.id),
    })),
    ...lists.briefings.map((briefing) => ({
      id: `briefing-${briefing.id}`,
      group: "Briefings",
      label: briefing.title,
      icon: "lightbulb" as const,
      run: () => actions.openBriefing(briefing.id),
    })),
  ];

  return (
    <div className={`studio-frame${rail ? " rail" : ""}`}>
      <Sidebar
        view={route.view}
        artifact={route.artifact}
        lists={lists}
        theme={theme}
        onGo={actions.go}
        onOpenArtifact={actions.openArtifact}
        onOpenPalette={() => {
          lists.refresh();
          setPaletteOpen(true);
        }}
        onToggleTheme={toggleTheme}
      />
      <main className="studio-main">
        <header className="studio-header">
          <span className="studio-header-title">{view.label}</span>
          <div className="studio-header-slot" ref={setHeaderSlot} />
          <span className="studio-sees" title="What the assistant can see">
            sees: {view.assistantContext}
          </span>
          <button
            type="button"
            className={`studio-button studio-assistant-toggle${host.open ? " open" : ""}`}
            aria-pressed={host.open}
            title={`Assistant (${host.shortcut})`}
            onClick={host.toggle}
          >
            <Icon name="auto_awesome" />
            Assistant
          </button>
        </header>
        <div className="studio-view">{renderView(actions)}</div>
      </main>
      {host.open && <DockResizer stored={dock.stored} />}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
