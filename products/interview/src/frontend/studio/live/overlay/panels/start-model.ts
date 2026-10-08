// What the native window shows before a session runs (sign in, waiting for the
// browser, "use this Mac only", the idle "No live session" screen), as plain
// data and rules with no React, so each rule is tested on its own. Every line
// shown is a fact the page holds: nothing here claims where data is stored or
// processed beyond what the Studio address and the bridge can say.
import type {
  AccountCallAudio,
  AccountPermissionState,
  AccountPermissions,
  AccountProvider,
  CallAudioSource,
  LiveSessionChoicesResponse,
} from "@omnitech/interview-contracts";
import type { ProductMember } from "@omnitech/platform-contracts";
import type { SessionErrorCode } from "../../session-client";
import { type SetupTarget, startErrorMessage } from "../../setup-model";

export type StartStage = "out" | "waiting" | "local" | "idle";

export const STAGE_TITLE: Record<StartStage, string> = {
  out: "Sign in",
  waiting: "Signing in",
  local: "This Mac only",
  idle: "No live session",
};

export const PROVIDER_NAME: Record<AccountProvider, string> = {
  google: "Google",
  linkedin: "LinkedIn",
};

// What the locked toolbar says on each disabled control, by what is missing.
export const LOCK_REASON = {
  signedOut: "Sign in first",
  noSession: "Start a session first",
} as const;

// ---- The account chip -------------------------------------------------------

export type Chip = { initial: string; short: string };

const firstWord = (text: string): string => text.trim().split(/\s+/)[0] ?? "";

// A local profile is "This Mac" with an M; an account is its first name (the
// email's local part when there is no name) with its initial.
export function chipOf(member: ProductMember): Chip {
  if (member.kind === "local") return { initial: "M", short: "This Mac" };
  const short =
    firstWord(member.name) || (member.email.split("@")[0] ?? "").slice(0, 16);
  return {
    initial: (short.charAt(0) || "?").toUpperCase(),
    short: short || "Account",
  };
}

// The menu's head: who, and how they are signed in. A local profile has no
// account; an account shows the email (the provider is not something the page
// is told, so it is not guessed).
export function accountLines(member: ProductMember): {
  name: string;
  via: string;
} {
  return member.kind === "local"
    ? { name: "Local profile", via: "No account on this Mac" }
    : { name: member.name || member.email, via: member.email };
}

export const signOutLabel = (member: ProductMember): string =>
  member.kind === "local" ? "Sign out of local profile" : "Sign out";

// What was true when the person signed out, in the toast. The session on this
// Mac ends; nothing else is deleted or revoked, so nothing else is claimed.
export const SIGNED_OUT_TOAST = "Signed out";

// ---- The footer's right end -------------------------------------------------

export type FooterStatus = {
  icon: "person_off" | "lock" | "cloud_done";
  text: string;
};

// A local profile says only "no account"; "nothing leaves this Mac" would need a
// device-only session on this Mac, which an idle window does not have.
export function footerStatus(member: ProductMember | null): FooterStatus {
  if (!member) return { icon: "person_off", text: "Not signed in" };
  return member.kind === "local"
    ? { icon: "lock", text: "Local profile · no account" }
    : { icon: "cloud_done", text: "Signed in · no live session" };
}

// ---- The local profile's confirm step --------------------------------------

export type LocalFact = { tone: "good" | "warn"; text: string };

// Four facts the page can stand behind: the no-password sign-in, that Studio is
// here on this computer (only offered then), what a session can be, and that an
// account is a separate identity (nothing merges).
export const LOCAL_FACTS: readonly LocalFact[] = [
  { tone: "good", text: "No account and no password." },
  { tone: "good", text: "Studio is running on this Mac." },
  { tone: "good", text: "Rehearsal sessions work." },
  {
    tone: "warn",
    text: "A Google or LinkedIn account is a separate profile, so what you do here won’t appear there, and the other way round.",
  },
];

// ---- Permission rows --------------------------------------------------------

