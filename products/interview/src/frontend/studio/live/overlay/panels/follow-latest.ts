// A log that follows its newest line until the person scrolls away, then offers
// a way back: `following` says whether new lines are being followed, `unseen`
// counts lines that arrived while it was not, and `jump` returns to the end.
import { useCallback, useEffect, useRef, useState } from "react";

// Within this many px of the end still counts as "at the end".
export const AT_END_PX = 48;
// A scroll within this long of a wheel, touch or key press is the person's.
const PERSON_SCROLL_MS = 400;

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

  // Only the person's own scrolling can stop the following: the window growing or
  // a line changing height moves the scroll position too, and must not.
  const byPerson = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useCallback(() => {
    byPerson.current = true;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      byPerson.current = false;
    }, PERSON_SCROLL_MS);
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
    if (!byPerson.current) {
      // Not the person: stay with the newest line if that is where we were.
      if (following) toEnd();
      return;
    }
    const end = isAtEnd(box);
    setFollowing(end);
    if (end) setUnseen(0);
  }, [following, toEnd]);

  const jump = useCallback(() => {
    setFollowing(true);
    setUnseen(0);
    toEnd();
  }, [toEnd]);

  return { ref, following, unseen, onScroll, onPersonScroll: touch, jump };
}
