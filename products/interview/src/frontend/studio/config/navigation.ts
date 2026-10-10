import type { CommandItem, MenuItem } from "@oc-tech/omni-ui-components";
import type { ProductLink } from "@omnitech/platform-contracts";
import type { StudioLists } from "../use-studio-lists";
import type { Command, CommandContext } from "./commands";
import type { ViewDefinition, ViewIndicator } from "./views";

// Metadata for the pending Menu/CommandPopover library additions. No renderer
// consumes these files yet; the installed library does not draw this metadata.
export type NavigationItem = MenuItem & {
  type?: "group";
  href?: string;
  shortcut?: string[];
  indicator?: { label: string; tone: "danger" };
  current?: boolean;
  children?: NavigationItem[];
};
export type PaletteItem = CommandItem & { group: string; shortcut?: string };

export function navigationItems({
  views,
  products,
  recent,
  indicators,
  current,
}: {
  views: readonly Pick<
    ViewDefinition,
    "id" | "label" | "icon" | "goKey" | "indicator"
  >[];
  products: readonly ProductLink[];
  recent: StudioLists["questions"];
  indicators: Partial<Record<ViewIndicator, boolean>>;
  current: { view: string; artifact?: string };
}): NavigationItem[] {
  const items: NavigationItem[] = views.map((view) => ({
    key: view.id,
    label: view.label,
    icon: view.icon,
    shortcut: ["G", view.goKey],
    current: view.id === current.view,
    ...(view.indicator && indicators[view.indicator]
      ? { indicator: { label: "Session in progress", tone: "danger" as const } }
      : {}),
  }));
  const links = products.filter((product) => !product.current);
  if (links.length)
    items.push({
      key: "products",
      type: "group",
      label: "Products",
      children: links.map((product) => ({
        key: `product:${product.productId}`,
        label: product.name,
        href: product.href,
        icon: "grid_view",
      })),
    });
  items.push({
    key: "recent",
    type: "group",
    label: "Recent questions",
    children: recent.slice(0, 6).map((question) => ({
      key: `question:${question.artifactId}`,
      label: question.title,
      current:
        current.view === "work" && current.artifact === question.artifactId,
    })),
  });
  return items;
}

export function paletteItems({
  commands,
  lists,
  context,
}: {
  commands: readonly Pick<
    Command,
    "id" | "label" | "icon" | "group" | "shortcut" | "when"
  >[];
  lists: Pick<StudioLists, "questions" | "briefings" | "briefs">;
  context: CommandContext;
}): PaletteItem[] {
  return [
    ...commands
      .filter((command) => command.when?.(context) ?? true)
      .map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        group: command.group,
        ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      })),
    ...lists.questions.map((item) => ({
      id: `question:${item.artifactId}`,
      label: item.title,
      group: "Questions",
      icon: "terminal",
    })),
    ...lists.briefings.map((item) => ({
      id: `pack:${item.id}`,
      label: item.title,
      group: "Behavioural packs",
      icon: "lightbulb",
    })),
    ...lists.briefs.map((item) => ({
      id: `brief:${item.id}`,
      label: item.title,
      group: "Briefings",
      icon: "lightbulb",
    })),
  ];
}
