// The capture menu's Display section: the displays the host lists while the
// menu is open, and the choice a row makes. The rows are display-picker-model.ts;
// this is the loop that feeds them.
//
// [SAFETY] Thumbnails show what is on the owner's displays. They are fetched only
// while the menu is open, held in this hook's state, dropped when it closes and
// never stored, logged or sent anywhere. (The Display rows draw names and
// positions only.)
import { useCallback, useEffect, useState } from "react";
import { listHostDisplays, setHostCaptureDisplay } from "../../host-adapter";
import {
  type ListState,
  LOADING,
  listStateOf,
  nextRefreshDelay,
} from "./display-picker-model";

// Lists the displays now and again every DISPLAY_REFRESH_MS, for as long as
// `active` (the menu is open). A response that arrives after that is ignored.
export function useDisplayList(active: boolean): {
  list: ListState;
  refresh(): void;
} {
  const [list, setList] = useState<ListState>(LOADING);
  const [round, setRound] = useState(0);
  useEffect(() => {
    // `round` restarts the loop for an immediate refresh.
    void round;
    if (!active) {
      setList(LOADING);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const startedAt = Date.now();
      const listing = await listHostDisplays();
      if (!live) return;
      setList(listStateOf(listing));
      timer = setTimeout(
        () => void run(),
        nextRefreshDelay(startedAt, Date.now()),
      );
    };
    void run();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, round]);
  return { list, refresh: useCallback(() => setRound((n) => n + 1), []) };
}

// Pins capture to a display (null: follow the browser). "ok" closes the menu;
// when the display went away the shell's answer unpinned it (and the toast says
// so), so the list is read again and the menu stays for another choice.
export async function chooseDisplay(
  displayId: number | null,
  hooks: { done(): void; gone(): void },
): Promise<void> {
  const outcome = await setHostCaptureDisplay(displayId);
  if (outcome === "ok") hooks.done();
  else if (outcome === "display-unavailable") hooks.gone();
}
