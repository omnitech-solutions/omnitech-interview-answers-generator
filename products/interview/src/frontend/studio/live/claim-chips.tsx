// A claim in a published answer, with the chip that says where it comes from.
// A claim that cites approved entries opens to show the entry's revision and
// the verbatim quote, so the owner can check it against their own words. All
// of it is session content and renders as plain text (rule:inert-draft-rendering:
// no markup, no links, no images are ever built from it).
import { useId, useState } from "react";
import { Icon, type IconName } from "../icon";
import { CLAIM_PRESENTATION, claimChip } from "./session-claims";
import type { ClaimKind, ClaimView } from "./session-results";

const CLAIM_ICON: Record<ClaimKind, IconName> = {
  "matrix-backed": "task_alt",
  "preference-backed": "tune",
  "suggested-interpretation": "lightbulb",
  "general-knowledge": "school",
  "not-in-matrix": "warning",
};

// "From your matrix · Role 2": the label names the first cited entry when its
// pointer says which one it is.
function chipLabel(claim: ClaimView): string {
  const chip = claimChip(claim);
  const first = chip.entries.find((entry) => entry.label);
  return first?.label
    ? `${chip.presentation.label} · ${first.label}`
    : chip.presentation.label;
}

export function ClaimRow({ claim }: { claim: ClaimView }) {
  const chip = claimChip(claim);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const { tone, meaning } = chip.presentation;
  const label = chipLabel(claim);
  const icon = (
    <Icon
      name={CLAIM_ICON[claim.kind]}
      filled={claim.kind === "suggested-interpretation"}
    />
  );
  return (
    <li className="live-claim" data-claim-kind={claim.kind}>
      <p className="live-claim-text">{chip.text}</p>
      <div className="live-claim-meta">
        {chip.entries.length > 0 ? (
          <button
            type="button"
            className={`live-chip ${tone} live-chip-button`}
            aria-expanded={open}
            aria-controls={panelId}
            title={meaning}
            onClick={() => setOpen(!open)}
          >
            {icon}
            {label}
            <Icon name={open ? "expand_less" : "expand_more"} />
          </button>
        ) : (
          <span className={`live-chip ${tone}`} title={meaning}>
            {icon}
            {label}
          </span>
        )}
        {claim.kind === "not-in-matrix" && (
          <span className="live-note">Not added to your matrix.</span>
        )}
      </div>
      {open && chip.entries.length > 0 && (
        <div id={panelId} className="live-claim-evidence">
          {chip.entries.map((entry, index) => (
            <figure
              // The same entry can be cited twice, so position is part of the key.
              key={`${entry.quote}-${index}`}
            >
              <blockquote>“{entry.quote}”</blockquote>
              <figcaption>
                {entry.label ?? "Approved entry"} · revision {entry.revision}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </li>
  );
}

export function ClaimList({
  claims,
  label,
}: {
  claims: readonly ClaimView[];
  label: string;
}) {
  if (claims.length === 0) return null;
  return (
    <ul className="live-claims" aria-label={label}>
      {claims.map((claim, index) => (
        <ClaimRow key={index} claim={claim} />
      ))}
    </ul>
  );
}

// "2 from your matrix · 1 suggested framing": the mix at a glance.
export function claimSummary(counts: Record<ClaimKind, number>): string {
  return (Object.keys(CLAIM_PRESENTATION) as ClaimKind[])
    .filter((kind) => counts[kind] > 0)
    .map(
      (kind) =>
        `${counts[kind]} ${CLAIM_PRESENTATION[kind].label.split(" · ")[0]?.toLowerCase()}`,
    )
    .join(" · ");
}
