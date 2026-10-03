import type { IconName } from "../icon";
import type { ViewId } from "../use-studio-route";
import { views } from "./views";

// The only ways a command may change the studio.
export type StudioActions = {
  // rest: the path after the view, e.g. ["explanations"] in Briefings.
  go(view: ViewId, rest?: readonly string[]): void;
  openArtifact(artifactId: string): void;
  // A behavioural preparation pack.
  openBriefing(artifactId: string): void;
  // A spoken brief on a concept or system design.
  openBrief(briefId: string): void;
  newQuestion(): void;
  runTests(): void;
  toggleTheme(): void;
  toggleAssistant(): void;
};
export type CommandContext = { view: ViewId };
export type Command = {
  id: string;
  group: "Go to" | "Actions";
  label: string;
  icon: IconName;
  // "mod+k", "mod+enter", "n" or a sequence such as "g w".
  shortcut?: string;
  // The assistant package binds this one itself; it is listed, not bound.
  boundByAssistant?: boolean;
  when?(context: CommandContext): boolean;
  run(actions: StudioActions): void;
};

export const commands: readonly Command[] = [
  ...views.map(
    (view): Command => ({
      id: `go-${view.id}`,
      group: "Go to",
      label: view.label,
      icon: view.icon,
      shortcut: `g ${view.goKey.toLowerCase()}`,
      run: (actions) => actions.go(view.id),
    }),
  ),
  {
    id: "new-question",
    group: "Actions",
    label: "New question",
    icon: "add",
    shortcut: "n",
    run: (actions) => actions.newQuestion(),
  },
  {
    id: "run-tests",
    group: "Actions",
    label: "Run tests",
    icon: "play_arrow",
    shortcut: "mod+enter",
    when: ({ view }) => view === "work",
    run: (actions) => actions.runTests(),
  },
  {
    id: "start-rehearsal",
    group: "Actions",
    label: "Start a rehearsal",
    icon: "play_circle",
    run: (actions) => actions.go("rehearsal"),
  },
  {
    id: "start-live-session",
    group: "Actions",
    label: "Start a live session",
    icon: "sensors",
    run: (actions) => actions.go("live"),
  },
  {
    id: "toggle-theme",
    group: "Actions",
    label: "Toggle theme",
    icon: "contrast",
    run: (actions) => actions.toggleTheme(),
  },
  {
    id: "toggle-assistant",
    group: "Actions",
    label: "Toggle assistant",
    icon: "auto_awesome",
    shortcut: "mod+j",
    boundByAssistant: true,
    run: (actions) => actions.toggleAssistant(),
  },
];

export function available(context: CommandContext) {
  return commands.filter((command) => command.when?.(context) ?? true);
}