export type PermissionRow = {
  id: "microphone" | "app-audio" | "screen";
  label: string;
  state: AccountPermissionState;
  // Where "Allow…" goes (the macOS privacy pane); null when macOS asks itself.
  settings: "microphone" | "screen" | null;
  // What an undetermined row says instead of "macOS asks when you start".
  pending?: string;
};

// Short enough to sit on the row's one line beside its label.
export const TAP_PENDING_TEXT = "macOS asks on first use";

// App audio is gated by Screen Recording while ScreenCaptureKit carries it, so
// it follows the screen's state. Through the system audio tap it needs System
// Audio Recording instead, which macOS cannot be asked about: the row never
// borrows the screen's state and never sends the person to Screen Recording.
export function permissionRows(
  permissions: AccountPermissions | null,
): PermissionRow[] {
  if (!permissions) return [];
  const tap =
    permissions.callAudio?.active === "processTap"
      ? permissions.callAudio
      : null;
  if (tap)
    return [
      microphoneRow(permissions),
      {
        id: "app-audio",
        label: "App audio · system tap",
        state: tap.permission === "granted" ? "granted" : "undetermined",
        settings: null,
        pending: TAP_PENDING_TEXT,
      },
      screenRow(permissions),
    ];
  return [
    microphoneRow(permissions),
    {
      id: "app-audio",
      label: "App audio",
      state: permissions.screen,
      settings: permissions.screen === "denied" ? "screen" : null,
    },
    screenRow(permissions),
  ];
}

const microphoneRow = (permissions: AccountPermissions): PermissionRow => ({
  id: "microphone",
  label: "Microphone",
  state: permissions.microphone,
  settings: permissions.microphone === "denied" ? "microphone" : null,
});
const screenRow = (permissions: AccountPermissions): PermissionRow => ({
  id: "screen",
  label: "Screen recording",
  state: permissions.screen,
  settings: permissions.screen === "denied" ? "screen" : null,
});

// ---- Call audio (Settings) --------------------------------------------------

export const CALL_AUDIO_OPTIONS: readonly {
  value: CallAudioSource;
  label: string;
}[] = [
  {
    value: "screenCaptureKit",
    label: "Screen capture (shows the sharing indicator)",
  },
  {
    value: "processTap",
    label: "System audio tap (macOS 14.4+, no sharing indicator)",
  },
];

// The honest line under the choice: what it costs, what it needs, and whether
// the choice is really what carries the call's audio right now.
export function callAudioNote(callAudio: AccountCallAudio): string {
  if (callAudio.selected === "screenCaptureKit")
    return "macOS shows “Currently Sharing” for the whole session. Needs Screen Recording.";
  if (!callAudio.tapSupported)
    return "This Mac’s macOS is older than 14.4, so screen capture is still used.";
  if (callAudio.active === "screenCaptureKit")
    return "The tap could not run on this Mac, so screen capture is used until you choose it again or restart.";
  return "No sharing indicator. macOS asks once for System Audio Recording; if you refuse, the call is heard as silence. Applies the next time listening starts.";
}

// ---- What the session is for ------------------------------------------------

export type StartTarget = {
  id: string;
  target: SetupTarget;
  icon: "work" | "timer";
  title: string;
  sub: string;
  // An interview is recorded with other people: the person confirms they agreed.
  needsAgreement: boolean;
};

export const REHEARSAL_TARGET: StartTarget = {
  id: "rehearsal",
  target: { kind: "rehearsal" },
  icon: "timer",
  title: "Rehearsal",
  sub: "Practice · no interview linked",
  needsAgreement: false,
};

