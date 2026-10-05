// The sentence and the action for each banner. Every claim in here is something
// Studio observed (a recorded observation, a heartbeat age, a credential
// expiry) or something the processor does (ADR-0011/pause-end-suppression,
// ADR-0012/retention-modes): never a promise about what the companion will do,
// which is a separate program, and never "connected" without recorded contact.
import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import type { Banner, BannerKind } from "./session-banners";
import { ageLabel, sinceMs } from "./session-format";
import type { LiveViewModel } from "./session-state";

// "pair" reveals the credential panel in the Sources tab. There is no
// "reconnect": nothing in the host bridge or the engine can restart a dropped
// source, so no button says it can.
export type BannerAction = "resume" | "sources" | "renew" | "pair";
// Where the page runs: inside the Mac app's window, or an ordinary browser.
export type BannerHost = "native" | "browser";
type BannerCta = { action: BannerAction; label: string };
export type BannerCopy = {
  title: string;
  detail: string;
  // What the button does; null for a banner that only informs.
  action: BannerAction | null;
  actionLabel: string;
};

const RESUME: BannerCta = { action: "resume", label: "Resume" };
const RENEW: BannerCta = { action: "renew", label: "Renew credential" };
const OPEN_SOURCES: BannerCta = { action: "sources", label: "Open Sources" };
const PAIR: BannerCta = { action: "pair", label: "Pair companion" };

// App audio reaches a browser only through the capture companion, so a browser
// that lost it is offered pairing. In the Mac app the person is taken to
// Sources, where the reason and the state are.
function sourceCta(banner: Banner, host: BannerHost): BannerCta {
  return host === "browser" && banner.source === "application-audio"
    ? PAIR
    : OPEN_SOURCES;
}

// Every banner's button, or none for a banner that only informs.
const BANNER_CTA: Record<
  BannerKind,
  (banner: Banner, host: BannerHost) => BannerCta | null
> = {
  "stream-unreachable": () => null,
  paused: () => RESUME,
  "permission-revoked": () => OPEN_SOURCES,
  "source-lost": sourceCta,
  gap: sourceCta,
  "credential-expired": () => RENEW,
  "credential-revoked": () => RENEW,
  "credential-expiring": () => RENEW,
  "cap-near": () => null,
  "cap-reached": () => null,
};

const NAME: Record<LiveCaptureSource, string> = {
  microphone: "Microphone",
  "application-audio": "App audio",
  screen: "Screen",
};
// What is not happening while that source is down.
const CONSEQUENCE: Record<LiveCaptureSource, string> = {
  microphone: "Your voice isn't being heard.",
  "application-audio": "The other side of the call isn't being heard.",
  screen: "Screenshots aren't being captured.",
};
const LOST_PHRASE: Record<string, string> = {
  "user-stopped": "was stopped",
  "device-lost": "was lost",
  error: "stopped after a capture error",
};

const ago = (since: string | null | undefined, now: number): string => {
  const ms = sinceMs(since, now);
  return ms === null ? "" : ` ${ageLabel(ms)} ago`;
};

type CopyModel = Pick<LiveViewModel, "serverNowMs" | "sources" | "companion">;

export function bannerCopy(
  banner: Banner,
  model: CopyModel,
  host: BannerHost,
): BannerCopy {
  const cta = BANNER_CTA[banner.kind](banner, host);
  const text = bannerText(banner, model);
  return {
    ...text,
    action: cta?.action ?? null,
    actionLabel: cta?.label ?? "",
  };
}

function bannerText(
  banner: Banner,
  model: CopyModel,
): { title: string; detail: string } {
  const now = model.serverNowMs;
  const source = banner.source;
  const name = source ? NAME[source] : "";
  const say = (title: string, detail: string) => ({ title, detail });
  switch (banner.kind) {
    case "stream-unreachable":
      return say(
        "Studio can't reach the session service.",
        "Retrying. What you see may be out of date, and the elapsed time is paused. Pause and End are still offered; a command is confirmed only once Studio answers.",
      );
    case "paused":
      return say(
        "Paused.",
        "No new work will start, and any result that arrives while paused is discarded.",
      );
    case "permission-revoked":
      return say(
        `Studio was told the permission for ${name} was revoked${ago(banner.since, now)}.`,
        "Grant it again in System Settings on this Mac. The loss is recorded in the transcript.",
      );
    case "source-lost": {
      const reason = model.sources.find((s) => s.source === source)?.reason;
      const phrase = (reason && LOST_PHRASE[reason]) || "was lost";
      return say(
        `${name} ${phrase}${ago(banner.since, now)}.`,
        `${source ? CONSEQUENCE[source] : ""} This is recorded in the transcript.`.trim(),
      );
    }
    case "gap": {
      const seconds = Math.round((banner.durationMs ?? 0) / 1000);
      return say(
        `${name}: ${seconds} s of capture was dropped${ago(banner.since, now)}.`,
        "The gap is recorded in the transcript. Anything said in it was not captured.",
      );
    }
    case "credential-expired":
      return say(
        "The companion's credential has expired.",
        "Capture pauses when it expires. Renew it here and hand the new credential to the companion; the old one stops working.",
      );
    case "credential-revoked":
      return say(
        "The companion's credential was revoked.",
        "The companion can send nothing until you renew it here and hand it the new credential.",
      );
    case "credential-expiring":
      return say(
        `The companion's credential expires in ${ageLabel(model.companion.credentialExpiresInMs ?? 0)}.`,
        "Renew it before then so capture isn't paused. Renewing replaces the old credential.",
      );
    case "cap-reached":
      return say(
        "This session reached its duration limit.",
        "A session ends at its limit, and what is kept afterwards follows the retention you chose.",
      );
    case "cap-near":
      return say(
        `About ${ageLabel(banner.remainingMs ?? 0)} left before the session reaches its duration limit.`,
        "It ends there. Start a new session if you need more time.",
      );
  }
}
