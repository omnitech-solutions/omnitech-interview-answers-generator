// What runs where, for this session's processing policy. Only rows the
// architecture supports are listed:
//   Speech         the companion transcribes with the OS's on-device
//                  recognition (ADR-0012 "Locality by stage"), in both policies
//   Screen reading a model interprets the screenshots: refused in device-only
//                  mode (no device implementation), remote through the gateway
//                  otherwise (ADR-0012/unlisted-stage-refused,
//                  ADR-0012/model-calls-gateway-routed)
//   Answer drafts  device-only: the on-device model (text-only); remote: the
//                  gateway (ADR-0012/device-only-enforced-twice)
//   Coding drafts  device-only: refused, coding inference needs a remote model
//   Raw audio      only in the companion's bounded memory, never sent, stored
//                  or logged (ADR-0012/raw-audio-never-persisted)
import type { LiveProcessingPolicy } from "@omnitech/interview-contracts";

export type CapabilityRow = { label: string; where: string; refused: boolean };

const REFUSED = "Refused: needs a remote model";
const GATEWAY = "Remote model, through Studio's AI gateway";

export function capabilityRows(policy: LiveProcessingPolicy): CapabilityRow[] {
  const deviceOnly = policy === "device-only";
  const remote = (): CapabilityRow["where"] => (deviceOnly ? REFUSED : GATEWAY);
  return [
    {
      label: "Speech",
      where: "On this Mac, in the companion",
      refused: false,
    },
    { label: "Screen reading", where: remote(), refused: deviceOnly },
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

export function CapabilityTable({ policy }: { policy: LiveProcessingPolicy }) {
  return (
    <table className="live-capabilities">
      <caption>Where each step runs</caption>
      <tbody>
        {capabilityRows(policy).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td className={row.refused ? "refused" : undefined}>{row.where}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
