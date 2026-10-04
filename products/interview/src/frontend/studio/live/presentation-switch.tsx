// The layout buttons: Full, Focus and Float. They change presentation only;
// none of them is a session command.
import { presentation } from "./focus-presentation";

export function PresentationSwitch({
  where,
}: {
  where: "full" | "tab" | "float";
}) {
  return (
    <div className="live-focus-layout" role="group" aria-label="Session layout">
      {where === "full" && (
        <button
          type="button"
          className="studio-button"
          onClick={() => presentation.setMode("focus")}
        >
          Focus view
        </button>
      )}
      {where === "tab" && (
        <button
          type="button"
          className="studio-button"
          onClick={() => presentation.setMode("full")}
        >
          Full view
        </button>
      )}
      {where !== "float" && (
        <button
          type="button"
          className="studio-button"
          onClick={() => presentation.setMode("floating")}
        >
          Float
        </button>
      )}
      {where === "float" && (
        <button
          type="button"
          className="studio-button"
          onClick={() => presentation.setMode("full")}
        >
          Close float
        </button>
      )}
    </div>
  );
}
