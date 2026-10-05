// The companion's LAST capability report, said as that: never "connected",
// never live. One presenter for every screen that shows it; the caller owns the
// read (useCompanionCapability) and says which sources are selected.
import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import {
  captureRequestSupport,
  NO_REPORT_DETAIL,
  permissionLines,
  reportAge,
  speechState,
} from "./companion-capability";
import type { CompanionCapabilityState } from "./use-companion-capability";

export type CompanionReportProps = {
  state: CompanionCapabilityState;
  // Only a denied permission for a selected source is explained.
  sources: readonly LiveCaptureSource[];
  // true lists speech, capture-request support and permissions here (the
  // Sources tab); false when the caller already shows them (the Setup host
  // card does).
  showFacts: boolean;
};

export function CompanionReport({
  state,
  sources,
  showFacts,
}: CompanionReportProps) {
  if (state.status === "loading")
    return (
      <p className="setup-muted" data-testid="setup-capability">
        Reading the companion’s last capability report…
      </p>
    );
  if (state.status === "error")
    return (
      <p className="setup-muted" data-testid="setup-capability">
        Studio couldn’t read the companion’s last capability report, so nothing
        is assumed about speech on this Mac. The companion checks when it starts
        and fails visibly if it can’t listen.
      </p>
    );
  const { capability } = state;
  if (!capability)
    return (
      <p className="setup-muted" data-testid="setup-capability">
        {NO_REPORT_DETAIL}
      </p>
    );
  const speech = speechState(capability);
  const lines = permissionLines(capability);
  const denied = lines.filter(
    (line) => line.state === "denied" && sources.includes(line.source),
  );
  return (
    <div data-testid="setup-capability">
      <p className="setup-muted">
        The companion’s last report ({reportAge(capability, Date.now())}), not a
        live connection.
      </p>
      {showFacts && (
        <>
          <p className="setup-muted">{speech.detail}</p>
          <p className="setup-muted" data-testid="capture-request-support">
            {captureRequestSupport(capability).line}
          </p>
          <dl className="setup-facts">
            <div>
              <dt>Speech</dt>
              <dd data-tone={speech.tone}>{speech.label}</dd>
            </div>
            {lines.map((line) => (
              <div key={line.source}>
                <dt>{line.label}</dt>
                <dd data-tone={line.tone}>{line.text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {denied.map((line) => (
        <p key={line.source} className="setup-muted">
          {line.label} access was denied for the companion on this Mac, so it
          can’t capture that source until you allow it in System Settings.
        </p>
      ))}
    </div>
  );
}
