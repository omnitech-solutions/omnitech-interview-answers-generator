// A scripted Active Session service for whole-shell tests (live-e2e,
// guarantee-strings): one mutable script the test edits between ticks, served
// through the same routes the browser client calls. Test support only; names are
// placeholders (Interviewer, Candidate, Example Corp).
import type {
  LiveAction,
  LiveCompanionCapability,
  LiveObservation,
  LiveSessionChoicesResponse,
  LiveSessionStartRequest,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { vi } from "vitest";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
} from "./session-fixtures";
import { createTestServer, type TestServer } from "./session-test-server";

export const CANDIDACY_ID = "22222222-2222-4222-8222-222222222222";
export const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";

export const CHOICES: LiveSessionChoicesResponse = {
  candidacies: [
    {
      id: CANDIDACY_ID,
      title: "Staff Engineer",
      companyName: "Example Corp",
      createdAt: minutesAfter(0),
      interviews: [
        {
          id: INTERVIEW_ID,
          label: "Recruiter screen",
          kind: "screening",
          scheduledAt: null,
        },
      ],
    },
  ],
  profiles: [
    {
      profileId: "main",
      name: "Main matrix",
      revision: 3,
      createdAt: minutesAfter(0),
      entryCount: 4,
      latest: true,
    },
  ],
};

export type Script = {
  // null: no session exists (Setup).
  session: LiveSessionView | null;
  observations: LiveObservation[];
  actions: LiveAction[];
  // The server clock minus the browser clock, in ms.
  skewMs: number;
  // The bodies the browser sent, in order.
  started: LiveSessionStartRequest[];
  controls: string[];
  renewals: number;
  // The companion's last capability report, as the route answers it.
  capability: LiveCompanionCapability | null;
  // GET /:id answers seen since a delete began (the purge settles on the 2nd).
  purgeReads: number;
};

export type ScriptedService = {
  script: Script;
  server: TestServer;
  // Replace the session, keeping the id, with these fields changed.
  patch(overrides: Partial<LiveSessionView>): void;
};

const ENDED = new Set(["ended", "purging"]);

export function installScriptedService(
  initial: Partial<Script> = {},
): ScriptedService {
  const script: Script = {
    session: null,
    observations: [],
    actions: [],
    skewMs: 0,
    started: [],
    controls: [],
    renewals: 0,
    purgeReads: 0,
    capability: null,
    ...initial,
  };
  const current = (): LiveSessionView => {
    if (!script.session) throw new Error("no scripted session");
    return script.session;
  };
  const server = createTestServer();
  server.on("GET /choices", () => jsonResponse(CHOICES));
  server.on("GET /companion-capability", () =>
    jsonResponse({ capability: script.capability }),
  );
  server.on("GET /current", () =>
    script.session && !ENDED.has(script.session.status)
      ? jsonResponse({ session: script.session })
      : jsonResponse({ error: { code: "not_found" } }, 404),
  );
  server.on("GET /:id", () => {
    if (!script.session)
      return jsonResponse({ error: { code: "not_found" } }, 404);
    if (script.session.status === "purging") {
      script.purgeReads += 1;
      if (script.purgeReads >= 2)
        script.session = { ...script.session, status: "ended", purged: true };
    }
    return jsonResponse({ session: script.session });
  });
  server.on("GET /:id/stream", ({ url }) => {
    const after = Number(url.searchParams.get("afterSequence") ?? 0);
    const fresh = script.observations.filter((item) => item.sequence > after);
    const last = script.observations.at(-1)?.sequence ?? 0;
    return jsonResponse(
      streamPage({
        session: current(),
        observations: fresh,
        actions: script.actions,
        nextAfterSequence: Math.max(after, last),
        serverNow: new Date(Date.now() + script.skewMs).toISOString(),
      }),
    );
  });
  server.on("POST /", ({ body }) => {
    const request = body as LiveSessionStartRequest;
    script.started.push(request);
    script.session = sessionView({
      status: "created",
      processingPolicy: request.processingPolicy,
      captureSources: request.captureSources,
      liveAssistance: request.liveAssistance ?? true,
      retention: request.retention ?? "delete-at-end",
      candidacyId: request.candidacyId ?? null,
      interviewId: request.interviewId ?? null,
      rehearsalRunId: request.rehearsal?.runId ?? null,
      strict: request.rehearsal?.strict ?? false,
      createdAt: new Date(Date.now() + script.skewMs).toISOString(),
      lastHeartbeatAt: null,
    });
    return jsonResponse(
      {
        session: script.session,
        credential: {
          value: "pair-credential-0001",
          expiresAt: minutesAfter(120),
        },
      },
      201,
    );
  });
  server.on("POST /:id/control", ({ body }) => {
    const action = (body as { action: string }).action;
    script.controls.push(action);
    script.session = {
      ...current(),
      status:
        action === "end" ? "ended" : action === "pause" ? "paused" : "active",
      ...(action === "end"
        ? { endedAt: new Date(Date.now() + script.skewMs).toISOString() }
        : {}),
    };
    return jsonResponse({ session: script.session });
  });
  server.on("POST /:id/credential", () => {
    script.renewals += 1;
    script.session = {
      ...current(),
      credentialRevoked: false,
      credentialExpiresAt: minutesAfter(240),
    };
    return jsonResponse({
      credential: {
        value: "pair-credential-0002",
        expiresAt: minutesAfter(240),
      },
    });
  });
  server.on("DELETE /:id", () => {
    script.purgeReads = 0;
    script.session = { ...current(), status: "purging" };
    return jsonResponse({ session: script.session }, 202);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/interview/t/local/sessions"))
        return server.fetch(url, init);
      if (url.includes("/artifacts")) return Response.json([]);
      if (url.includes("/briefs")) return Response.json({ briefs: [] });
      if (url.includes("/briefing/artifacts"))
        return Response.json({ artifacts: [] });
      return Response.json({}, { status: 404 });
    }),
  );
  return {
    script,
    server,
    patch(overrides) {
      script.session = { ...current(), ...overrides };
    },
  };
}
