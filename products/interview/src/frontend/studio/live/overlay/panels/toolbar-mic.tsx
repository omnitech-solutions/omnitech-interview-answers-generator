// The microphone control, with Zoom's semantics: listening is neutral, muted is
// red and slashed, lost or retrying is an amber outline with a "!" badge. The
// caret lists the devices (when the shell sends them), says "Microphone lost ·
// Trying again · attempt n" and offers "Retry now". The Alt+R toggle is the same
// press as ever (s.press("toggle-mic")); the device list and the attempt count
// are optional: a shell that sends neither gets the plain menu and a Retry now
// that restarts the engine.
import { IconButton, SplitButton } from "@oc-tech/omni-ui-components";
import { Icon } from "../../../icon";
import { nativeChord } from "../../shared/shortcuts";
import { MIC_MENU_TEXT } from "./mic-menu-model";
import type { PanelSession } from "./panel-views";
import { useToolbarLock } from "./toolbar-lock";
import { chordGlyphs, micLook, PAUSED_REASON, toneProp } from "./toolbar-model";
import { useMicMenu } from "./use-mic-menu";

const DEFAULT_DEVICE = "default";

// What the microphone says about itself, from the one panel session.
function useMic(s: PanelSession) {
  const lock = useToolbarLock();
  const menu = useMicMenu(s.engine);
  const recording = s.live.mic === "listening";
  const name = recording ? "Stop microphone" : "Start microphone";
  const look = micLook({
    recording,
    status: menu.menu.status,
    attempt: menu.menu.attempt,
    name,
  });
  // ONE predicate (the engine's micAction, through s.micHeld) and the pause
  // decide the lock: a held or paused session shows the control disabled with
  // the reason, never a label the press would contradict.
  const reason = lock ?? (s.paused || s.micHeld ? PAUSED_REASON : null);
  return { lock, menu, recording, name, look, reason };
}

export function MicControl({
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
  const { lock, menu, recording, name, look, reason } = useMic(s);
  const model = menu.menu;
  const chord = nativeChord("listening");
  const lostNotice =
    model.status === "lost" || model.status === "retrying"
      ? {
          tone: "warning" as const,
          title: MIC_MENU_TEXT.status.lost,
          ...(model.status === "retrying"
            ? { detail: `Trying again · attempt ${model.attempt}` }
            : {}),
          ...(model.retry?.enabled
            ? {
                action: {
                  label: model.retry.label,
                  onSelect: menu.retry,
                },
              }
            : {}),
        }
      : undefined;
  const devices = model.canChooseDevice
    ? [
        {
          id: "devices",
          label: "Microphone",
          highlightChecked: false,
          items: model.devices.map((row) => ({
            id: row.id ?? DEFAULT_DEVICE,
            label: row.name,
            checked: row.checked,
          })),
        },
      ]
    : [];
  return (
    <SplitButton
      data-testid="pn-mic"
      {...toneProp(reason !== null ? "dim" : look.tone)}
      {...(look.badge && reason === null ? { status: look.badge } : {})}
      main={{
        label: name,
        icon: <Icon name={look.icon} />,
        pressed: recording,
        tooltip: look.say,
        shortcut: [chord],
        ...(reason !== null
          ? { disabledReason: reason }
          : !s.open
            ? { disabled: true }
            : {}),
        onPress: () => s.press("toggle-mic"),
      }}
      caret={{
        label: "Microphone options",
        ...(lock ? { disabledReason: lock } : {}),
      }}
      open={open}
      onOpenChange={onOpenChange}
      menu={{
        label: "Microphone options",
        width: 300,
        container,
        ...(lostNotice ? { notice: lostNotice } : {}),
        sections: [
          ...devices,
          {
            id: "listening",
            items: [
              {
                id: "toggle",
                label: recording ? "Stop listening" : "Start listening",
                icon: <Icon name={recording ? "mic_off" : "mic"} />,
                shortcut: [chordGlyphs(chord)],
                ...(reason !== null || !s.open
                  ? { disabledReason: reason ?? "The session has ended" }
                  : {}),
              },
            ],
          },
        ],
        onValueChange: (sectionId, id) => {
          if (sectionId === "devices")
            menu.select(id === DEFAULT_DEVICE ? null : id);
        },
        onSelect: (id) => {
          if (id === "toggle") s.press("toggle-mic");
        },
      }}
    />
  );
}

// The microphone alone, for the Mini player.
export function MicButton({ s }: { s: PanelSession }) {
  const { menu, recording, name, look, reason } = useMic(s);
  const chord = nativeChord("listening");
  return (
    <IconButton
      variant="ghost"
      iconSize="control"
      label={name}
      tooltip={`${look.say} · ${chord}`}
      icon={<Icon name={look.icon} />}
      pressed={recording}
      {...toneProp(reason !== null ? "dim" : look.tone)}
      {...(look.badge && reason === null ? { badge: look.badge } : {})}
      {...(reason !== null ? { disabledReason: reason } : {})}
      disabled={!s.open}
      data-held={s.micHeld ? "true" : undefined}
      data-mic={menu.menu.status}
      onClick={() => s.press("toggle-mic")}
    />
  );
}
