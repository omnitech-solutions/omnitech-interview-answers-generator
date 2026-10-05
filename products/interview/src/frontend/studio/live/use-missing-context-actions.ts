// What the missing-context strip's actions do on the web page. "Add context"
// takes the person to the follow-up box; "Add another screenshot" captures the
// shared source for the task on show (asking for a source first, in the same
// click, when none is shared). Both revise the task on show (use-hands-free.ts),
// and each says why when it cannot run here.
import { useContext } from "react";
import { HandsFreeContext } from "./overlay/hands-free-context";
import { DEVICE_ONLY_ANALYZE } from "./overlay/overlay-capture";
import { FOCUS_INPUT_EVENT } from "./overlay/panels/commands";
import type { HandsFree } from "./overlay/use-hands-free";
import type { MissingContextActionId } from "./shared/missing-context-strip";

// Straight from the click: the browser asks for a source only inside a gesture.
async function attachScreenshot(hf: HandsFree): Promise<void> {
  if (hf.share.status !== "sharing" && !(await hf.share.start())) return;
  await hf.analyze({ kind: "attach" }, "share");
}

export function useMissingContextActions(dismiss: () => void) {
  const hf = useContext(HandsFreeContext);
  const unavailable: Partial<Record<MissingContextActionId, string>> = {};
  if (!hf) unavailable.screenshot = "Capture is not available on this page.";
  else if (!hf.open)
    unavailable.screenshot = "The session is not taking captures now.";
  else if (hf.deviceOnly) unavailable.screenshot = DEVICE_ONLY_ANALYZE;
  else if (!hf.owns)
    unavailable.screenshot =
      "Another Studio window owns the screen. Add the screenshot there.";
  const onAction = (id: MissingContextActionId) => {
    if (id === "context") window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
    else if (id === "dismiss") dismiss();
    else if (hf) void attachScreenshot(hf);
  };
  return { onAction, unavailable };
}
