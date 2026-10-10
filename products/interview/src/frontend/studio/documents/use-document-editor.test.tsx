import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentContext } from "./documents-client";
import { PREVIEW_DELAY_MS, useDocumentEditor } from "./use-document-editor";

const ID = "22222222-2222-4222-8222-222222222222";
const ROOT = `/api/interview/documents/${ID}`;
const context: DocumentContext = {
  profiles: [{ id: "profile-1", name: "Experience matrix", revision: 2 }],
  candidacies: [],
  interviews: [],
  targets: [{ id: "target-1", label: "Primary model" }],
};
const fields = [
  {
    key: "full_name",
    label: "Full name",
    source: "candidate-profile",
    required: true,
    maxLength: null,
  },
  {
    key: "summary",
    label: "Summary",
    source: "candidate-profile",
    required: true,
    maxLength: 200,
  },
];

type Call = { method: string; path: string; body: unknown };
type Held = { resolve(response: Response): void; signal: AbortSignal | null };
let calls: Call[];
let revision: number;
let stored: Record<string, string>;
// A request held open by a test, by "METHOD suffix".
let hold: Record<string, Held[]>;
let holding: Set<string>;
// Honour an abort as a browser does; off, a late answer still arrives.
let honourAbort: boolean;

const detail = () => ({
  document: {
    id: ID,
    title: "Resume",
    status: "ready",
    currentRevision: revision,
    templateId: "t",
    templateRevision: 1,
    profileId: "profile-1",
    profileRevision: 2,
    candidacyId: null,
    interviewId: null,
    updatedAt: "2026-10-02",
  },
  revision: {
    revision,
    values: stored,
    validation: [],
    provenance: { kind: "generated", modelOwnedKeys: ["summary"] },
    createdAt: "2026-10-02",
  },
  template: { id: "t", name: "Resume", kind: "resume", format: "md" },
  fields,
});

beforeEach(() => {
  calls = [];
  revision = 1;
  stored = { full_name: "Ada", summary: "Short" };
  hold = {};
  holding = new Set();
  honourAbort = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path, body });
      const suffix = path.slice(ROOT.length).replace(/\?.*$/, "");
      const key = `${method} ${suffix}`;
      if (holding.has(key))
        return new Promise<Response>((resolve, reject) => {
          hold[key] = [
            ...(hold[key] ?? []),
            { resolve, signal: init?.signal ?? null },
          ];
          if (honourAbort)
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
        });
      if (method === "GET" && suffix === "")
        return Promise.resolve(Response.json(detail()));
      if (method === "GET" && suffix === "/preview")
        return Promise.resolve(Response.json({ kind: "html", html: "saved" }));
      if (method === "GET" && suffix === "/exports")
        return Promise.resolve(Response.json({ exports: [] }));
      if (method === "POST" && suffix === "/preview")
        return Promise.resolve(
          Response.json({ kind: "html", html: "draft", validation: [] }),
        );
      if (method === "POST" && suffix === "/revisions") {
        revision++;
        stored = (body as { values: Record<string, string> }).values;
        return Promise.resolve(Response.json({ revision }, { status: 201 }));
      }
      return Promise.resolve(
        Response.json({ error: { code: "not-found" } }, { status: 404 }),
      );
    }),
  );
});

function open() {
  const notify = vi.fn();
  const onChanged = vi.fn();
  const onDirtyChange = vi.fn();
  const hook = renderHook(() =>
    useDocumentEditor({ id: ID, context, onChanged, onDirtyChange, notify }),
  );
  return { ...hook, notify, onChanged, onDirtyChange };
}
const posts = (suffix: string) =>
  calls.filter(
    (call) => call.method === "POST" && call.path === `${ROOT}${suffix}`,
  );
const edit = (
  result: { current: ReturnType<typeof useDocumentEditor> },
  summary: string,
) => act(() => result.current.edit({ ...result.current.values, summary }));

