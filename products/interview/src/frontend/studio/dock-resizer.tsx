import { Resizer, type StoredSize, useStoredSize } from "./resizer";

export const DEFAULT_DOCK_WIDTH = 400;
// The view beside the dock keeps at least this much room.
const MIN_MAIN_WIDTH = 480;

// The assistant dock's width: the package takes a fixed layout.width, so the
// shell owns it and remembers the person's choice.
export function useDockWidth() {
  const stored = useStoredSize({
    storageKey: "interview-studio.assistant-width",
    initial: DEFAULT_DOCK_WIDTH,
    min: 320,
    max: () => window.innerWidth - MIN_MAIN_WIDTH,
  });
  return { width: stored.size, resize: stored.resize, stored };
}

// The drag handle on the dock's left edge.
export function DockResizer({ stored }: { stored: StoredSize }) {
  return (
    <Resizer
      label="Resize assistant"
      stored={stored}
      grows="left"
      sizeFromPointer={(event) => window.innerWidth - event.clientX}
      className="studio-dock-resizer"
    />
  );
}
