// Test helpers for the library toolbar: its menus and tooltips are Radix, which
// opens a menu on the pointer and a tooltip on focus.
import { act, fireEvent, screen } from "@testing-library/react";

// Open a library menu the way a press does.
export const pointerOpen = (trigger: HTMLElement): void => {
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
};

// Open a library menu from the keyboard (focus its first row).
export const keyOpen = (trigger: HTMLElement): void => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
};

// What a control's tooltip says: focus shows it, blur hides it.
export function tipOf(control: HTMLElement): string {
  act(() => {
    fireEvent.focus(control);
  });
  const text = screen
    .queryAllByRole("tooltip")
    .map((tip) => tip.textContent ?? "")
    .join(" ");
  act(() => {
    fireEvent.blur(control);
  });
  return text;
}
