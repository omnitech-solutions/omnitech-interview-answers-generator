// The six Material Symbols Rounded glyphs the start screens use beyond the
// studio's generated set (icons.generated.ts belongs to the Studio frame, which
// this window does not edit). Same source, weight and viewBox, drawn the same way
// as `Icon`, so the two sit side by side.
import type { CSSProperties } from "react";

const PATHS = {
  person_off:
    "m792-83-78-77H220q-25 0-42.5-17.5T160-220v-34q0-38 19-65t49-41q60-27 115.5-42T455-419L82-792q-9-9-8.5-21.5T83-835q9-9 21.5-9t21.5 9l709 710q9 9 9 21t-9 21q-9 9-21.5 9T792-83ZM220-220h434L515-359q-8-1-17-1h-18q-57 0-111 11.5T252-306q-14 7-23 21.5t-9 30.5v34Zm511-140q31 14 50 41t19 65v8L657-389q18 6 36.5 13.5T731-360ZM550-496l-48-48q30-7 49-31t19-56q0-38-26-64t-64-26q-32 0-56 19t-31 49l-48-48q19-38 55.5-59t79.5-21q63 0 106.5 43.5T630-631q0 43-21 79.5T550-496Zm104 276H220h434ZM448-599Z",
  laptop_mac:
    "M57-160q-23.51 0-40.26-17.63Q0-195.25 0-220h141q-24 0-42-18t-18-42v-500q0-24 18-42t42-18h678q24 0 42 18t18 42v500q0 24-18 42t-42 18h141q0 25-17.62 42.5Q924.75-160 900-160H57Zm447-32q10-10 10-24t-10-24q-10-10-24-10t-24 10q-10 10-10 24t10 24q10 10 24 10t24-10Zm-363-88h678v-500H141v500Zm0 0v-500 500Z",
  logout:
    "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h269q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H180v600h269q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H180Zm545-330H390q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h333l-81-81q-9-9-8.5-21t9.5-21q9-9 21.5-9t21.5 9l133 133q9 9 9 21t-9 21L687-326q-8.8 9-20.9 8.5-12.1-.5-21.49-9.5-8.61-9-8.61-21.5t9-21.5l80-80Z",
  radio_button_checked:
    "M612-348q54-54 54-132t-54-132q-54-54-132-54t-132 54q-54 54-54 132t54 132q54 54 132 54t132-54ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Z",
  check_box:
    "m419-407-98-98q-9-9-21-9t-21 9q-9 9-9 21.5t9 21.5l119 120q9 9 21 9t21-9l247-248q9-9 9-21t-9-21q-9-9-21.5-9t-21.5 9L419-407ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Z",
  check_box_outline_blank:
    "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Z",
} as const;

export type StartIconName = keyof typeof PATHS;

export function StartIcon({
  name,
  size,
  style,
}: {
  name: StartIconName;
  size?: number;
  style?: CSSProperties;
}) {
  const sized = size ? { fontSize: size, ...style } : style;
  return (
    <svg
      className="studio-icon"
      viewBox="0 -960 960 960"
      aria-hidden="true"
      focusable="false"
      style={sized}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
