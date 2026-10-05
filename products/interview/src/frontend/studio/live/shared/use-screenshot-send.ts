// The "Screenshots to the model" setting of the open session as the UI needs
// it: the SAVED value from `session.screenshotSend`, why it cannot change, and
// the save (one POST per change). Both live surfaces call it; the server's
// record is the only truth, so a refused save leaves the saved value showing.
import type {
  LiveScreenshotSend,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { useCallback, useState } from "react";
import type { CommandResult, SessionCommand } from "../session-snapshot";
import {
  savedScreenshotSend,
  screenshotSendDisabledReason,
  screenshotSendFailureText,
} from "./screenshot-send";

export function useScreenshotSend(input: {
  session: LiveSessionView | null;
  // The store's pending commands, when the caller has them.
  pending?: readonly SessionCommand[];
  save(value: LiveScreenshotSend): Promise<CommandResult>;
}) {
  const { session, pending = [], save } = input;
  const [wanted, setWanted] = useState<LiveScreenshotSend | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const saved = savedScreenshotSend(session);
  const saving = wanted !== null || pending.includes("screenshot-send");
  const choose = useCallback(
    (value: LiveScreenshotSend) => {
      setFailure(null);
      setWanted(value);
      void save(value).then((result) => {
        setWanted(null);
        if (!result.ok) setFailure(screenshotSendFailureText(result.code));
      });
    },
    [save],
  );
  return {
    // While a save is out the choice shows as made; once it settles the
    // server's record (or the unchanged one after a refusal) is shown.
    value: wanted ?? saved,
    saved,
    saving,
    failure,
    disabledReason: screenshotSendDisabledReason({
      policy: session?.processingPolicy ?? null,
      status: session?.status ?? null,
    }),
    choose,
  };
}
