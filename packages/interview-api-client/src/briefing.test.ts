import { describe, expect, it } from "vitest";

import { createBriefingClient } from "./index.js";

describe("createBriefingClient", () => {
  it("reads profiles and artifacts, then edits, proposes, applies, and saves explicitly", async () => {
    const context = {
      company: "Acme",
      role: "Engineer",
      stage: "recruiter" as const,
      profile: { id: "profile/id", revision: 1 },
    };
    const briefing = {
      kind: "non-technical-briefing" as const,
      title: "Preparation",
      context,
      questions: [],
    };
    const artifact = {
      origin: {
        workspaceId: "briefings",
        artifactId: "artifact/id",
        artifactRevision: 2,
      },
      value: { question: "", notes: "", answer: null, briefing },
      updatedAt: "2026-10-01T00:00:00.000Z",
      provenance: null,
    };
    const saved = {
      workspaceId: "briefings",
      artifactId: "artifact/id",
      savedRevision: 1,
      draftRevision: 3,
      value: artifact.value,
      createdAt: "2026-10-01T00:00:00.000Z",
      provenance: null,
    };
    const responses = [
      {
        profiles: [
          {
            id: "profile/id",
            name: "Candidate",
            revision: 1,
            updatedAt: "now",
          },
        ],
      },
      {
        id: "profile/id",
        name: "Candidate",
        revision: 1,
        sha256: "a".repeat(64),
        matrix: { candidate: {}, roles: [] },
      },
      {
        artifacts: [
          {
            id: "artifact/id",
            title: "Preparation",
            revision: 2,
            savedRevision: 0,
            updatedAt: "now",
          },
        ],
      },
      artifact,
      artifact,
      { id: "proposal/id", baseRevision: 2, briefing },
      artifact,
      saved,
    ];
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000/",
      tenant: "team/a",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json(responses.shift());
      },
    });

    expect((await client.listProfiles()).profiles[0]?.id).toBe("profile/id");
    expect((await client.getProfile("profile/id", 1)).matrix.roles).toEqual([]);
    expect((await client.listArtifacts()).artifacts[0]?.id).toBe("artifact/id");
    expect(
      (await client.getArtifact("artifact/id")).origin.artifactRevision,
    ).toBe(2);
    expect(
      (
        await client.editArtifact("artifact/id", {
          expectedRevision: 2,
          briefing,
        })
      ).value.briefing.title,
    ).toBe("Preparation");
    expect(
      (
        await client.propose("artifact/id", {
          expectedRevision: 2,
          context,
          questions: [{ id: "q", question: "Why?", category: "motivation" }],
        })
      ).id,
    ).toBe("proposal/id");
    expect(
      (
        await client.apply("artifact/id", {
          proposalId: "proposal/id",
          expectedRevision: 2,
        })
      ).origin.artifactRevision,
    ).toBe(2);
    expect(
      (
        await client.save("artifact/id", {
          expectedRevision: 3,
          requestId: "request/id",
        })
      ).savedRevision,
    ).toBe(1);

    expect(requests.map(({ url, method }) => [url, method])).toEqual([
      [
        "http://localhost:3000/api/interview/briefing/profiles?tenant=team%2Fa",
        undefined,
      ],
      [
        "http://localhost:3000/api/interview/briefing/profiles/profile%2Fid/revisions/1?tenant=team%2Fa",
        undefined,
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts?tenant=team%2Fa",
        undefined,
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts/artifact%2Fid?tenant=team%2Fa",
        undefined,
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts/artifact%2Fid?tenant=team%2Fa",
        "PUT",
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts/artifact%2Fid/proposals?tenant=team%2Fa",
        "POST",
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts/artifact%2Fid/apply?tenant=team%2Fa",
        "POST",
      ],
      [
        "http://localhost:3000/api/interview/briefing/artifacts/artifact%2Fid/save?tenant=team%2Fa",
        "POST",
      ],
    ]);
    expect(requests[4]?.body).toEqual({ expectedRevision: 2, briefing });
    expect(requests[5]?.body).toEqual({
      expectedRevision: 2,
      context,
      questions: [{ id: "q", question: "Why?", category: "motivation" }],
    });
    expect(requests[6]?.body).toEqual({
      proposalId: "proposal/id",
      expectedRevision: 2,
    });
    expect(requests[7]?.body).toEqual({
      expectedRevision: 3,
      requestId: "request/id",
    });
  });

  it("rejects malformed successful artifact and save responses", async () => {
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => Response.json({ id: "wrong-envelope" }),
    });
    await expect(client.getArtifact("a")).rejects.toThrow();
    await expect(
      client.save("a", { expectedRevision: 1, requestId: "request" }),
    ).rejects.toThrow();
  });

  it("imports a profile and validates the returned revision", async () => {
    const calls: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          id: "profile/id",
          name: "Candidate",
          revision: 1,
          sha256: "a".repeat(64),
        });
      },
    });

    expect(
      await client.importProfile({
        name: "Candidate",
        matrix: { candidate: {}, roles: [] },
      }),
    ).toMatchObject({ id: "profile/id", revision: 1 });
    expect(calls).toEqual([
      {
        url: "http://localhost:3000/api/interview/briefing/profiles",
        method: "POST",
        body: { name: "Candidate", matrix: { candidate: {}, roles: [] } },
      },
    ]);
  });

  it("reports an HTTP failure when the server returns no JSON error body", async () => {
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => new Response("Service unavailable", { status: 503 }),
    });
    await expect(client.listArtifacts()).rejects.toMatchObject({
      name: "InterviewApiError",
      status: 503,
      message: "API request failed with HTTP 503.",
    });
  });
  it("encodes IDs, appends tenant, sends bearer auth, and preserves a conflict", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: string | undefined;
      auth: string | null;
    }> = [];
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000/",
      tenant: "team/a",
      token: "secret",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method,
          body: init?.body as string | undefined,
          auth: new Headers(init?.headers).get("authorization"),
        });
        return Response.json(
          { error: { code: "conflict", message: "Revision changed" } },
          { status: 409 },
        );
      },
    });

    await expect(
      client.apply("a/b", { proposalId: "p", expectedRevision: 2 }),
    ).rejects.toMatchObject({
      name: "InterviewApiError",
      status: 409,
      message: "Revision changed",
      details: { error: { code: "conflict", message: "Revision changed" } },
    });
    expect(requests).toEqual([
      {
        url: "http://localhost:3000/api/interview/briefing/artifacts/a%2Fb/apply?tenant=team%2Fa",
        method: "POST",
        body: '{"proposalId":"p","expectedRevision":2}',
        auth: "Bearer secret",
      },
    ]);
  });

  it("rejects invalid write input before the network", async () => {
    let calls = 0;
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => {
        calls++;
        return Response.json({});
      },
    });
    await expect(
      client.save("a", { expectedRevision: -1, requestId: "x" }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("rejects an invalid profile revision before the network", () => {
    let calls = 0;
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => {
        calls++;
        return Response.json({});
      },
    });
    expect(() => client.getProfile("p", Number.NaN)).toThrow(
      "Revision must be a non-negative integer.",
    );
    expect(calls).toBe(0);
  });

  it("rejects a successful HTTP response that violates the profile contract", async () => {
    const client = createBriefingClient({
      baseUrl: "http://localhost:3000",
      fetch: async () =>
        Response.json({ profiles: [{ id: "p", revision: "one" }] }),
    });
    await expect(client.listProfiles()).rejects.toThrow();
  });
  it("asks one question and prepares the briefing, surfacing the server's message", async () => {
    const briefing = {
      kind: "non-technical-briefing" as const,
      title: "Acme · Engineer",
      context: {
        company: "Acme",
        role: "Engineer",
        stage: "recruiter" as const,
        profile: { id: "p", revision: 1 },
      },
      questions: [],
    };
    const artifact = {
      origin: {
        workspaceId: "briefings",
        artifactId: "pack",
        artifactRevision: 3,
      },
      value: { question: "", notes: "", answer: null, briefing },
      updatedAt: "2026-10-01T00:00:00.000Z",
      provenance: null,
    };
    const requests: {
      url: string;
      method?: string | undefined;
      body?: unknown;
    }[] = [];
    let fail = false;
    const client = createBriefingClient({
      baseUrl: "",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return fail
          ? Response.json(
              {
                error: {
                  code: "pack-full",
                  message:
                    "A pack holds 20 answers. Remove one to ask another.",
                },
              },
              { status: 400 },
            )
          : Response.json(artifact);
      },
    });
    await client.ask("pack", {
      expectedRevision: 2,
      question: "Why Acme?",
      replaceId: "q1",
    });
    await client.prepare("pack", { expectedRevision: 3 });
    expect(requests).toEqual([
      {
        url: "/api/interview/briefing/artifacts/pack/ask",
        method: "POST",
        body: { expectedRevision: 2, question: "Why Acme?", replaceId: "q1" },
      },
      {
        url: "/api/interview/briefing/artifacts/pack/prepare",
        method: "POST",
        body: { expectedRevision: 3 },
      },
    ]);
    fail = true;
    await expect(
      client.ask("pack", { expectedRevision: 3, question: "One more?" }),
    ).rejects.toThrow("A pack holds 20 answers. Remove one to ask another.");
    await expect(
      client.ask("pack", { expectedRevision: 3, question: " " }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });
});
