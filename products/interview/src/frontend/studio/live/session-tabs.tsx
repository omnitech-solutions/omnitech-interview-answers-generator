// The Transcript, Activity and Sources tabs: a roving-tabindex tablist (arrow
// keys, Home and End move and select) over one tab panel.
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export type SessionTabId = "transcript" | "activity" | "sources";
export const SESSION_TABS: readonly { id: SessionTabId; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "activity", label: "Activity" },
  { id: "sources", label: "Sources" },
];

export function SessionTabs({
  tab,
  onTab,
  children,
}: {
  tab: SessionTabId;
  onTab(next: SessionTabId): void;
  children: ReactNode;
}) {
  const prefix = useId();
  const buttons = useRef<Partial<Record<SessionTabId, HTMLButtonElement>>>({});
  const move = (event: KeyboardEvent, from: number) => {
    const last = SESSION_TABS.length - 1;
    const to =
      event.key === "ArrowRight"
        ? (from + 1) % SESSION_TABS.length
        : event.key === "ArrowLeft"
          ? (from + last) % SESSION_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const next = SESSION_TABS[to];
    if (!next) return;
    onTab(next.id);
    // The owner pressed the key: moving focus with the selection is expected.
    buttons.current[next.id]?.focus();
  };
  return (
    <section className="live-tabs" aria-label="Session details">
      <div role="tablist" aria-label="Session details" className="live-tablist">
        {SESSION_TABS.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              if (element) buttons.current[entry.id] = element;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`${prefix}-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            className="live-tab"
            onClick={() => onTab(entry.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel-${tab}`}
        aria-labelledby={`${prefix}-tab-${tab}`}
        className="live-tabpanel"
      >
        {children}
      </div>
    </section>
  );
}
