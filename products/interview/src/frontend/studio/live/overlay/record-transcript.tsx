// Record transcript: the owner's own keep of what this session hears, as a
// file on this machine (transcript-recording.ts on the server).
//
// [DOMAIN] It is a control of its own, not an item in a menu, because it must
// be plain at a glance whether it is on: off is a quiet outline button, on is
// a filled red one that says "Recording" and counts its lines.
// [SAFETY] It is off every time the window opens. It turns off when the
// session ends (the server does that) and when this window closes (below),
// and it never comes back on by itself.
import { Button } from "@oc-tech/omni-ui-components";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import { studioFetch } from "../../studio-fetch";
import { tenantFromLocation } from "../session-registry";

type Recording = { on: boolean; lines: number; file?: string };

const POLL_MS = 3_000;
const endpoint = (sessionId: string) =>
  `/api/interview/t/${encodeURIComponent(tenantFromLocation())}/sessions/${encodeURIComponent(sessionId)}/recording`;

async function read(response: Response): Promise<Recording | null> {
  if (!response.ok) return null;
  const body = (await response.json()) as { recording?: Recording };
  return body.recording ?? null;
}

export function useTranscriptRecording(sessionId: string | null) {
  const [recording, setRecording] = useState<Recording>({
    on: false,
    lines: 0,
  });
  const [failed, setFailed] = useState(false);
  const on = useRef(false);
  on.current = recording.on;

  const set = useCallback(
    async (next: boolean) => {
      if (!sessionId) return;
      setFailed(false);
      const result = await studioFetch(endpoint(sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      })
        .then(read)
        .catch(() => null);
      if (result) setRecording(result);
      else setFailed(true);
    },
    [sessionId],
  );

  // While it is on, the count is read again now and then; a session ended
  // elsewhere turns the button off here too.
  useEffect(() => {
    if (!sessionId || !recording.on) return;
    const timer = setInterval(() => {
      void studioFetch(endpoint(sessionId))
        .then(read)
        .then((result) => result && setRecording(result))
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, recording.on]);

  // Closing the window stops the recording: it is never left running unseen.
  useEffect(() => {
    if (!sessionId) return;
    return () => {
      if (!on.current) return;
      void studioFetch(endpoint(sessionId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: false }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [sessionId]);

  return { recording, failed, set };
}

export function RecordTranscriptButton({
  sessionId,
  disabled,
}: {
  sessionId: string;
  // A paused session hears nothing, so there is nothing to start recording.
  disabled?: boolean;
}) {
  const { recording, failed, set } = useTranscriptRecording(sessionId);
  if (recording.on)
    return (
      <Button
        buttonSize="control"
        tone="danger"
        fillIcon
        icon={<Icon name="stop_circle" filled />}
        onClick={() => void set(false)}
        aria-pressed={true}
        title="Recording what this session hears to a transcript file on this machine. Click to stop."
        data-testid="pn-record-transcript"
        data-recording="on"
      >
        {`Recording · ${recording.lines} ${recording.lines === 1 ? "line" : "lines"}`}
      </Button>
    );
  return (
    <Button
      buttonSize="control"
      variant="outline"
      tone="neutral"
      soft
      icon={<Icon name="radio_button_unchecked" />}
      disabled={disabled === true}
      onClick={() => void set(true)}
      aria-pressed={false}
      title={
        failed
          ? "The recording could not be started."
          : recording.file
            ? `Record a transcript. The last one is kept as ${recording.file}.`
            : "Record what this session hears as a transcript file on this machine."
      }
      data-testid="pn-record-transcript"
      data-recording="off"
    >
      {failed ? "Could not record" : "Record transcript"}
    </Button>
  );
}
