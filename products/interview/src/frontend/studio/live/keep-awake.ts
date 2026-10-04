// A page that is listening or watching a shared screen must keep reading the
// session while it is in a background tab: the store otherwise stops polling
// whenever the page is hidden, so a hands-free window would only update when
// the owner switched back to it. A hold is released by the function it returns;
// holds count, so the mic and the share can each take one.
let holds = 0;
const listeners = new Set<() => void>();

export function holdAwake(): () => void {
  holds += 1;
  for (const listener of [...listeners]) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    for (const listener of [...listeners]) listener();
  };
}

export const isHeldAwake = (): boolean => holds > 0;

export function onAwakeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
