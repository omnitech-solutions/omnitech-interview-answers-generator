// The session switcher: move across the owner's sessions without leaving the
// card. It only re-binds the one session store (actions.switchSession): no
// second store, no second poll, and nothing is sent to the session left
// behind, so a live session keeps running. "New session" goes to the start
// page, which only exists while the store holds no open session.

import {
  ActionMenu,
  type ActionMenuSection,
  Button,
} from "@oc-tech/omni-ui-components";
import type { LiveSessionSummary } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import { presentation } from "../focus-presentation";
import type { SessionActions } from "../session-snapshot";
import { type SessionRow, sessionRow } from "./overlay-model";
import { usePortalRoot } from "./panels/portal-root";

export type SwitcherProps = {
  actions: SessionActions;
  currentId: string | null;
  serverNowMs: number;
  // True while the store holds an open session: only one can be started.
  hasOpenSession: boolean;
  // A switch is being read: the controls wait for it.
  switching: boolean;
  onNewSession(): void;
};

const REFRESH_MS = 15_000;

export function SessionSwitcher({
  actions,
  currentId,
  serverNowMs,
  hasOpenSession,
  switching,
  onNewSession,
}: SwitcherProps) {
  const [sessions, setSessions] = useState<readonly LiveSessionSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const portal = usePortalRoot();

  const load = useCallback(async () => {
    const result = await actions.listSessions();
    if (result.ok) setSessions(result.sessions);
  }, [actions]);
  // Re-read on arrival, on every switch and now and then, so a session started
  // or ended elsewhere shows up.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, currentId]);

  const rows: SessionRow[] = sessions.map((s) => sessionRow(s, serverNowMs));
  const index = rows.findIndex((row) => row.id === currentId);
  const current = rows[index];

  async function go(id: string | undefined) {
    if (!id) return;
    setNote(null);
    const result = await actions.switchSession(id);
    if (result.ok) presentation.pin(null);
    else setNote("Couldn’t open that session.");
    trigger.current?.focus();
  }

  // Rows are newest first: "previous" is the older neighbour.
  const older = index >= 0 ? rows[index + 1] : undefined;
  const newer = index > 0 ? rows[index - 1] : undefined;
  const tone = current?.tone ?? "neutral";
  // Only one session can be live: a new one waits for it to end.
  const blocked =
    hasOpenSession ||
    sessions.some((s) => s.status !== "ended" && s.status !== "purging");

  const sections: ActionMenuSection[] = [
    {
      id: "sessions",
      selection: "single",
      items:
        rows.length === 0
          ? [{ id: "none", label: "No sessions yet", disabled: true }]
          : rows.map((row) => ({
              id: row.id,
              label: row.title,
              description: `${row.statusText} · ${row.timeText}`,
              checked: row.id === currentId,
              disabled: switching,
              onSelect: () => void go(row.id),
            })),
    },
    {
      id: "new",
      items: [
        {
          id: "new-session",
          label: "New session",
          icon: <Icon name="add" />,
          description: "Opens the start page in Studio",
          disabled: blocked,
          ...(blocked
            ? {
                disabledReason:
                  "Only one session can be live at a time. End it first.",
              }
            : {}),
          onSelect: onNewSession,
        },
      ],
    },
  ];

  return (
    <div className="ov-switcher" data-testid="session-switcher">
      <Button
        variant="ghost"
        buttonSize="sm"
        aria-label="Previous session"
        title="Previous (older) session"
        disabled={!older || switching}
        icon={<Icon name="keyboard_arrow_left" />}
        onClick={() => void go(older?.id)}
      />
      <ActionMenu
        label="Sessions"
        sections={sections}
        width={280}
        maxHeight={320}
        container={portal.container}
        returnFocus="always"
        onOpenChange={(open) => {
          if (open) void load();
        }}
        trigger={
          <button
            ref={(element) => {
              trigger.current = element;
              portal.ref(element);
            }}
            type="button"
            className="ov-switcher-current"
          >
            <span className={`ov-dot ${tone}`} aria-hidden="true" />
            <span className="ov-switcher-title">
              {current?.title ?? "Sessions"}
            </span>
            <span className="ov-switcher-status">
              {current ? `${current.statusText} · ${current.timeText}` : ""}
            </span>
            <Icon name="unfold_more" />
          </button>
        }
      />
      <Button
        variant="ghost"
        buttonSize="sm"
        aria-label="Next session"
        title="Next (newer) session"
        disabled={!newer || switching}
        icon={<Icon name="keyboard_arrow_right" />}
        onClick={() => void go(newer?.id)}
      />
      {note && (
        <p className="ov-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
