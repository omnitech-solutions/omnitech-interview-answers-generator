// What dictation is doing, where the person is looking: a level meter (or an
// animated indicator where the browser cannot give one), and a hint that says
// "speak now", then "Heard nothing" after a few quiet seconds.
export const LISTENING_HINT = "Listening… speak now";
export const HEARD_NOTHING_HINT = "Heard nothing — check your microphone";

export function ListeningHint({
  level,
  heardNothing,
  heard,
}: {
  level: number | null;
  heardNothing: boolean;
  heard: boolean;
}) {
  return (
    <div
      className={`ov-listening${heardNothing ? " quiet" : ""}`}
      role="status"
      data-testid="listening-hint"
    >
      <span
        className={`ov-meter${level === null ? " anim" : ""}`}
        data-testid="mic-meter"
        data-level={level === null ? undefined : level.toFixed(2)}
        style={
          level === null
            ? undefined
            : ({ "--level": String(level) } as React.CSSProperties)
        }
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        {heardNothing
          ? HEARD_NOTHING_HINT
          : heard
            ? "Listening…"
            : LISTENING_HINT}
      </span>
    </div>
  );
}
