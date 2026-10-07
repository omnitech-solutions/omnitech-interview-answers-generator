// The capture control: ONE split button. The main half captures (or stops the
// run while one is analysing); the caret opens the capture menu: "When to
// analyse" (Manual or Auto), "Display" (where the host can choose a screen) and
// "Add screen to this task". Manual is neutral and Auto is tinted blue; there is
// no mode pill and no coloured dot, and the tooltip names the mode. A screen
// problem (permission missing, display gone, last capture failed) turns the
// control amber with a "!" badge and leads the menu with the reason and its fix.
//
// [SAFETY] Nothing here conceals capture; the control only asks the one panel
// session to capture or stop.
import { IconButton, SplitButton } from "@oc-tech/omni-ui-components";
import { useEffect } from "react";
import { Icon } from "../../../icon";
import { displaySelectionAvailable, syncHostPin } from "../../host-adapter";
import { noteSource, useCaptureSource } from "../../host-display";
import { nativeChord } from "../../shared/shortcuts";
import { useScreenProblemFix } from "../../use-screen-problems";
import {
  captureButtonTitle,
  listNotice,
  PIN_DROPPED_NOTE,
  pickerRows,
  screenButtonName,
} from "./display-picker-model";
import type { PanelSession } from "./panel-views";
import {
  captureControl,
  captureModeOf,
  SCREEN_CONTROL,
} from "./toolbar-config";
import { chooseDisplay, useDisplayList } from "./toolbar-display";
import { useToolbarLock } from "./toolbar-lock";
import {
  captureSections,
  captureTone,
  displayIdOfRow,
  PAUSED_REASON,
  screenNotice,
  toneProp,
} from "./toolbar-model";

// The tooltip of the main half: the mode, what pressing does, the target where
// the host can choose a screen, and the key.
function mainTooltip(input: {
  stop: boolean;
  title: string;
  mode: string;
  chord: string;
  target: string | null;
}): string {
  if (input.stop) return `${input.title} · ${input.chord}`;
  return `${input.mode}: ${input.target ?? `${input.title} · ${input.chord}`}`;
}

export function CaptureControl({
  s,
  container,
  open,
  onOpenChange,
}: {
  s: PanelSession;
  // Where the menu is drawn: the window's own root (hit regions, tokens).
  container: HTMLElement | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const lock = useToolbarLock();
  const waiting = lock ?? (s.paused ? PAUSED_REASON : null);
  const control = captureControl(Boolean(s.phase));
  const mode = captureModeOf(s.auto.on);
  const source = useCaptureSource();
  const displays = displaySelectionAvailable();
  const chord = nativeChord("analyze");
  const { problems, fix, canOpenSettings } = useScreenProblemFix(() =>
    onOpenChange(true),
  );
  const { list, refresh } = useDisplayList(open && displays);

  // A fresh page learns the shell's saved pin once, on mount, without any
  // thumbnail being taken. ONE line when a pin was dropped (from a capture, a
  // watch or a failed choice), then the shell's own state says follow.
  useEffect(() => {
    if (displays) void syncHostPin();
  }, [displays]);
  const { pinDropped } = source;
  const toast = s.toast;
  useEffect(() => {
    if (!pinDropped) return;
    toast({ title: PIN_DROPPED_NOTE, detail: "" });
    noteSource({ kind: "told" });
  }, [pinDropped, toast]);

  const notice = screenNotice(problems, (problem) =>
    problem.fix.id === "pick-display" ? displays : canOpenSettings,
  );
  const sections = captureSections({
    mode: mode.id,
    auto: s.auto.limits,
    target: s.target?.targetLabel ?? null,
    open: s.open,
    waiting,
    displays: displays
      ? { rows: pickerRows(list, source), notice: listNotice(list) }
      : null,
    chords: { auto: nativeChord("auto") },
  });
  const tooltip = notice
    ? notice.title
    : mainTooltip({
        stop: control.stop,
        title: control.title,
        mode: mode.label,
        chord,
        target:
          displays && !control.stop
            ? captureButtonTitle(control.title, source, chord)
            : null,
      });

  return (
    <SplitButton
      data-testid="pn-capture"
      {...toneProp(
        captureTone({
          waiting: waiting !== null,
          problem: notice !== null,
          analysing: control.stop,
          auto: s.auto.on,
        }),
      )}
      {...(notice && waiting === null
        ? {
            status: {
              tone: "warning" as const,
              label: "!",
              description: notice.title,
            },
          }
        : {})}
      main={{
        label: control.label,
        icon: <Icon name="screenshot_monitor" />,
        state: control.stop ? "analysing" : "idle",
        tooltip,
        ...(waiting !== null
          ? { disabledReason: waiting }
          : !s.open || s.phase === "capturing"
            ? { disabled: true }
            : {}),
        onPress: () => s.press("capture"),
      }}
      caret={{
        label: displays ? screenButtonName(source) : "Capture options",
        // Where the host can choose a screen, the caret's tooltip is the
        // current choice (Following your browser, Pinned: Display 2 of 3).
        ...(displays ? { tooltip: screenButtonName(source) } : {}),
        ...(lock ? { disabledReason: lock } : {}),
      }}
      open={open}
      onOpenChange={onOpenChange}
      openMenuOn={displays ? ["contextmenu", "arrowdown"] : []}
      menu={{
        label: displays ? SCREEN_CONTROL.label : "Capture options",
        width: 320,
        container,
        sections,
        ...(notice
          ? {
              notice: {
                tone: "warning" as const,
                title: notice.title,
                ...(notice.detail ? { detail: notice.detail } : {}),
                ...(notice.fix
                  ? {
                      action: {
                        label: notice.fix.label,
                        onSelect: () => fix(notice.fix?.id ?? "pick-display"),
                      },
                    }
                  : {}),
              },
            }
          : {}),
        onValueChange: (sectionId, id) => {
          if (sectionId === "mode") s.setAuto(captureModeOf(id === "auto").on);
          else if (sectionId === "display")
            void chooseDisplay(displayIdOfRow(id), {
              done: () => undefined,
              gone: () => {
                refresh();
                onOpenChange(true);
              },
            });
        },
        onSelect: (id) => {
          if (id === "attach") s.press("attach");
        },
      }}
    />
  );
}

// The capture button alone, for the Mini player: capture, or Stop while work
// runs. No menu, no mode.
export function CaptureButton({ s }: { s: PanelSession }) {
  const lock = useToolbarLock();
  const control = captureControl(Boolean(s.phase));
  const chord = nativeChord("analyze");
  return (
    <IconButton
      variant="ghost"
      iconSize="control"
      label={control.label}
      tooltip={`${control.title} · ${chord}`}
      icon={<Icon name={control.stop ? "stop_circle" : "screenshot_monitor"} />}
      {...toneProp(control.stop ? "accent" : undefined)}
      {...(lock !== null ? { disabledReason: lock } : {})}
      disabled={!s.open || s.phase === "capturing"}
      onClick={() => s.press("capture")}
    />
  );
}
