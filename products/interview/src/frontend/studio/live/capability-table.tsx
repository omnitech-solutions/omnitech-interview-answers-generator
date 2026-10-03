// What runs where, for this session's processing policy. Only rows the
// architecture supports are listed:
//   Speech         the companion transcribes with the OS's on-device
//                  recognition (ADR-0012 "Locality by stage"), in both
//                  policies; the row says "On this Mac, in the companion" only
//                  when the companion's last report says on-device recognition
//                  is available, and otherwise the true state
//   Screenshots    stored by ingest for the owner; no stage reads them
//                  today (session-run.ts), so there is no model step to place
//   Answer drafts  device-only: the on-device model (text-only); remote: the
//                  gateway (ADR-0012/device-only-enforced-twice)
//   Coding drafts  device-only: refused, coding inference needs a remote model
//   Raw audio      only in the companion's bounded memory, never sent, stored
//                  or logged (ADR-0012/raw-audio-never-persisted)
import type { LiveProcessingPolicy } from "@omnitech/interview-contracts";
import type { SpeechState } from "./companion-capability";

export type CapabilityRow = { label: string; where: string; refused: boolean };

const REFUSED = "Refused: needs a remote model";
const GATEWAY = "Remote model, through Studio's AI gateway";

const UNKNOWN_SPEECH = "Not known: no capability report read";

export function capabilityRows(
  policy: LiveProcessingPolicy,
  speech: SpeechState | null = null,
): CapabilityRow[] {
  const deviceOnly = policy === "device-only";
  const remote = (): CapabilityRow["where"] => (deviceOnly ? REFUSED : GATEWAY);
  return [
    {
      label: "Speech",
      where: speech ? speech.label : UNKNOWN_SPEECH,
      refused: speech?.blocksSpeech ?? false,
    },
    {
      label: "Screenshots",
      where: "Stored for you; no model reads them yet",
      refused: false,
    },
    {
      label: "Answer drafts",
      where: deviceOnly ? "On this Mac" : GATEWAY,
      refused: false,
    },
    {
      label: "Coding drafts and tests",
      where: remote(),
      refused: deviceOnly,
    },
    { label: "Raw audio", where: "Memory only, never saved", refused: false },
  ];
}

export function CapabilityTable({
  policy,
  speech = null,
}: {
  policy: LiveProcessingPolicy;
  // The companion's speech state; null when no report could be read.
  speech?: SpeechState | null;
}) {
  return (
    <table className="live-capabilities">
      <caption>Where each step runs</caption>
      <tbody>
        {capabilityRows(policy, speech).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td className={row.refused ? "refused" : undefined}>{row.where}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
