// The states of the session UI both whole-shell suites render: the guarantee
// strings and the accessible names. Each prepares the scripted service; the
// regexes are what the guarantee suite expects (the names suite ignores them).
// Test support only.

import type { ScriptedService } from "./live-script-kit";
import {
  action,
  disconnected,
  gap,
  minutesAfter,
  SESSION_ID,
  sessionView,
  transcript,
} from "./session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
  logisticsResult,
  starResult,
} from "./session-result-fixtures";

export type Scenario = {
  name: string;
  path?: string;
  prepare(service: ScriptedService): void;
  // Claims that must hold in this state.
  must?: RegExp[];
  // Wording that would be false in this state.
  mustNot?: RegExp[];
};

export const LIVE = "/t/local/p/interview/live";
const fresh = () => ({ lastHeartbeatAt: minutesAfter(1) });

export const SCENARIOS: Scenario[] = [
  {
    name: "setup, defaults",
    prepare: () => undefined,
    must: [/Device only/, /Raw audio/, /Memory only, never saved/],
    // "not connected" is the honest line; a bare claim of connection is not.
    mustNot: [/(?<!not )connected/i, /receiving/i],
  },
  {
    name: "just started: no contact recorded",
    prepare: ({ script }) => {
      script.session = sessionView({ status: "created" });
    },
    must: [/No contact yet/, /Capture companion: not connected/],
    mustNot: [
      /(?<!not )connected/i,
      /receiving/i,
      /In contact/,
      /Waiting for the capture companion/,
    ],
  },
  {
    name: "live and ready",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
    },
    must: [/Ready/, /In contact/],
    mustNot: [/Waiting for the capture companion/],
  },
  {
    name: "paused",
    prepare: ({ script }) => {
      script.session = sessionView({ status: "paused", ...fresh() });
    },
    must: [/Paused/, /any result that arrives while paused is discarded/],
    mustNot: [/Ready/],
  },
  {
    name: "permission revoked and a dropped gap",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
      script.observations = [
        disconnected(1, "microphone", "permission-revoked"),
        gap(2, "application-audio", "buffer-overflow", 4000),
      ];
    },
    must: [/Permission revoked/, /recorded in the transcript/],
    mustNot: [/Receiving/],
  },
  {
    name: "companion out of contact",
    prepare: ({ script }) => {
      script.session = sessionView({ lastHeartbeatAt: minutesAfter(-3) });
      script.observations = [transcript(1, "Words from earlier.")];
    },
    // One line, no alarm: the companion is optional.
    must: [/No contact for/, /Capture companion: not connected/],
    mustNot: [
      /Receiving/,
      /In contact/,
      /(?<!not )connected/i,
      /Waiting for the capture companion/,
      /can't tell whether anything is being captured/,
    ],
  },
  {
    name: "credential expired",
    prepare: ({ script }) => {
      script.session = sessionView({
        credentialExpiresAt: minutesAfter(0, 30),
        ...fresh(),
      });
    },
    must: [/credential has expired/],
  },
  {
    name: "credential revoked",
    prepare: ({ script }) => {
      script.session = sessionView({ credentialRevoked: true, ...fresh() });
    },
    must: [/credential was revoked/],
  },
  {
    name: "answers of every kind, withheld and refused work, remote policy",
    prepare: ({ script }) => {
      script.session = sessionView({
        processingPolicy: "permitted-remote",
        ...fresh(),
      });
      script.observations = [transcript(1, "Question one.")];
      script.actions = [
        action({ taskId: "a", result: answerResult() }),
        action({ taskId: "b", result: starResult() }),
        action({ taskId: "c", result: logisticsResult() }),
        action({ taskId: "d", result: codingAnswer(["Single thread"]) }),
        action({
          taskId: "d",
          actionKind: "solve-code",
          result: codeResult(),
        }),
        action({
          taskId: "e",
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
          result: { withheld: { rejectedClaimCount: 1 } },
        }),
      ];
    },
    must: [/Remote allowed/, /Profile fast · device-only policy/],
    // Remote is allowed here, so nothing may say content stays on this Mac.
    mustNot: [
      /On this Mac only/,
      /never sent elsewhere/,
      /Refused: needs a remote model/,
    ],
  },
  {
    name: "device-only refusing coding work",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
      script.actions = [
        action({
          taskId: "x",
          actionKind: "solve-code",
          dispatchStatus: "suppressed",
          suppressionReason: "policy_refused",
        }),
      ];
    },
    must: [/On this Mac only/, /Refused: needs a remote model/],
    mustNot: [/Remote allowed/, /Remote model, through Studio/],
  },
  {
    name: "ended summary",
    path: `${LIVE}/${SESSION_ID}`,
    prepare: ({ script }) => {
      script.session = sessionView({
        status: "ended",
        endedAt: minutesAfter(5),
      });
      script.actions = [action({ taskId: "a", result: answerResult() })];
    },
    must: [
      /Nothing was submitted or sent for you/,
      /Raw audio is never stored/,
      /may contain captured questions and generated answers or code/i,
    ],
    mustNot: [/nothing is running/i],
  },
  {
    name: "deleted session tombstone",
    path: `${LIVE}/${SESSION_ID}`,
    prepare: ({ script }) => {
      script.session = sessionView({
        status: "ended",
        endedAt: minutesAfter(5),
        purged: true,
      });
    },
    must: [
      /Session data deleted/,
      /may contain captured questions and generated answers or code/i,
    ],
  },
];
