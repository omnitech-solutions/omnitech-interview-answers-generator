import { describe, expect, it } from "vitest";
import {
  accountLines,
  candidacyTargets,
  chipOf,
  footerStatus,
  LOCAL_FACTS,
  permissionRows,
  REHEARSAL_TARGET,
  signOutLabel,
  startBlock,
  startHint,
  startTargets,
  TAP_PENDING_TEXT,
} from "./start-model";
import { parseProviders, windowTenant } from "./use-account";

const account = {
  name: "Alex Morgan",
  email: "alex@example.test",
  kind: "account" as const,
  canSignOut: true,
};
const local = { ...account, name: "Local User", kind: "local" as const };

describe("the account chip", () => {
  it("is the first name and its initial; a nameless account falls back to the email", () => {
    expect(chipOf(account)).toEqual({ initial: "A", short: "Alex" });
    expect(chipOf({ ...account, name: "" })).toEqual({
      initial: "A",
      short: "alex",
    });
  });
  it("is 'This Mac' with an M for a local profile, which has no account to show", () => {
    expect(chipOf(local)).toEqual({ initial: "M", short: "This Mac" });
    expect(accountLines(local)).toEqual({
      name: "Local profile",
      via: "No account on this Mac",
    });
    expect(signOutLabel(local)).toBe("Sign out of local profile");
    expect(accountLines(account)).toEqual({
      name: "Alex Morgan",
      via: "alex@example.test",
    });
    expect(signOutLabel(account)).toBe("Sign out");
  });
});

describe("honest copy", () => {
  it("never claims where data lives or that nothing leaves the Mac", () => {
    const words = [
      footerStatus(local).text,
      footerStatus(account).text,
      footerStatus(null).text,
      ...LOCAL_FACTS.map((fact) => fact.text),
    ].join(" ");
    expect(words).not.toMatch(
      /nothing leaves|stored on this Mac|on device|on-device|Synced/i,
    );
    expect(footerStatus(null).text).toBe("Not signed in");
    expect(footerStatus(local).text).toBe("Local profile · no account");
  });
});

describe("permission rows", () => {
  it("through the system audio tap, app audio never follows or points at Screen Recording", () => {
    const tap = {
      selected: "processTap",
      active: "processTap",
      permission: "undetermined",
      tapSupported: true,
    } as const;
    const rows = permissionRows({
      microphone: "granted",
      screen: "denied",
      callAudio: tap,
    });
    expect(rows.map((row) => [row.label, row.state, row.settings])).toEqual([
      ["Microphone", "granted", null],
      ["App audio · system tap", "undetermined", null],
      ["Screen recording", "denied", "screen"],
    ]);
    expect(rows[1]?.pending).toBe(TAP_PENDING_TEXT);
    expect(
      permissionRows({
        microphone: "granted",
        screen: "denied",
        callAudio: { ...tap, permission: "granted" },
      })[1]?.state,
    ).toBe("granted");
    // The tap chosen but screen capture carrying it (fallback), or the default:
    // exactly the rows as before.
    for (const callAudio of [
      { ...tap, active: "screenCaptureKit" },
      { ...tap, selected: "screenCaptureKit", active: "screenCaptureKit" },
    ] as const)
      expect(
        permissionRows({
          microphone: "granted",
          screen: "denied",
          callAudio,
        }).map((row) => [row.label, row.state, row.settings]),
      ).toEqual([
        ["Microphone", "granted", null],
        ["App audio", "denied", "screen"],
        ["Screen recording", "denied", "screen"],
      ]);
  });

  it("has none until the shell answers; app audio follows Screen Recording", () => {
    expect(permissionRows(null)).toEqual([]);
    const rows = permissionRows({ microphone: "granted", screen: "denied" });
    expect(rows.map((row) => [row.label, row.state, row.settings])).toEqual([
      ["Microphone", "granted", null],
      ["App audio", "denied", "screen"],
      ["Screen recording", "denied", "screen"],
    ]);
    expect(
      permissionRows({ microphone: "denied", screen: "granted" })[0]?.settings,
    ).toBe("microphone");
    expect(
      permissionRows({ microphone: "undetermined", screen: "granted" })[0]
        ?.settings,
    ).toBeNull();
  });
});

describe("what to start", () => {
  const future = Date.parse("2026-10-06T10:00:00Z");
  const choices = (...times: (string | null)[]) => ({
    profiles: [],
    candidacies: [
      {
        id: "c1",
        title: "Staff",
        companyName: "Example Corp",
        createdAt: "2026-10-01T00:00:00Z",
        interviews: times.map((scheduledAt, at) => ({
          id: `i${at}`,
          label: `Round ${at}`,
          kind: "technical",
          scheduledAt,
        })),
      },
    ],
  });
  it("is the soonest interview that has not started, then Rehearsal", () => {
    const targets = startTargets(
      choices(
        "2026-10-09T10:00:00Z",
        "2026-10-07T10:00:00Z",
        "2026-10-01T10:00:00Z",
        null,
      ),
      account,
      future,
    );
    expect(targets.map((target) => target.title)).toEqual([
      "Round 1",
      "Rehearsal",
    ]);
    expect(targets[0]?.needsAgreement).toBe(true);
    expect(targets[1]).toBe(REHEARSAL_TARGET);
    expect(REHEARSAL_TARGET.needsAgreement).toBe(false);
  });
  it("is Rehearsal alone with no upcoming interview, no data yet, or a local profile", () => {
    expect(startTargets(choices(null), account, future)).toEqual([
      REHEARSAL_TARGET,
    ]);
    expect(startTargets(null, account, future)).toEqual([REHEARSAL_TARGET]);
    expect(
      startTargets(choices("2026-10-09T10:00:00Z"), local, future),
    ).toEqual([REHEARSAL_TARGET]);
  });
});

