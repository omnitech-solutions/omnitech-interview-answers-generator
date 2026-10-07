// What the missing-context strip's actions do on the web page. "Add another
// screenshot" captures the shared source for the task on show (asking for a
// source first, in the same click, when none is shared) and revises that task
// (use-hands-free.ts); it says why when it cannot run here. The web page has no
// follow-up box (the native app has the chat), so "Add context" says so.
import { useContext } from "react";
import { HandsFreeContext } from "./overlay/hands-free-context";
import type { HandsFree } from "./overlay/use-hands-free";
import { DEVICE_ONLY_ANALYZE } from "./shared/capture-problem";
import type { MissingContextActionId } from "./shared/missing-context-strip";

// Straight from the click: the browser asks for a source only inside a gesture.
async function attachScreenshot(hf: HandsFree): Promise<void> {
  if (hf.share.status !== "sharing" && !(await hf.share.start())) return;
  await hf.analyze({ kind: "attach" }, "share", true);
}

export function useMissingContextActions(dismiss: () => void) {
  const hf = useContext(HandsFreeContext);
  const unavailable: Partial<Record<MissingContextActionId, string>> = {
    context: "Add context from the Interview Studio app.",
  };
  if (!hf) unavailable.screenshot = "Capture is not available on this page.";
  else if (!hf.open)
    unavailable.screenshot = "The session is not taking captures now.";
  else if (hf.deviceOnly) unavailable.screenshot = DEVICE_ONLY_ANALYZE;
  else if (!hf.owns)
    unavailable.screenshot =
      "Another Studio window owns the screen. Add the screenshot there.";
  const onAction = (id: MissingContextActionId) => {
    if (id === "dismiss") dismiss();
    else if (id === "screenshot" && hf) void attachScreenshot(hf);
  };
  return { onAction, unavailable };
}
