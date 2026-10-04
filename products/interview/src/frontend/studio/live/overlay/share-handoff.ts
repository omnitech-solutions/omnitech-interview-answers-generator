// "Start hands-free" asks for the screen in the click that starts the session,
// because the browser only shows its picker from a user gesture and starting a
// session takes a network round trip. The share it gets is parked here until
// the session's card mounts and adopts it. A share nobody adopts is stopped.
import type { ShareHandle } from "./capture-source";

let parked: ShareHandle | null = null;

export function parkShare(handle: ShareHandle): void {
  parked?.stop();
  parked = handle;
}

// The card takes the parked share (once).
export function takeParkedShare(): ShareHandle | null {
  const handle = parked;
  parked = null;
  return handle;
}

// The session did not start: release what was asked for.
export function dropParkedShare(): void {
  parked?.stop();
  parked = null;
}

// What "Start hands-free" says once the session is up ("Hands-free is on."),
// handed to the card, which shows it for a few seconds.
let announcement: string | null = null;
export const announceHandsFree = (text: string): void => {
  announcement = text;
};
export function takeAnnouncement(): string | null {
  const text = announcement;
  announcement = null;
  return text;
}
