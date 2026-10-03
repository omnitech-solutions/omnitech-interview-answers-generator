import { useEffect } from "react";

// Guards for slow work a person is watching. They know nothing about
// documents: each takes plain values, so any long-running screen can use them.

/** Ask before the page is left while `active`, because leaving cancels it. */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [active]);
}

/**
 * Call `refresh` when the person comes back to this window, so what another
 * window finished shows up. Quick return trips are ignored.
 */
export function useRefreshOnReturn(refresh: () => void, minimumGapMs = 3000) {
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (
        document.visibilityState === "hidden" ||
        Date.now() - last < minimumGapMs
      )
        return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [refresh, minimumGapMs]);
}

/** Hand each line of a newline-delimited JSON body over as it arrives. */
export async function readNdjson<Event>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Event) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines)
      if (line.trim()) onEvent(JSON.parse(line) as Event);
    if (done) break;
  }
  if (pending.trim()) onEvent(JSON.parse(pending) as Event);
}
