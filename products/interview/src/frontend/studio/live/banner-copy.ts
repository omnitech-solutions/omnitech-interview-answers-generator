// The sentence and the action for each banner. Every claim in here is something
// Studio observed (a recorded observation, a heartbeat age, a credential
// expiry) or something the processor does (ADR-0011/pause-end-suppression,
// ADR-0012/retention-modes): never a promise about what the companion will do,
// which is a separate program, and never "connected" without recorded contact.
import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import type { Banner } from "./session-banners";
import { ageLabel, sinceMs } from "./session-format";
import type { LiveViewModel } from "./session-state";

export type BannerAction = "resume" | "sources" | "renew";
export type BannerCopy = {
  title: string;
  detail: string;
  // What the button does; null for a banner that only informs.
  action: BannerAction | null;
  actionLabel: string;
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

export function bannerCopy(banner: Banner, model: CopyModel): BannerCopy {
  const now = model.serverNowMs;
  const source = banner.source;
  const name = source ? NAME[source] : "";
  const open = (title: string, detail: string): BannerCopy => ({
    title,
    detail,
    action: "sources",
    actionLabel: "Open Sources",
  });
  const inform = (title: string, detail: string): BannerCopy => ({
    title,
    detail,
    action: null,
    actionLabel: "",
  });
  switch (banner.kind) {
    case "stream-unreachable":
      return inform(
        "Studio can't reach the session service.",
        "Retrying. What you see may be out of date, and the elapsed time is paused. Pause and End are still offered; a command is confirmed only once Studio answers.",
      );
    case "paused":
      return {
        title: "Paused.",
        detail:
          "No new work will start, and any result that arrives while paused is discarded.",
        action: "resume",
        actionLabel: "Resume",
      };
    case "permission-revoked":
      return open(
        `Studio was told the permission for ${name} was revoked${ago(banner.since, now)}.`,
        "Grant it again in System Settings on this Mac. The loss is recorded in the transcript.",
      );
    case "source-lost": {
      const reason = model.sources.find((s) => s.source === source)?.reason;
      const phrase = (reason && LOST_PHRASE[reason]) || "was lost";
      return open(
        `${name} ${phrase}${ago(banner.since, now)}.`,
        `${source ? CONSEQUENCE[source] : ""} This is recorded in the transcript.`.trim(),
      );
    }
    case "gap": {
      const seconds = Math.round((banner.durationMs ?? 0) / 1000);
      return open(
        `${name}: ${seconds} s of capture was dropped${ago(banner.since, now)}.`,
        "The gap is recorded in the transcript. Anything said in it was not captured.",
      );
    }
    case "credential-expired":
      return {
        title: "The companion's credential has expired.",
        detail:
          "Capture pauses when it expires. Renew it here and hand the new credential to the companion; the old one stops working.",
        action: "renew",
        actionLabel: "Renew credential",
      };
    case "credential-revoked":
      return {
        title: "The companion's credential was revoked.",
        detail:
          "The companion can send nothing until you renew it here and hand it the new credential.",
        action: "renew",
        actionLabel: "Renew credential",
      };
    case "credential-expiring":
      return {
        title: `The companion's credential expires in ${ageLabel(model.companion.credentialExpiresInMs ?? 0)}.`,
        detail:
          "Renew it before then so capture isn't paused. Renewing replaces the old credential.",
        action: "renew",
        actionLabel: "Renew credential",
      };
    case "cap-reached":
      return inform(
        "This session reached its duration limit.",
        "A session ends at its limit, and what is kept afterwards follows the retention you chose.",
      );
    case "cap-near":
      return inform(
        `About ${ageLabel(banner.remainingMs ?? 0)} left before the session reaches its duration limit.`,
        "It ends there. Start a new session if you need more time.",
      );
  }
}
