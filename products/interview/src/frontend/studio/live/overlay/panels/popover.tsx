// A button with a floating panel under it: the capture menu, the answer-style
// menu and the shortcut list are all this one primitive. It is controlled (the
// toolbar keeps one open at a time), closes on Escape or a press outside, moves
// focus into the panel when it opens and gives it back to the button when it
// closes. A menu panel is also navigable with the arrow keys.
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { useDismiss } from "../use-dismiss";
import { useToolbarLock } from "./toolbar-lock";

const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

type PopoverProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  // The button's own look and name. `label` names the panel; the button says
  // `triggerLabel` when it has one (the label plus the value it now shows).
  className: string;
  label: string;
  triggerLabel?: string;
  title?: string;
  trigger: ReactNode;
  // "menu": items with role menuitem*; "dialog": a read-only panel.
  kind: "menu" | "dialog";
  panelClassName: string;
  testId?: string;
  // Where Escape or Tab gives focus back: another element, or null for the
  // trigger itself.
  returnFocus?: () => HTMLElement | null;
  // The panel's content; `close` shuts it and gives focus back to the button.
  children(close: () => void): ReactNode;
};

export function Popover(props: PopoverProps) {
  const { open, onOpenChange, kind } = props;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  // Before a session runs the trigger is disabled and says what is missing.
  const lock = useToolbarLock();
  const close = () => onOpenChange(false);
  useDismiss(root, open, close);

  // Opening moves focus into the panel: the chosen item of a menu (or the first
  // one), the panel itself for a read-only list.
  useEffect(() => {
    if (!open) return;
    const first =
      panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      panel.current?.querySelector<HTMLElement>(ITEM);
    (first ?? panel.current)?.focus();
  }, [open]);

  // Closing by Escape or Tab returns to the button; a press elsewhere moves
  // focus where the person pointed, which is left alone.
  const closeToButton = () => {
    // The target is read before closing: closing may reset what it depends on.
    const target = props.returnFocus?.() ?? button.current;
    close();
    target?.focus();
  };
  const onPanelKey = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeToButton();
      return;
    }
    if (event.key === "Tab") {
      closeToButton();
      return;
    }
    if (kind !== "menu") return;
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const items = [
      ...(panel.current?.querySelectorAll<HTMLElement>(ITEM) ?? []),
    ];
    if (step === 0 || items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="pn-popover" ref={root}>
      <button
        ref={button}
        type="button"
        className={props.className}
        aria-label={props.triggerLabel ?? props.label}
        title={lock ?? props.title}
        disabled={lock !== null}
        aria-haspopup={kind}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={props.testId}
        onClick={() => onOpenChange(!open)}
      >
        {props.trigger}
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          className={props.panelClassName}
          role={kind === "menu" ? "menu" : "dialog"}
          aria-label={props.label}
          tabIndex={-1}
          onKeyDown={onPanelKey}
        >
          {props.children(closeToButton)}
        </div>
      )}
    </div>
  );
}
