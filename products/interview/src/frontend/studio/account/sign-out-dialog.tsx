import type { ProductMember } from "@omnitech/platform-contracts";
import { useEffect, useId, useRef, useState } from "react";
import { getSessionStore, tenantFromLocation } from "../live/session-registry";
import { goTo } from "./navigate";
import { signedOutPath, signOutOfBrowser } from "./sign-out";
import { Button } from "../../ui";

// The sign-out confirmation. With a live session it warns, and confirming ends
// the session first (so capture stops) and only then signs out; if the
// session cannot be ended, nothing is signed out. Focus starts on Cancel, Tab
// stays inside, Escape or the scrim cancels.
export function SignOutDialog({
  kind,
  liveSession,
  onCancel,
}: {
  kind: ProductMember["kind"];
  liveSession: boolean;
  onCancel(): void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [failure, setFailure] = useState("");
  useEffect(() => cancelRef.current?.focus(), []);
  const local = kind === "local";

  async function confirm() {
    setState("working");
    if (liveSession) {
      const ended = await getSessionStore(tenantFromLocation()).actions.end();
      if (!ended.ok) {
        setFailure(
          "The session could not be ended, so you are still signed in.",
        );
        setState("failed");
        return;
      }
    }
    const result = await signOutOfBrowser();
    if (!result.ok) {
      setFailure("Signing out did not work. Try again.");
      setState("failed");
      return;
    }
    goTo(signedOutPath(kind));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && state !== "working") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="studio-modal-scrim"
      data-testid="sign-out-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget && state !== "working")
          onCancel();
      }}
    >
      <div
        className="studio-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <div id={titleId} className="studio-modal-title">
          {local ? "Leave local session?" : "Sign out of Interview Studio?"}
        </div>
        {liveSession ? (
          <div className="studio-modal-warning" role="alert">
            A live session is running. Signing out ends it and stops capture.
          </div>
        ) : null}
        <p id={bodyId} className="studio-modal-body">
          {local
            ? "Your local data is kept. Anyone using this computer can continue as the local user again."
            : "This ends your session in this browser. Other devices, including the Mac app, stay signed in."}
        </p>
        {state === "failed" ? (
          <p className="studio-modal-error" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="studio-modal-actions">
          <Button
            ref={cancelRef}
            disabled={state === "working"}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            ref={confirmRef}
            disabled={state === "working"}
            onClick={() => void confirm()}
          >
            {liveSession ? "End session and sign out" : "Sign out"}
          </Button>
        </div>
      </div>
    </div>
  );
}
