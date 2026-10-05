// Test support for the missing-context journey: a scripted Active Session whose
// first revision of a screenshot task reports missing context, and whose
// owner-input and capture routes behave like the worker: the input revises the
// task it targets (a new revision, newer than every action before it) and the
// answer for that revision reports `nextMissing`. A fake server only: whether a
// real model flags a cut-off page is not shown by anything built on this.

import type {
  LiveAction,
  LiveMissingContext,
  LiveStreamResponse,
} from "@omnitech/interview-contracts";
import { vi } from "vitest";
import { answerAction } from "./live-view-kit";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "./session-fixtures";
import { answerResult } from "./session-result-fixtures";
import { createTestServer, type TestServer } from "./session-test-server";

export const CUT_OFF_TASK = "task-cut-off";
export const CUT_OFF: LiveMissingContext = [
  { kind: "examples" },
  { kind: "statement-cut-off", note: "the bottom of the page is hidden" },
];

export type TaskTarget = { taskId: string; revision: number };

export type Journey = {
  server: TestServer;
  page: LiveStreamResponse;
  // JSON bodies of POST /:id/input, in order.
  inputs: Record<string, unknown>[];
  // The multipart fields of POST /:id/capture, in order (image bytes left out).
  captures: Record<string, string>[];
  // The control actions posted (pause, stop-work ...).
  controls: string[];
  // What the next revision's answer reports as missing, or nothing.
  nextMissing: LiveMissingContext | undefined;
  // The worker was stopped before it published: inputs are accepted, nothing
  // is published for them.
  stopped: boolean;
  // The answer text of the next revision.
  nextDraft: string;
  // Publish an action as the worker would, `seconds` after the last change.
  publish(action: LiveAction): void;
  // The action a revision of a task publishes.
  revision(
    target: TaskTarget,
    over?: { missing?: LiveMissingContext; draft?: string },
  ): LiveAction;
};

let clock = 0;
// Strictly increasing, so "newest" is never a tie.
const stamp = (): string => minutesAfter(2, (clock += 1));

export function revisionAction(
  taskId: string,
  revision: number,
  over: { missing?: LiveMissingContext; draft?: string } = {},
): LiveAction {
  const at = stamp();
  return {
    ...answerAction(
      answerResult({
        draft: over.draft ?? `Answer for revision ${revision}.`,
      }),
      {
        taskId,
        taskRevision: revision,
        createdAt: at,
        updatedAt: at,
        sourceSnapshots: [{ sourceId: "screen", eventId: "evt-1" }],
      },
    ),
    ...(over.missing ? { missingContext: [...over.missing] } : {}),
  };
}

export function startJourney(
  options: {
    session?: Parameters<typeof sessionView>[0];
    first?: LiveMissingContext | undefined;
    // Extra routes a test wants to answer itself.
    onInput?: (body: Record<string, unknown>) => Response | undefined;
  } = {},
): Journey {
  const session = sessionView({
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...options.session,
  });
  const journey: Journey = {
    server: undefined as never,
    page: streamPage({
      session,
      observations: [snapshot(1, "Problem page")],
      nextAfterSequence: 1,
      actions: [
        revisionAction(CUT_OFF_TASK, 1, {
          ...("first" in options
            ? options.first
              ? { missing: options.first }
              : {}
            : { missing: CUT_OFF }),
          draft: "First read of the cut-off problem.",
        }),
      ],
    }),
    inputs: [],
    captures: [],
    controls: [],
    nextMissing: undefined,
    stopped: false,
    nextDraft: "Revised with the added context.",
    publish(action) {
      journey.page = {
        ...journey.page,
        actions: [...journey.page.actions, action],
      };
    },
    revision(target, over) {
      return revisionAction(target.taskId, target.revision, over);
    },
  };
  const revise = (target: TaskTarget | null) => {
    if (journey.stopped) return;
    const next = target
      ? { taskId: target.taskId, revision: target.revision + 1 }
      : { taskId: `task-new-${journey.page.actions.length}`, revision: 1 };
    journey.publish(
      revisionAction(next.taskId, next.revision, {
        ...(journey.nextMissing ? { missing: journey.nextMissing } : {}),
        draft: journey.nextDraft,
      }),
    );
  };
  const server = createTestServer(() => journey.page);
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("POST /:id/input", ({ body }) => {
    const sent = body as Record<string, unknown>;
    journey.inputs.push(sent);
    const custom = options.onInput?.(sent);
    if (custom) return custom;
    revise((sent["target"] as TaskTarget | undefined) ?? null);
    return jsonResponse(
      {
        input: {
          requestId: String(sent["requestId"]),
          sequence: journey.inputs.length + 10,
        },
      },
      202,
    );
  });
  server.on("POST /:id/capture", ({ body }) => {
    const form = body as FormData;
    const fields: Record<string, string> = {};
    for (const [name, value] of form.entries())
      if (typeof value === "string") fields[name] = value;
    journey.captures.push(fields);
    const taskId = fields["targetTaskId"];
    revise(
      taskId ? { taskId, revision: Number(fields["targetRevision"]) } : null,
    );
    const number = journey.page.observations.length + 1;
    journey.page = {
      ...journey.page,
      observations: [...journey.page.observations, snapshot(number)],
      nextAfterSequence: number,
    };
    return jsonResponse(
      {
        input: {
          requestId: String(fields["requestId"]),
          sequence: number + 10,
        },
        snapshots: [{ sourceId: "screen", eventId: `evt-${number}` }],
      },
      202,
    );
  });
  server.on("POST /:id/control", ({ body }) => {
    const control = (body as { action: string }).action;
    journey.controls.push(control);
    return jsonResponse({ session });
  });
  journey.server = server;
  return journey;
}

// The host a Mac shell injects, reduced to capturing: one JPEG per call.
const JPEG_BASE64 = btoa("\xff\xd8\xff\xe0JFIF");
export function installCaptureHost(
  extra: Record<string, unknown> = {},
  capture: () => Promise<unknown> = async () => ({
    ok: true,
    mediaType: "image/jpeg",
    base64: JPEG_BASE64,
  }),
) {
  const captureScreen = vi.fn(capture);
  // The native source has no live stream; the page only needs the type.
  vi.stubGlobal("MediaStream", class {});
  window.studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: ["capture-screen"],
    captureScreen,
    pinOnTop: async () => true,
    openExternal: async () => undefined,
    onHotkey: () => () => undefined,
    ...extra,
  };
  return captureScreen;
}
