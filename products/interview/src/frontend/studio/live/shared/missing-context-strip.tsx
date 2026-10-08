// "The AI may be missing ...": what the model said it could not see for the
// task on show, and the three ways to answer it. One component and one action
// table for the native window and the web page; each surface passes what an
// action does (or why it cannot) and a variant that picks its styling.
//
// Supplying context REVISES the same task: the screenshot or typed text goes to
// the task on show at its current revision. "Looks complete" only hides the
// strip for that revision (see use-missing-context.ts).
import { Button, Textarea } from "@oc-tech/omni-ui-components";
import type { LiveMissingContext } from "@omnitech/interview-contracts";
import { useState } from "react";

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
  onContext,
  unavailable = {},
}: {
  items: LiveMissingContext;
  variant: keyof typeof VARIANT;
  onAction(id: MissingContextActionId): void;
  // Given, "Add context" opens a field right here and sends the text to the
  // task on show (a revision of it), instead of moving to the composer.
  // biome-ignore lint/suspicious/noConfusingVoidType: the handler may be a plain callback that returns nothing or an async one; void is what accepts both
  onContext?: (text: string) => Promise<unknown> | void;
  // An action that cannot run now, with the reason in words. It stays visible
  // and disabled so the person is told why, never a button that does nothing.
  unavailable?: Partial<Record<MissingContextActionId, string>>;
}) {
  const look = VARIANT[variant];
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async () => {
    const trimmed = text.trim();
    if (!onContext || trimmed === "" || sending) return;
    setSending(true);
    try {
      await onContext(trimmed);
      setText("");
      setWriting(false);
    } finally {
      setSending(false);
    }
  };
  const reasons = MISSING_CONTEXT_ACTIONS.flatMap((action) => {
    const reason = unavailable[action.id];
    return reason ? [{ id: action.id, reason }] : [];
  });
  return (
    <div
      className={look.root}
      role="note"
      data-testid="missing-context"
      data-missing={items.length > 0 || undefined}
    >
      <strong>
        {items.length > 0 ? "The AI may be missing:" : "Did AI miss anything?"}
      </strong>
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.kind}>
              {MISSING_CONTEXT_LABEL[item.kind]}
              {item.note ? `: ${item.note}` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className={look.actions}>
        {MISSING_CONTEXT_ACTIONS.map((action) => (
          <Button
            key={action.id}
            buttonSize="sm"
            variant="outline"
            className={look.button}
            data-action={action.id}
            disabled={unavailable[action.id] !== undefined}
            onClick={() =>
              action.id === "context" && onContext
                ? setWriting(true)
                : onAction(action.id)
            }
          >
            {action.label}
          </Button>
        ))}
      </div>
      {writing && onContext && (
        <form
          className={look.actions}
          data-testid="missing-context-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* Several lines of context: Shift+Enter is a new line and never
              sends; Enter alone sends. */}
          <Textarea
            aria-label="Context for this problem"
            placeholder="What the AI should know about this problem (Shift+Enter for a new line)"
            rows={3}
            value={text}
            onChange={setText}
            disabled={sending}
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              if (event.shiftKey) return;
              event.preventDefault();
              void submit();
            }}
          />
          <Button
            buttonSize="sm"
            type="submit"
            disabled={sending || text.trim() === ""}
          >
            Send
          </Button>
        </form>
      )}
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
