// A log that follows its newest line until the person scrolls away, then offers
// a way back: `following` says whether new lines are being followed, `unseen`
// counts lines that arrived while it was not, and `jump` returns to the end.
import { useCallback, useEffect, useRef, useState } from "react";

// Within this many px of the end still counts as "at the end".
export const AT_END_PX = 48;

export const isAtEnd = (box: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean => box.scrollHeight - box.scrollTop - box.clientHeight <= AT_END_PX;

export function useFollowLatest(lines: number, activity: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const seen = useRef(lines);

  const toEnd = useCallback(() => {
    const box = ref.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, []);

  // New lines (or a stage starting): follow them, or count them.
  useEffect(() => {
    if (following) toEnd();
    else if (lines > seen.current) setUnseen((n) => n + (lines - seen.current));
    seen.current = lines;
  }, [lines, activity, following, toEnd]);

  const onScroll = useCallback(() => {
    const box = ref.current;
    if (!box) return;
    const end = isAtEnd(box);
    setFollowing(end);
    if (end) setUnseen(0);
  }, []);

  const jump = useCallback(() => {
    setFollowing(true);
    setUnseen(0);
    toEnd();
  }, [toEnd]);

  return { ref, following, unseen, onScroll, jump };
}