describe("the Interview list (every candidacy, newest first as served)", () => {
  const candidacy = (
    id: string,
    interviews: number,
    flags: { hasJobSpec?: boolean; hasBrief?: boolean } = {},
  ) => ({
    id,
    title: `Role ${id}`,
    companyName: "Example Corp",
    createdAt: "2026-10-01T00:00:00Z",
    ...flags,
    interviews: Array.from({ length: interviews }, (_, at) => ({
      id: `${id}-i${at}`,
      label: `Round ${at}`,
      kind: "technical",
      // Unscheduled and past interviews count: the context lives in the app.
      scheduledAt: at === 0 ? null : "2020-01-01T10:00:00Z",
    })),
  });
  it("is empty with no data, and never invents a candidacy", () => {
    expect(candidacyTargets(null)).toEqual([]);
    expect(candidacyTargets({ profiles: [], candidacies: [] })).toEqual([]);
  });
  it("starts for the one interview a candidacy has (agreement needed), else for the candidacy alone", () => {
    const targets = candidacyTargets({
      profiles: [],
      candidacies: [
        candidacy("c1", 1, { hasBrief: true, hasJobSpec: true }),
        candidacy("c2", 2, { hasJobSpec: true }),
        candidacy("c3", 0),
      ],
    });
    expect(targets.map((target) => target.id)).toEqual([
      "candidacy:c1",
      "candidacy:c2",
      "candidacy:c3",
    ]);
    expect(targets[0]).toMatchObject({
      target: { kind: "interview", candidacyId: "c1", interviewId: "c1-i0" },
      icon: "work",
      // The company leads: two roles can share a title.
      title: "Example Corp · Role c1",
      sub: "Example Corp · Brief ready",
      needsAgreement: true,
    });
    expect(targets[1]).toMatchObject({
      target: { kind: "candidacy", candidacyId: "c2" },
      sub: "Example Corp · Job spec, not cleaned up",
      needsAgreement: false,
    });
    expect(targets[2]).toMatchObject({
      target: { kind: "candidacy", candidacyId: "c3" },
      sub: "Example Corp · No job spec yet",
      needsAgreement: false,
    });
  });
});

describe("why Start is blocked", () => {
  const ready = {
    permissions: { microphone: "granted", screen: "granted" } as const,
    needsAgreement: true,
    agreed: true,
    shellConsented: true,
    starting: false,
    failure: null,
  };
  it("asks in order: the shell's consent, the screen, the microphone, then who agreed", () => {
    expect(startBlock(ready)).toBeNull();
    expect(startHint(ready)).toBe("Listening starts right away");
    expect(startBlock({ ...ready, agreed: false })).toBe(
      "Confirm everyone has agreed",
    );
    expect(
      startBlock({
        ...ready,
        agreed: false,
        permissions: { microphone: "denied", screen: "denied" },
      }),
    ).toBe("Allow screen recording first");
    expect(
      startBlock({
        ...ready,
        permissions: { microphone: "denied", screen: "granted" },
      }),
    ).toBe("Allow the microphone first");
    expect(startBlock({ ...ready, shellConsented: false, agreed: false })).toBe(
      "Consent required",
    );
  });
  it("does not need the agreement for a target that has none, and does not guess an unknown permission", () => {
    expect(
      startBlock({ ...ready, needsAgreement: false, agreed: false }),
    ).toBeNull();
    expect(startBlock({ ...ready, permissions: null })).toBeNull();
    expect(
      startBlock({
        ...ready,
        permissions: { microphone: "undetermined", screen: "granted" },
      }),
    ).toBeNull();
  });
  it("shows a refusal's fixed sentence over the quiet note", () => {
    expect(startHint({ ...ready, failure: "open_session_exists" })).toMatch(
      /already have an open live session/,
    );
  });
});

describe("Studio's list of sign-ins", () => {
  it("reads the list, and the older single flag as 'a real provider exists'", () => {
    expect(
      parseProviders({ configured: true, providers: ["google", "local"] }),
    ).toEqual({ status: "ready", google: true, linkedin: false, local: true });
    expect(parseProviders({ configured: true })).toEqual({
      status: "ready",
      google: true,
      linkedin: true,
      local: false,
    });
    expect(parseProviders({ configured: false })).toEqual({
      status: "ready",
      google: false,
      linkedin: false,
      local: false,
    });
  });
  it("is an error for anything else, and ignores names it does not know", () => {
    for (const bad of [null, "x", 3, {}, { configured: "yes" }])
      expect(parseProviders(bad)).toEqual({ status: "error" });
    expect(parseProviders({ providers: ["github", 4] })).toEqual({
      status: "ready",
      google: false,
      linkedin: false,
      local: false,
    });
  });
});

describe("the window's workspace", () => {
  const at = (path: string, search = "") =>
    ({ pathname: path, search }) as unknown as Location;
  it("is the one in the path, else the shell's ?tenant=, and only a valid slug", () => {
    expect(windowTenant(at("/t/acme/p/interview/live/overlay"))).toBe("acme");
    expect(windowTenant(at("/native/sign-in", "?tenant=acme-2"))).toBe(
      "acme-2",
    );
    expect(windowTenant(at("/native/sign-in", "?tenant=../x"))).toBe("local");
    expect(windowTenant(at("/native/sign-in"))).toBe("local");
  });
});
