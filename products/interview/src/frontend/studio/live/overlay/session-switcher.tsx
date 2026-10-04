// The session switcher: move across the owner's sessions without leaving the
// card. It only re-binds the one session store (actions.switchSession): no
// second store, no second poll, and nothing is sent to the session left
// behind, so a live session keeps running. "New session" goes to the start
// page, which only exists while the store holds no open session.
import type { LiveSessionSummary } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../icon";
import { presentation } from "../focus-presentation";
import type { SessionActions } from "../session-snapshot";
import { useMenuPlacement } from "./menu-placement";
import { type SessionRow, sessionRow } from "./overlay-model";

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
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuPlacement(menu, open);

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
    setOpen(false);
    setNote(null);
    const result = await actions.switchSession(id);
    if (result.ok) presentation.pin(null);
    else setNote("Couldn’t open that session.");
    trigger.current?.focus();
  }

  // Escape or a click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const doc = root.current?.ownerDocument ?? document;
    doc.addEventListener("pointerdown", onDown);
    return () => doc.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector<HTMLElement>('[role="menuitemradio"]')
        ?.focus();
  }, [open]);

  function onMenuKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"], [role="menuitem"]',
      ) ?? []),
    ];
    const at = items.indexOf(event.target as HTMLElement);
    const move =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move === 0) return;
    event.preventDefault();
    items[(at + move + items.length) % items.length]?.focus();
  }

  // Rows are newest first: "previous" is the older neighbour.
  const older = index >= 0 ? rows[index + 1] : undefined;
  const newer = index > 0 ? rows[index - 1] : undefined;
  const tone = current?.tone ?? "neutral";
  // Only one session can be live: a new one waits for it to end.
  const blocked =
    hasOpenSession ||
    sessions.some((s) => s.status !== "ended" && s.status !== "purging");

  return (
    <div className="ov-switcher" ref={root} data-testid="session-switcher">
      <button
        type="button"
        className="ov-icon-button"
        aria-label="Previous session"
        title="Previous (older) session"
        disabled={!older || switching}
        onClick={() => void go(older?.id)}
      >
        <Icon name="keyboard_arrow_left" />
      </button>
      <button
        ref={trigger}
        type="button"
        className="ov-switcher-current"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
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
      <button
        type="button"
        className="ov-icon-button"
        aria-label="Next session"
        title="Next (newer) session"
        disabled={!newer || switching}
        onClick={() => void go(newer?.id)}
      >
        <Icon name="keyboard_arrow_right" />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menu}
          role="menu"
          aria-label="Sessions"
          className="ov-menu ov-session-menu"
          onKeyDown={onMenuKey}
        >
          {rows.length === 0 && <p className="ov-menu-note">No sessions yet</p>}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              role="menuitemradio"
              aria-checked={row.id === currentId}
              disabled={switching}
              className="ov-menu-item"
              onClick={() => void go(row.id)}
            >
              <span className={`ov-dot ${row.tone}`} aria-hidden="true" />
              <span className="ov-menu-text">
                <span className="ov-menu-label">{row.title}</span>
                <span className="ov-menu-sub">
                  {row.statusText} · {row.timeText}
                </span>
              </span>
              {row.id === currentId && <Icon name="check" />}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="ov-menu-item ov-menu-new"
            disabled={blocked}
            title={
              blocked
                ? "Only one session can be live at a time. End it first."
                : undefined
            }
            onClick={() => {
              setOpen(false);
              onNewSession();
            }}
          >
            <Icon name="add" />
            <span className="ov-menu-text">
              <span className="ov-menu-label">New session</span>
              <span className="ov-menu-sub">
                {blocked
                  ? "Available once the live session has ended"
                  : "Opens the start page in Studio"}
              </span>
            </span>
          </button>
        </div>
      )}
      {note && (
        <p className="ov-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
