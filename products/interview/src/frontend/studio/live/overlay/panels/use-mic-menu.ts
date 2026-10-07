// The microphone caret menu's state and actions, from the engine view the
// toolbar already has. Selector only: the model is mic-menu-model.ts.
import { useMemo } from "react";
import { type MicMenu, micMenu } from "./mic-menu-model";
import type { EngineView } from "./use-engine";

export type MicMenuView = {
  menu: MicMenu;
  // "Retry now" (a no-op unless menu.retry?.enabled).
  retry(): void;
  // Choose a device row (null: the system default).
  select(deviceId: string | null): void;
};

export function useMicMenu(view: EngineView): MicMenuView {
  const { state, micOn, micHeld, micPending, retryMic, selectMic } = view;
  const menu = useMemo(
    () => micMenu({ state, micOn, held: micHeld, pending: micPending }),
    [state, micOn, micHeld, micPending],
  );
  return { menu, retry: retryMic, select: selectMic };
}