const when = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day}, ${time}`;
};

// Every candidacy the owner has, newest first, as something a session can be
// started for (owner's rule, 2026-10-07: the interview's context is added in
// the native app and need not be scheduled). A candidacy with exactly one
// interview starts for that interview; otherwise for the candidacy alone.
export function candidacyTargets(
  choices: LiveSessionChoicesResponse | null,
): StartTarget[] {
  if (!choices) return [];
  return choices.candidacies.map((candidacy) => {
    const only =
      candidacy.interviews.length === 1 ? candidacy.interviews[0] : undefined;
    return {
      id: `candidacy:${candidacy.id}`,
      target: only
        ? {
            kind: "interview",
            candidacyId: candidacy.id,
            interviewId: only.id,
          }
        : { kind: "candidacy", candidacyId: candidacy.id },
      icon: "work",
      title: candidacy.title,
      sub: [
        candidacy.companyName,
        candidacy.hasBrief
          ? "Brief ready"
          : candidacy.hasJobSpec
            ? "Job spec, not cleaned up"
            : "No job spec yet",
      ].join(" · "),
      needsAgreement: only !== undefined,
    };
  });
}

// The next interview that has not started yet (soonest first), then Rehearsal.
// A local profile has no interviews to start for, so it is offered Rehearsal
// alone. Nothing is invented: no upcoming interview, no card for one.
export function startTargets(
  choices: LiveSessionChoicesResponse | null,
  member: ProductMember | null,
  now: number,
): StartTarget[] {
  if (!choices || member?.kind === "local") return [REHEARSAL_TARGET];
  const upcoming = choices.candidacies
    .flatMap((candidacy) =>
      candidacy.interviews.flatMap((interview) => {
        const at = interview.scheduledAt
          ? Date.parse(interview.scheduledAt)
          : NaN;
        return Number.isNaN(at) || at < now
          ? []
          : [{ candidacy, interview, at }];
      }),
    )
    .sort((a, b) => a.at - b.at)[0];
  if (!upcoming) return [REHEARSAL_TARGET];
  const { candidacy, interview } = upcoming;
  return [
    {
      id: `interview:${interview.id}`,
      target: {
        kind: "interview",
        candidacyId: candidacy.id,
        interviewId: interview.id,
      },
      icon: "work",
      title: interview.label,
      sub: [candidacy.companyName, when(interview.scheduledAt ?? "")]
        .filter(Boolean)
        .join(" · "),
      needsAgreement: true,
    },
    REHEARSAL_TARGET,
  ];
}

// ---- Why Start is blocked ---------------------------------------------------

export type StartFacts = {
  permissions: AccountPermissions | null;
  needsAgreement: boolean;
  agreed: boolean;
  // The shell's first-run consent (false: it must be reviewed first).
  shellConsented: boolean;
  starting: boolean;
  failure: SessionErrorCode | null;
};

export const LISTENING_HINT = "Listening starts right away";

// The first thing in the way of Start, as one line, or null when it can start.
// The order the person is asked: the shell's consent, the Mac's permissions,
// then who agreed.
export function startBlock(facts: StartFacts): string | null {
  if (!facts.shellConsented) return "Consent required";
  if (facts.permissions?.screen === "denied")
    return "Allow screen recording first";
  if (facts.permissions?.microphone === "denied")
    return "Allow the microphone first";
  if (facts.needsAgreement && !facts.agreed)
    return "Confirm everyone has agreed";
  return null;
}

// What sits under the button: a refusal's fixed sentence, else the block, else
// the quiet note.
export function startHint(facts: StartFacts): string {
  if (facts.failure) return startErrorMessage(facts.failure);
  return startBlock(facts) ?? LISTENING_HINT;
}

export const AGREEMENT_TEXT =
  "Everyone has agreed to recording and to me using AI assistance.";

// ---- Where a sign-in attempt ends -------------------------------------------

export const TIMED_OUT_TEXT =
  "Sign-in timed out before it finished. Nothing was changed. Try again.";
export const EXPIRED_TEXT = "Your session expired. Sign in again to continue.";
export const OUT_BLURB =
  "Uses the same account as Studio on the web, so your matrix, briefings and interviews come with you.";
export const OUT_NOTE =
  "Google and LinkedIn open in your browser. Studio never sees your password.";
