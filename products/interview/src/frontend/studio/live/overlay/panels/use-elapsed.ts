// Whole seconds since `active` last turned on, or since `key` last changed while
// it is on (the step of a job moved on); 0 while it is off.
import { useEffect, useState } from "react";

export function useElapsed(active: boolean, key?: string): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    void key;
    if (!active) return setSeconds(0);
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [active, key]);
  return seconds;
}
