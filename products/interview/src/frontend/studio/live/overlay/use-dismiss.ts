// Closing a popover: a press outside it (listened for on its own document, so it
// works in the PiP's iframe too), or Escape inside it (not while an IME
// composition is active). The Escape handler marks the event handled so the card
// does not also act on it (it restores a maximized card on Escape).
import { type KeyboardEvent, type RefObject, useEffect } from "react";

export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const doc = ref.current?.ownerDocument ?? document;
    const onDown = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    doc.addEventListener("pointerdown", onDown);
    return () => doc.removeEventListener("pointerdown", onDown);
  }, [ref, open, onClose]);
}

export const closeOnEscape =
  (onClose: () => void) =>
  (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
