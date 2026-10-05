import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

// The one modal dialog: labelled, `aria-modal`, closes on Escape or a press on
// the scrim, takes focus when it opens (unless a child already has it) and
// gives focus back to whatever opened it.
export function Dialog({
  title,
  onClose,
  scrimClassName,
  className,
  style,
  children,
}: {
  title: string;
  onClose(): void;
  scrimClassName?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // [STRATEGY] Callers pass an inline onClose that changes every render; the
  // latest one is read at event time so the open/close effect runs once and a
  // re-render (a keystroke, a timer) never steals focus back to the panel.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    if (!panel.current?.contains(document.activeElement))
      panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <div
      className={scrimClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div
        ref={panel}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
