// The persistent screen problems and what their fix buttons do. The toolbar
// draws `problems`, calls `fix(id)` from the button, and passes the picker's
// opener so "Pick display" opens the screen picker.
import { useCallback } from "react";
import {
  canOpenExternalThroughHost,
  openExternalThroughHost,
} from "./host-adapter";
import {
  type ScreenFixId,
  type ScreenProblem,
  useScreenProblems,
} from "./screen-problems";
import { SCREEN_RECORDING_SETTINGS_URL } from "./shared/capture-problem";

export function useScreenProblemFix(openPicker: () => void): {
  problems: ScreenProblem[];
  fix(id: ScreenFixId): void;
  // "Open System Settings" needs a host that can open it; without one the
  // problem's title and the System Settings words still say what to do.
  canOpenSettings: boolean;
} {
  const problems = useScreenProblems();
  const fix = useCallback(
    (id: ScreenFixId) => {
      if (id === "pick-display") openPicker();
      else if (canOpenExternalThroughHost())
        openExternalThroughHost(SCREEN_RECORDING_SETTINGS_URL);
    },
    [openPicker],
  );
  return { problems, fix, canOpenSettings: canOpenExternalThroughHost() };
}