describe("useDocumentEditor", () => {
  it("loads the revision, its preview and exports, and starts clean", async () => {
    const { result, onDirtyChange } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.values).toEqual(stored);
    expect(result.current.preview).toEqual({ kind: "html", html: "saved" });
    expect(result.current.facts).toMatchObject({
      current: 1,
      shown: 1,
      older: false,
      dirty: false,
      busy: false,
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("previews a burst of edits once, after the pause, and saves nothing", async () => {
    const { result, onDirtyChange } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    edit(result, "A");
    edit(result, "AB");
    edit(result, "ABC");
    expect(result.current.facts?.dirty).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(posts("/preview")).toHaveLength(0);
    await waitFor(() => expect(posts("/preview")).toHaveLength(1));
    expect(posts("/preview")[0]?.body).toEqual({
      baseRevision: 1,
      values: { full_name: "Ada", summary: "ABC" },
    });
    await waitFor(() =>
      expect(result.current.preview).toEqual({ kind: "html", html: "draft" }),
    );
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
    expect(posts("/preview")).toHaveLength(1);
    expect(posts("/revisions")).toHaveLength(0);
  });

  it("drops a stale preview answer even when the request could not be aborted", async () => {
    // The network ignores the abort: only the request order can protect.
    honourAbort = false;
    holding.add("POST /preview");
    const { result } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    edit(result, "First");
    await waitFor(() => expect(hold["POST /preview"]).toHaveLength(1));
    edit(result, "Second");
    await waitFor(() => expect(hold["POST /preview"]).toHaveLength(2));
    const [first, second] = hold["POST /preview"]!;
    // The earlier request was aborted when the draft moved on.
    expect(first!.signal?.aborted).toBe(true);
    expect(second!.signal?.aborted).toBe(false);
    await act(async () => {
      second!.resolve(
        Response.json({ kind: "html", html: "second", validation: [] }),
      );
    });
    await waitFor(() =>
      expect(result.current.preview).toEqual({ kind: "html", html: "second" }),
    );
    await act(async () => {
      first!.resolve(
        Response.json({
          kind: "html",
          html: "first",
          validation: [{ key: "summary", code: "too-long" }],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(result.current.preview).toEqual({ kind: "html", html: "second" });
    expect(result.current.validation).toEqual([]);
    expect(result.current.error).toBe("");
  });

  it("saves the draft once against the revision it was read at, then reads the latest", async () => {
    const { result, notify, onChanged } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    // Nothing changed: leaving a field saves nothing.
    act(() => result.current.formActions.leave());
    expect(posts("/revisions")).toHaveLength(0);
    edit(result, "Longer");
    act(() => result.current.formActions.leave());
    // A second leave while the save is in flight makes no second revision.
    act(() => result.current.formActions.leave());
    await waitFor(() => expect(result.current.facts?.current).toBe(2));
    expect(posts("/revisions")).toHaveLength(1);
    expect(posts("/revisions")[0]?.body).toEqual({
      baseRevision: 1,
      values: { full_name: "Ada", summary: "Longer" },
    });
    expect(notify).toHaveBeenCalledWith("Saved as rev 2");
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.facts?.dirty).toBe(false));
    expect(result.current.working).toBeNull();
  });

  it("keeps the draft and says so when the revision has moved on", async () => {
    const { result, notify, onChanged } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.resolve(
        Response.json(
          { error: { code: "revision-conflict" } },
          { status: 409 },
        ),
      ),
    );
    edit(result, "Mine");
    // The preview request takes the one-off answer if it goes first.
    await act(async () => {
      result.current.formActions.leave();
    });
    await waitFor(() =>
      expect(result.current.error).toMatch(/A newer revision exists/),
    );
    expect(result.current.values["summary"]).toBe("Mine");
    expect(result.current.facts).toMatchObject({ current: 1, dirty: true });
    expect(result.current.working).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("cancels a regeneration and keeps the revision it had", async () => {
    holding.add("POST /regenerate");
    const { result, notify, onChanged } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    const loads = calls.length;
    act(() => result.current.commands.regenerate("all"));
    await waitFor(() => expect(hold["POST /regenerate"]).toHaveLength(1));
    expect(result.current.working).toBe("all");
    expect(result.current.facts).toMatchObject({
      busy: true,
      generating: true,
    });
    expect(posts("/regenerate")[0]?.body).toEqual({
      baseRevision: 1,
      mode: "all",
      aiTargetId: "target-1",
    });
    await act(async () => result.current.commands.cancel());
    await waitFor(() => expect(result.current.working).toBeNull());
    expect(hold["POST /regenerate"]![0]!.signal?.aborted).toBe(true);
    expect(notify).toHaveBeenCalledWith("Cancelled — kept rev 1");
    expect(onChanged).not.toHaveBeenCalled();
    expect(result.current.error).toBe("");
    expect(result.current.facts?.current).toBe(1);
    expect(result.current.values).toEqual({
      full_name: "Ada",
      summary: "Short",
    });
    // Nothing was read again: there is nothing new to read.
    expect(calls).toHaveLength(loads + 1);
  });

  it("aborts the request in hand when the editor closes", async () => {
    holding.add("POST /regenerate");
    const { result, unmount } = open();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    act(() => result.current.commands.regenerateField("summary"));
    await waitFor(() => expect(hold["POST /regenerate"]).toHaveLength(1));
    expect(result.current.views["summary"]).toMatchObject({
      regenerating: true,
    });
    unmount();
    expect(hold["POST /regenerate"]![0]!.signal?.aborted).toBe(true);
  });
});
