// "Start hands-free": the one setup (ADR-0022). In the click that starts the
// session it asks for the screen share and the microphone together, because
// the browser only shows the share picker from a user gesture and starting the
// session takes a round trip. The share is parked for the session's card to
// adopt; the microphone permission is the browser's, remembered for this site.
// The browser cannot be told to share again later without a click, which is why
// this is asked once, up front.
import { nativeCaptureAvailable } from "../host-adapter";
import { ShareError, startShare } from "./capture-source";
import { startNativeShare } from "./native-share";
import { engineHost } from "./panels/use-engine";
import { dropParkedShare, parkShare } from "./share-handoff";

export type HandsFreeOutcome = {
  screen: "shared" | "skipped" | "cancelled" | "unsupported" | "failed";
  // "engine": the shell's native engine owns the microphone; the page asks none.
  mic: "allowed" | "denied" | "unavailable" | "engine";
};

async function askMicrophone(): Promise<HandsFreeOutcome["mic"]> {
  // [SAFETY] A native shell's engine listens: the page's getUserMedia would only
  // raise the web view's own microphone prompt.
  if (engineHost() !== null) return "engine";
  const media = navigator.mediaDevices;
  if (!media || typeof media.getUserMedia !== "function") return "unavailable";
  try {
    const stream = await media.getUserMedia({ audio: true });
    // Only the permission is wanted; the recogniser opens its own capture.
    for (const track of stream.getTracks()) track.stop();
    return "allowed";
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return name === "NotFoundError" ? "unavailable" : "denied";
  }
}

async function askScreen(): Promise<HandsFreeOutcome["screen"]> {
  try {
    parkShare(
      nativeCaptureAvailable() ? startNativeShare() : await startShare(),
    );
    return "shared";
  } catch (error) {
    return error instanceof ShareError ? error.code : "failed";
  }
}

// Call straight from the click handler, before anything is awaited. A
// device-only session never sends a screenshot, so it asks for no screen. A plain
// browser would have to open its share picker, so hands-free never asks: the
// picker waits for the capture button. A native host captures without one.
export async function prepareHandsFree(options: {
  deviceOnly: boolean;
}): Promise<HandsFreeOutcome> {
  const screen =
    options.deviceOnly || !nativeCaptureAvailable()
      ? Promise.resolve<HandsFreeOutcome["screen"]>("skipped")
      : askScreen();
  const [shared, mic] = await Promise.all([screen, askMicrophone()]);
  return { screen: shared, mic };
}

// The session did not start: nothing asked for is kept.
export const releaseHandsFree = dropParkedShare;

export function handsFreeSummary(outcome: HandsFreeOutcome): string {
  const gaps: string[] = [];
  if (outcome.mic !== "allowed" && outcome.mic !== "engine")
    gaps.push(
      outcome.mic === "denied"
        ? "the microphone wasn’t allowed"
        : "no microphone was found",
    );
  if (outcome.screen !== "shared" && outcome.screen !== "skipped")
    gaps.push("no screen was shared");
  return gaps.length === 0
    ? "Hands-free is on."
    : `Hands-free is on, but ${gaps.join(" and ")}. The card says what to press.`;
}
