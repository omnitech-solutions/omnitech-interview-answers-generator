// The toolbar's other controls, from library parts: the answer style (its full
// name, a grouped menu with a fixed check column and the app's real keys in the
// hint row), the panel toggles (ONE segmented group; the last visible panel
// cannot be turned off), See-through and the shortcut list.
import {
  ActionMenu,
  Button,
  IconButton,
  SegmentedPrimitive,
} from "@oc-tech/omni-ui-components";
import { Icon } from "../../../icon";
import { SKILLS } from "../../shared/skills";
import {
  CHAT_VIEWS,
  setChatView,
  useChatView,
  VIEW_GROUPS,
} from "./chat-view-pref";
import { DEFAULT_SKILL } from "./commands";
import type { PanelGlass } from "./panel-glass";
import type { PanelSession } from "./panel-views";
import type { Panes } from "./single-panel";
import {
  answerStyleRows,
  PANES,
  type PaneId,
  SEE_THROUGH_CONTROL,
  seeThroughTitle,
} from "./toolbar-config";
import { useToolbarLock } from "./toolbar-lock";
import {
  answerStyleHint,
  answerStyleSections,
  LAST_PANE_REASON,
  PAUSED_PANES_REASON,
  shortcutSections,
} from "./toolbar-model";

// The answer style: the chosen style's full name (up to 260 px, then an
// ellipsis with the whole name as a tooltip) opens the grouped menu.
// The window's layout: the coach layouts (the call on top, the notes beneath)
// and the classic ones. One choice, kept for the next session.
export function ViewMenu({
  container,
  open,
  onOpenChange,
}: {
  container: HTMLElement | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const lock = useToolbarLock();
  const view = useChatView();
  const label = CHAT_VIEWS.find((each) => each.id === view)?.label ?? "";
  return (
    <ActionMenu
      label="View"
      title="How the window is laid out"
      width={300}
      container={container}
      sections={VIEW_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        labelStyle: "caps" as const,
        items: CHAT_VIEWS.filter((each) => each.group === group.id).map(
          (each) => ({
            id: each.id,
            label: each.label,
            subtitle: each.hint,
            checked: each.id === view,
          }),
        ),
      }))}
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={(_group, id) => {
        const next = CHAT_VIEWS.find((each) => each.id === id);
        if (next) setChatView(next.id);
      }}
      trigger={
        <Button
          buttonSize="control"
          tone="neutral"
          icon={<Icon name="visibility" />}
          iconAfter={<Icon name="expand_more" />}
          labelMaxWidth="var(--oui-control-label-max)"
          aria-label={`View: ${label}`}
          data-testid="pn-view"
          {...(lock ? { disabled: true, title: lock } : {})}
        >
          {label}
        </Button>
      }
    />
  );
}

export function AnswerStyleMenu({
  s,
  container,
  open,
  onOpenChange,
}: {
  s: PanelSession;
  container: HTMLElement | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const lock = useToolbarLock();
  const skill = SKILLS.find((option) => option.id === s.skill)?.label ?? "";
  const rows = answerStyleRows(s.skill ?? DEFAULT_SKILL);
  return (
    <ActionMenu
      label="Answer style"
      title="Answer style for new work"
      width={290}
      container={container}
      sections={answerStyleSections(rows)}
      hint={answerStyleHint()}
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={(_group, id) => {
        const style = SKILLS.find((option) => option.id === id);
        if (style) s.setSkill(style.id);
      }}
      trigger={
        <Button
          buttonSize="control"
          tone="neutral"
          icon={<Icon name="school" />}
          iconAfter={<Icon name="expand_more" />}
          labelMaxWidth="var(--oui-control-label-max)"
          aria-label={`Answer style: ${skill}`}
          data-testid="pn-skill"
          {...(lock ? { disabled: true, title: lock } : {})}
        >
          {skill}
        </Button>
      }
    />
  );
}

// Chat, Answer and Code as one segmented group. While paused the toggles wait
// and say why.
export function PaneToggles({ s, panes }: { s: PanelSession; panes: Panes }) {
  const lock = useToolbarLock();
  const reason = lock ?? (s.paused ? PAUSED_PANES_REASON : null);
  const shown = PANES.filter((pane) => panes.shown[pane.id]).map(
    (pane) => pane.id,
  );
  return (
    <SegmentedPrimitive
      mode="multiple"
      appearance="control"
      minActive={1}
      minActiveReason={LAST_PANE_REASON}
      data-testid="pn-panes"
      value={shown}
      options={PANES.map((pane) => ({
        value: pane.id,
        ariaLabel: pane.label,
        icon: <Icon name={pane.icon} />,
        ...(reason !== null ? { disabledReason: reason } : {}),
      }))}
      onChange={(next) => {
        const changed = PANES.find(
          (pane) => next.includes(pane.id) !== shown.includes(pane.id),
        );
        if (changed) panes.toggle(changed.id as PaneId);
      }}
    />
  );
}

// The one See-through switch: clear glass, and (where the shell can) pass-through
// over empty glass. The Mini player draws the same one.
export function SeeThroughButton({
  glass,
  passThrough,
}: {
  glass: PanelGlass;
  passThrough: boolean;
}) {
  // [SAFETY] Never locked: with clear glass on, See-through is how a person gets
  // the window back, and the choice outlives sign-out. The lock names what is
  // missing for the other controls; this one needs nothing.
  return (
    <IconButton
      variant="ghost"
      iconSize="control"
      data-testid="pn-see-through"
      label={SEE_THROUGH_CONTROL.label}
      tooltip={seeThroughTitle(glass.clear, passThrough)}
      icon={<Icon name={SEE_THROUGH_CONTROL.icon} />}
      pressed={glass.clear}
      onClick={glass.toggle}
    />
  );
}

// The shortcut list: read-only, grouped Capture, Listening, View, Answer style
// and App, with macOS glyphs and "Clear session memory" last in red.
export function ShortcutsMenu({
  container,
  open,
  onOpenChange,
}: {
  container: HTMLElement | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  // Before a session runs the list waits with the rest of the controls.
  const lock = useToolbarLock();
  return (
    <ActionMenu
      kind="list"
      label="Keyboard shortcuts"
      width={300}
      align="end"
      container={container}
      sections={shortcutSections()}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <IconButton
          variant="ghost"
          iconSize="control"
          label="Keyboard shortcuts"
          tooltip="Shortcuts"
          icon={<Icon name="keyboard" />}
          {...(lock ? { disabledReason: lock } : {})}
        />
      }
    />
  );
}
