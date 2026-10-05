// "The AI may be missing ...": what the model said it could not see for the
// task on show, and the three ways to answer it. One component and one action
// table for the native window and the web page; each surface passes what an
// action does (or why it cannot) and a variant that picks its styling.
//
// Supplying context REVISES the same task: the screenshot or typed text goes to
// the task on show at its current revision. "Looks complete" only hides the
// strip for that revision (see use-missing-context.ts).
import type { LiveMissingContext } from "@omnitech/interview-contracts";

type Kind = LiveMissingContext[number]["kind"];

// The contract's closed kinds, in words for the person.
export const MISSING_CONTEXT_LABEL: Record<Kind, string> = {
  constraints: "Constraints",
  examples: "Examples",
  signature: "Function signature",
  language: "Target language",
  "statement-cut-off": "The rest of the problem (it looks cut off)",
  other: "Something else",
};

export const MISSING_CONTEXT_ACTIONS = [
  { id: "screenshot", label: "Add another screenshot" },
  { id: "context", label: "Add context" },
  { id: "dismiss", label: "Looks complete" },
] as const;
export type MissingContextActionId =
  (typeof MISSING_CONTEXT_ACTIONS)[number]["id"];

// Per surface: the class names its stylesheet already has.
const VARIANT = {
  native: {
    root: "pn-missing",
    actions: "pn-missing-actions",
    button: "pn-bar-button",
    note: "pn-muted",
  },
  web: {
    root: "live-missing",
    actions: "live-missing-actions",
    button: "live-missing-button",
    note: "live-note",
  },
} as const;

export function MissingContextStrip({
  items,
  variant,
  onAction,
  unavailable = {},
}: {
  items: LiveMissingContext;
  variant: keyof typeof VARIANT;
  onAction(id: MissingContextActionId): void;
  // An action that cannot run now, with the reason in words. It stays visible
  // and disabled so the person is told why, never a button that does nothing.
  unavailable?: Partial<Record<MissingContextActionId, string>>;
}) {
  const look = VARIANT[variant];
  const reasons = MISSING_CONTEXT_ACTIONS.flatMap((action) => {
    const reason = unavailable[action.id];
    return reason ? [{ id: action.id, reason }] : [];
  });
  return (
    <div className={look.root} role="note" data-testid="missing-context">
      <strong>The AI may be missing:</strong>
      <ul>
        {items.map((item) => (
          <li key={item.kind}>
            {MISSING_CONTEXT_LABEL[item.kind]}
            {item.note ? `: ${item.note}` : ""}
          </li>
        ))}
      </ul>
      <div className={look.actions}>
        {MISSING_CONTEXT_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={look.button}
            data-action={action.id}
            disabled={unavailable[action.id] !== undefined}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {reasons.map(({ id, reason }) => (
        <p
          key={id}
          className={look.note}
          data-testid={`missing-${id}-unavailable`}
        >
          {reason}
        </p>
      ))}
    </div>
  );
}
