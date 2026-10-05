// The Transcript, Activity and Sources tabs: a roving-tabindex tablist (arrow
// keys, Home and End move and select) over one tab panel.
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export type SessionTabId = "transcript" | "activity" | "sources";
const SESSION_TABS: readonly { id: SessionTabId; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "activity", label: "Activity" },
  { id: "sources", label: "Sources" },
];

// What a tab's red dot says, for the tab that carries one.
const ALERT_TEXT: Partial<Record<SessionTabId, string>> = {
  sources: "A selected source is not receiving.",
};

export function SessionTabs({
  tab,
  onTab,
  alerts = {},
  children,
}: {
  tab: SessionTabId;
  onTab(next: SessionTabId): void;
  // Tabs that need attention: a red dot, and the reason for assistive tech.
  alerts?: Partial<Record<SessionTabId, boolean>>;
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
            aria-description={
              alerts[entry.id] ? ALERT_TEXT[entry.id] : undefined
            }
            data-alert={alerts[entry.id] || undefined}
          >
            {entry.label}
            {alerts[entry.id] && (
              <span className="live-tab-dot" aria-hidden="true" />
            )}
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
