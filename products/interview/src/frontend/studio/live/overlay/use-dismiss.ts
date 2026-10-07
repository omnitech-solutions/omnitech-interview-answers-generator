// Closing a popover by a press outside it (listened for on its own document).
import { type RefObject, useEffect } from "react";

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
