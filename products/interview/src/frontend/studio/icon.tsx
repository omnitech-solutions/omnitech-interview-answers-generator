import { Icon as AssistantIcon } from "@omnitech-assistant/react";
import type { CSSProperties } from "react";
import { ICON_PATHS } from "./icons.generated";

type BaseName = Exclude<keyof typeof ICON_PATHS, `${string}-fill`>;
export type IconName = BaseName | "auto_awesome";

// Material Symbols Rounded, drawn from generated paths rather than a 3 MB font.
// The assistant sparkle is the assistant package's own, so both always match.
export function Icon({
  name,
  filled = false,
  size,
  style,
}: {
  name: IconName;
  filled?: boolean;
  size?: number;
  style?: CSSProperties;
}) {
  const sized = size ? { fontSize: size, ...style } : style;
  if (name === "auto_awesome")
    return (
      <AssistantIcon
        name="auto_awesome"
        className="studio-icon"
        {...(sized ? { style: sized } : {})}
      />
    );
  return (
    <svg
      className="studio-icon"
      viewBox="0 -960 960 960"
      aria-hidden="true"
      focusable="false"
      style={sized}
    >
      <path d={ICON_PATHS[filled ? (`${name}-fill` as const) : name]} />
    </svg>
  );
}
