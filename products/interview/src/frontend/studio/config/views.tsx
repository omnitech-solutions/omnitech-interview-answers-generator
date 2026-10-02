import type { ReactNode } from "react";
import { Library } from "../../library";
import { MockInterview } from "../../mock-interview";
import {
  type WorkspaceAssistant,
  WorkspaceView,
} from "../workspace/workspace-view";
import { BriefingsView } from "../briefings/briefings-view";
import { HomeView } from "../home/home-view";
import type { IconName } from "../icon";
import type { StudioLists } from "../use-studio-lists";
import type { StudioRoute, ViewId } from "../use-studio-route";
import type { StudioActions } from "./commands";

export type ViewProps = {
  route: StudioRoute;
  assistant: WorkspaceAssistant;
  actions: StudioActions;
  lists: StudioLists;
  onDirtyChange(dirty: boolean): void;
};
export type ViewDefinition = {
  id: ViewId;
  label: string;
  icon: IconName;
  // "W" makes "G W" the shortcut.
  goKey: string;
  // What the docked assistant can see while this view is open.
  assistantContext: string;
  render(props: ViewProps): ReactNode;
};

// One entry per studio view. Later redesign steps swap a render function;
// the shell, sidebar, palette and shortcuts follow this list.
export const views: readonly ViewDefinition[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    goKey: "H",
    assistantContext: "prep plan",
    render: ({ actions, lists }) => (
      <HomeView actions={actions} lists={lists} />
    ),
  },
  {
    id: "work",
    label: "Workspace",
    icon: "terminal",
    goKey: "W",
    assistantContext: "question, code, tests",
    render: ({ assistant }) => (
      <WorkspaceView key={assistant.artifactId} assistant={assistant} />
    ),
  },
  {
    id: "briefings",
    label: "Briefings",
    icon: "lightbulb",
    goKey: "B",
    assistantContext: "briefing",
    render: ({ route, actions, lists, onDirtyChange }) => (
      <BriefingsView
        rest={route.rest}
        actions={actions}
        lists={lists}
        onDirtyChange={onDirtyChange}
      />
    ),
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: "menu_book",
    goKey: "K",
    assistantContext: "search results",
    render: ({ route }) => (
      <Library
        chrome="embedded"
        basePath={`${route.base}/knowledge`}
        initialSlug={route.rest[0]}
      />
    ),
  },
  {
    id: "rehearsal",
    label: "Rehearsal",
    icon: "timer",
    goKey: "R",
    assistantContext: "nothing (rehearsal)",
    render: () => <MockInterview />,
  },
];

export function viewById(id: ViewId) {
  return views.find((view) => view.id === id) ?? views[0]!;
}
