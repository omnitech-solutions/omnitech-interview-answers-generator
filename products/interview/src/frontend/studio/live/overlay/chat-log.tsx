// The live transcript above the follow-up input: what was spoken (from the
// companion), dictated and typed, newest last, plus the dictation in progress and
// "Analyzing…" while a capture is being read. Text is inert.
import type { ChatRow } from "./overlay-model";

export function ChatLog({
  rows,
  activity,
}: {
  rows: ChatRow[];
  // "Capturing…" or "Analyzing…" while that is happening; null otherwise.
  activity: string | null;
}) {
  if (rows.length === 0 && !activity) return null;
  return (
    <div
      className="ov-chat"
      role="log"
      aria-label="Transcript and chat"
      data-testid="chat-log"
    >
      {rows.map((row) => (
        <div key={row.key} className="ov-chat-row" data-tag={row.tag}>
          <span className="ov-chat-tag">{row.tag}</span>
          <span>{row.text}</span>
        </div>
      ))}
      {activity && (
        <div className="ov-chat-row" data-testid="analyzing" role="status">
          <span className="ov-spinner" role="presentation" />
          <span>{activity}</span>
        </div>
      )}
    </div>
  );
}
