import { createHash, randomUUID } from "node:crypto";
import { createAiEngine, type ModelPort } from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { documentCreateSchema } from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDocumentsApi, resolveDocumentsScope } from "./api";
import { InterviewDocumentRepository } from "./repository";

let pg: DisposablePostgres;
let database: PlatformDatabase;
let tenantId: string;
let ownerId: string;
let otherId: string;
const output: unknown[] = [];
let waitForAbort = false;
let enteredGeneration: (() => void) | null = null;
let concurrentGate: {
  entered: number;
  arrived: () => void;
  release: Promise<void>;
} | null = null;
let saveGenerationGate: { entered: () => void; release: Promise<void> } | null =
  null;
// The model is the provider boundary: it records what the product asked for
// and answers every field of the schema it was given.
const model: ModelPort = {
  async *stream(_scope, input, signal) {
    output.push({
      profileId: input.profileId,
      prompt: input.messages
        .filter((message) => message.role === "user")
        .flatMap((message) =>
          message.parts.map((part) => (part.type === "text" ? part.text : "")),
        )
        .join(""),
      signal,
    });
    if (concurrentGate) {
      const gate = concurrentGate;
      gate.entered++;
      if (gate.entered === 2) gate.arrived();
      await gate.release;
    }
    if (saveGenerationGate) {
      const gate = saveGenerationGate;
      gate.entered();
      await gate.release;
    }
    if (waitForAbort) {
      enteredGeneration?.();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      });
    }
    const schema = input.schema as { properties?: Record<string, unknown> };
    yield {
      type: "text",
      text: JSON.stringify(
        Object.fromEntries(
          Object.keys(schema.properties ?? {}).map((key) => [
            key,
            key === "name" || key === "full_name" ? "Ada" : "Evidence",
          ]),
        ),
      ),
    };
  },
};
const listed = (id: string, name: string) => ({
  id,
  name,
  tags: [],
  vision: false,
  reasoning: false,
  local: false,
});
const engine = createAiEngine({
  profiles: [
    { id: "test-model", label: "Test model", provider: "test" },
    { id: "lm-studio", provider: "installed", catalog: true },
    { id: "agent", provider: "agents", catalog: true },
  ],
  providers: {
    test: model,
    installed: model,
    agents: { ...model, kind: "agent" },
  },
  catalogs: {
    installed: {
      list: async () => ({ models: [listed("lm-studio/qwen", "Qwen")] }),
    },
    agents: {
      list: async () => ({
        models: [listed("agent/claude-code", "Claude Code")],
      }),
    },
  },
  authorize: (execution) =>
    execution.permissions?.includes("interview.read")
      ? true
      : "AI profile not authorized",
});
type Asked = { profileId: string; prompt: string; signal: AbortSignal };
function context(
  actorId: string,
  permissions = ["interview.read", "interview.documents.write"],
): PlatformContext {
  return {
    user: {
      id: actorId,
      email: `${actorId}@example.invalid`,
      displayName: "Member",
      avatarUrl: null,
    },
    tenant: { id: tenantId, slug: "local", name: "Local" },
    membership: { tenantId, userId: actorId, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions,
    products: [
      {
        productId: "omnitech.interview",
        name: "Interview",
        description: "",
        icon: "sparkles",
        enabled: true,
        routePrefix: "",
        navigation: { group: "", order: 0, hidden: false, routes: {} },
        featureFlags: {},
        settings: {},
        revision: 1,
      },
    ],
  } as PlatformContext;
}
function app(actorId: string, permissions?: string[]) {
  return createDocumentsApi({
    database,
    engine,
    resolveScope: async (request) =>
      resolveDocumentsScope(
        context(actorId, permissions),
        request.headers.get("x-omnitech-tenant") ?? "",
        request.method,
      ),
  });
}

it("does not expose write-target choices to a read-only Interview member", async () => {
  const targets = vi.spyOn(engine, "profiles");
  try {
    const response = await app(ownerId, ["interview.read"]).request(
      `${url}/context`,
      { headers },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).targets).toEqual([]);
    expect(targets).not.toHaveBeenCalled();
  } finally {
    targets.mockRestore();
  }
});
const url = "http://studio.test/api/interview/documents";
const headers = { "x-omnitech-tenant": "local" };
const post = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`GRANT USAGE ON SCHEMA platform, interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, interview TO fixture_member;`);
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants(slug,name) VALUES ('local','Local') RETURNING id",
  );
  tenantId = tenant.rows[0]!.id;
  const owner = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users(email,display_name) VALUES ('owner@example.invalid','Owner') RETURNING id",
  );
  const other = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users(email,display_name) VALUES ('other@example.invalid','Other') RETURNING id",
  );
  ownerId = owner.rows[0]!.id;
  otherId = other.rows[0]!.id;
  for (const id of [ownerId, otherId])
    await pg.owner.query(
      "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [tenantId, id],
    );
  await pg.owner.query(
    `INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision)
    VALUES($1,$2,'omnitech.interview','profile','My profile',1)`,
    [tenantId, ownerId],
  );
  const matrix = { candidate: { name: "Ada" }, roles: [] };
  const digest = createHash("sha256")
    .update(JSON.stringify(matrix))
    .digest("hex");
  await pg.owner.query(
    `INSERT INTO interview.candidate_profile_revisions
    (tenant_id,actor_id,product_id,id,revision,name,sha256,matrix)
    VALUES($1,$2,'omnitech.interview','profile',1,'My profile',$3,$4::jsonb)`,
    [tenantId, ownerId, digest, JSON.stringify(matrix)],
  );
  database = createPlatformDatabase(pg.memberUrl);
}, 60_000);
afterAll(async () => {
  await database?.close();
  await pg?.stop();
});

describe("Documents private API", () => {
  it("inspects placeholders before upload and saves reviewed field constraints", async () => {
    const mine = app(ownerId);
    const intake = new FormData();
    intake.set("format", "md");
    intake.set("file", new File(["# {name}\n"], "review.md"));
    const inspected = await mine.request(`${url}/templates/intake`, {
      method: "POST",
      headers,
      body: intake,
    });
    expect(inspected.status).toBe(200);
    const fields = (
      (await inspected.json()) as {
        fields: Array<{
          key: string;
          required: boolean;
          maxLength: number | null;
        }>;
      }
    ).fields;
    expect(fields.map((field) => field.key)).toEqual(["name"]);
    const form = new FormData();
    form.set("name", "Reviewed template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set(
      "fields",
      JSON.stringify([{ ...fields[0], required: false, maxLength: 40 }]),
    );
    form.set("file", new File(["# {name}\n"], "review.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const detail = await mine.request(`${url}/templates/${templateId}`, {
      headers,
    });
    expect(
      ((await detail.json()) as { fields: unknown[] }).fields,
    ).toMatchObject([{ key: "name", required: false, maxLength: 40 }]);
  });

  it("requires the narrow write permission and same-origin mutation", async () => {
    const writableContext = await app(ownerId).request(`${url}/context`, {
      headers,
    });
    const writableBody = (await writableContext.json()) as {
      targets: Array<{ id: string }>;
      profiles: Array<{ revision: unknown }>;
    };
    // A named model profile and the agent write documents; a catalogue's
    // model is the assistant picker's, never a document's.
    expect(writableBody.targets).toEqual([
      { id: "test-model", label: "Test model", kind: "model" },
      {
        id: "agent/claude-code",
        label: "Claude Code",
        kind: "agent",
      },
    ]);
    expect(writableBody.profiles[0]?.revision).toBe(1);
    expect(typeof writableBody.profiles[0]?.revision).toBe("number");
    const readOnly = app(ownerId, ["interview.read"]);
    const templates = await readOnly.request(`${url}/templates`, { headers });
    expect(templates.status).toBe(200);
    expect(
      (
        (await templates.json()) as {
          templates: Array<{ template: { ownerUserId: string | null } }>;
        }
      ).templates.filter((row) => row.template.ownerUserId === null),
    ).toHaveLength(3);
    expect((await readOnly.request(url, { headers })).status).toBe(200);
    expect((await readOnly.request(url, post({}))).status).toBe(401);
    expect(
      (
        await app(ownerId).request(
          url,
          post({}, { origin: "https://attacker.invalid" }),
        )
      ).status,
    ).toBe(403);
    expect((await app(ownerId).request(url)).status).toBe(401);
  });

  it("lets only the candidacy owner save a job description for document generation", async () => {
    const company = await pg.owner.query<{ id: string }>(
      "INSERT INTO interview.companies(tenant_id,name) VALUES($1,'Northwind') RETURNING id",
      [tenantId],
    );
    const person = await pg.owner.query<{ id: string }>(
      "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,'Owner') RETURNING id",
      [tenantId],
    );
    await pg.owner.query(
      "INSERT INTO interview.member_people(tenant_id,user_id,person_id) VALUES($1,$2,$3)",
      [tenantId, ownerId, person.rows[0]!.id],
    );
    const candidacy = await pg.owner.query<{ id: string }>(
      "INSERT INTO interview.candidacies(tenant_id,company_id,candidate_person_id,title) VALUES($1,$2,$3,'Engineer') RETURNING id",
      [tenantId, company.rows[0]!.id, person.rows[0]!.id],
    );
    const path = `${url}/candidacies/${candidacy.rows[0]!.id}/job-description`;
    const body = { jobDescription: "Build reliable systems" };
    const readOnly = await app(ownerId, ["interview.read"]).request(path, {
      ...post(body),
      method: "PATCH",
    });
    expect(readOnly.status).toBe(401);
    const other = await app(otherId).request(path, {
      ...post(body),
      method: "PATCH",
    });
    expect(other.status).toBe(404);
    const mine = await app(ownerId).request(path, {
      ...post(body),
      method: "PATCH",
    });
    expect(mine.status, await mine.clone().text()).toBe(200);
    expect(await mine.json()).toEqual(body);
    const context = await app(ownerId).request(`${url}/context`, { headers });
    expect(
      (
        (await context.json()) as {
          candidacies: Array<{ job_description: string }>;
        }
      ).candidacies,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ job_description: body.jobDescription }),
      ]),
    );
  });

  it("persists uploaded template, one generated revision, edit, preview and stored export for the owner", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Resume");
    form.set("kind", "resume");
    form.set("format", "md");
    form.set("instructions", "Use only the candidate profile");
    form.set(
      "file",
      new File(["# {about}\n"], "resume.md", { type: "text/markdown" }),
    );
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const template = (await uploaded.json()) as {
      template: { id: string };
      revision: { revision: number };
    };
    expect(
      documentCreateSchema.safeParse({
        title: "General resume",
        templateId: template.template.id,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      }).success,
    ).toBe(true);
    const generated = await mine.request(
      url,
      post({
        title: "General resume",
        templateId: template.template.id,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(generated.status, await generated.clone().text()).toBe(201);
    const result = (await generated.json()) as {
      document: { id: string };
      revision: { values: Record<string, string> };
    };
    expect(result.revision.values["about"]).toBe("Evidence");
    expect(output).toHaveLength(1);
    expect((output[0] as Asked).profileId).toBe("test-model");
    const duplicate = await mine.request(
      url,
      post({
        title: "General resume",
        templateId: template.template.id,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(
      ((await duplicate.json()) as { existingDocumentId: string })
        .existingDocumentId,
    ).toBe(result.document.id);
    expect(output).toHaveLength(1);
    const edit = await mine.request(
      `${url}/${result.document.id}/revisions`,
      post({ baseRevision: 1, values: { about: "Ada Lovelace" } }),
    );
    expect(edit.status).toBe(201);
    const preview = await mine.request(
      `${url}/${result.document.id}/preview?revision=2`,
      { headers },
    );
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { html: string }).html).toContain(
      "Ada Lovelace",
    );
    const exported = await mine.request(
      `${url}/${result.document.id}/exports`,
      post({ revision: 2, format: "md" }),
    );
    expect(exported.status).toBe(201);
    const exportId = ((await exported.json()) as { id: string }).id;
    const download = await mine.request(
      `${url}/${result.document.id}/exports/${exportId}/download`,
      { headers },
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("Ada Lovelace");
    expect(
      (await app(otherId).request(`${url}/${result.document.id}`, { headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await app(otherId).request(
          `${url}/${result.document.id}/exports/${exportId}/download`,
          { headers },
        )
      ).status,
    ).toBe(404);
  }, 30_000);

  it("uses a built-in DOCX template, edits missing fields, and reopens the exported ZIP", async () => {
    const mine = app(ownerId);
    const catalog = await mine.request(`${url}/templates`, { headers });
    expect(catalog.status).toBe(200);
    const rows = (
      (await catalog.json()) as {
        templates: Array<{
          template: { id: string; kind: string };
          latestRevision: number;
        }>;
      }
    ).templates;
    const resume = rows.find((row) => row.template.kind === "resume");
    expect(resume).toBeDefined();
    const created = await mine.request(
      url,
      post({
        title: "General built-in resume",
        templateId: resume!.template.id,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const item = (await created.json()) as {
      document: { id: string };
      revision: { values: Record<string, string> };
    };
    const incompleteMarkdown = await mine.request(
      `${url}/${item.document.id}/exports`,
      post({ revision: 1, format: "md" }),
    );
    expect(incompleteMarkdown.status).toBe(201);
    const incomplete = (await incompleteMarkdown.json()) as {
      id: string;
      warnings: unknown[];
    };
    expect(incomplete.warnings.length).toBeGreaterThan(0);
    const incompleteDownload = await mine.request(
      `${url}/${item.document.id}/exports/${incomplete.id}/download`,
      { headers },
    );
    expect(incompleteDownload.status).toBe(200);
    const incompleteText = await incompleteDownload.text();
    expect(incompleteText).toContain("DRAFT — Unverified candidate content");
    expect(incompleteText).not.toContain("[[MISSING_DATA]]");
    expect(incompleteText).not.toContain("{emailAddress}");
    const incompleteDocx = await mine.request(
      `${url}/${item.document.id}/exports`,
      post({ revision: 1, format: "docx" }),
    );
    expect(incompleteDocx.status).toBe(201);
    const incompleteDocxId = ((await incompleteDocx.json()) as { id: string })
      .id;
    const incompleteZipResponse = await mine.request(
      `${url}/${item.document.id}/exports/${incompleteDocxId}/download`,
      { headers },
    );
    const incompleteZip = await JSZip.loadAsync(
      await incompleteZipResponse.arrayBuffer(),
    );
    expect(
      await incompleteZip.file("word/document.xml")?.async("string"),
    ).not.toContain("[[MISSING_DATA]]");
    expect(
      await incompleteZip.file("word/document.xml")?.async("string"),
    ).toContain("DRAFT — Unverified candidate content");
    const callsBeforeRegeneration = output.length;
    const regenerated = await mine.request(
      `${url}/${item.document.id}/regenerate`,
      post({ baseRevision: 1, mode: "all", aiTargetId: "test-model" }),
    );
    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    expect(output).toHaveLength(callsBeforeRegeneration + 1);
    expect((output.at(-1) as Asked).profileId).toBe("test-model");
    const values = Object.fromEntries(
      Object.keys(item.revision.values).map((key) => [key, "Evidence"]),
    );
    const edited = await mine.request(
      `${url}/${item.document.id}/revisions`,
      post({ baseRevision: 2, values }),
    );
    expect(edited.status, await edited.clone().text()).toBe(201);
    const exportResponse = await mine.request(
      `${url}/${item.document.id}/exports`,
      post({ revision: 3, format: "docx" }),
    );
    expect(exportResponse.status, await exportResponse.clone().text()).toBe(
      201,
    );
    const exportId = ((await exportResponse.json()) as { id: string }).id;
    const download = await mine.request(
      `${url}/${item.document.id}/exports/${exportId}/download`,
      { headers },
    );
    expect(download.status).toBe(200);
    const zip = await JSZip.loadAsync(await download.arrayBuffer());
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain("Evidence");
    expect(xml).not.toContain("{fullName}");
    const markdownExport = await mine.request(
      `${url}/${item.document.id}/exports`,
      post({ revision: 3, format: "md" }),
    );
    expect(markdownExport.status).toBe(201);
    const markdownId = ((await markdownExport.json()) as { id: string }).id;
    const markdownDownload = await mine.request(
      `${url}/${item.document.id}/exports/${markdownId}/download`,
      { headers },
    );
    expect(markdownDownload.status).toBe(200);
    expect(await markdownDownload.text()).toContain("Evidence");
  }, 30_000);

  // Every way the product can reach a model goes through the engine, so a
  // document made by hand must leave each of its methods uncalled.
  function watchEngine() {
    const methods = engine as unknown as Record<string, unknown>;
    const spies = Object.keys(methods)
      .filter((name) => typeof methods[name] === "function")
      .map((name) => vi.spyOn(methods as Record<string, () => unknown>, name));
    expect(spies.length).toBeGreaterThan(0);
    return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  }
  async function uploadMarkdown(
    mine: ReturnType<typeof app>,
    name: string,
    body: string,
    fields?: unknown[],
  ) {
    const form = new FormData();
    form.set("name", name);
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "Use only the candidate profile");
    form.set("file", new File([body], "template.md"));
    if (fields) form.set("fields", JSON.stringify(fields));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    return ((await uploaded.json()) as { template: { id: string } }).template
      .id;
  }

  it("creates a document manually with no model call: sources filled in, the rest blank, editable by hand", async () => {
    const mine = app(ownerId);
    const candidacy = await mine.request(
      `${url}/candidacies`,
      post({
        companyName: "Manual Co",
        title: "Staff Engineer",
        jobDescription: "Hand-written role",
      }),
    );
    expect(candidacy.status).toBe(201);
    const candidacyId = ((await candidacy.json()) as { candidacyId: string })
      .candidacyId;
    const templateId = await uploadMarkdown(
      mine,
      "Manual template",
      "# {full_name}\n{company_name} · {role_title}\n{job_description}\n{email}\n{summary}\n{highlights}\n",
    );
    const selection = {
      title: "Manual resume",
      templateId,
      templateRevision: 1,
      profileId: "profile",
      profileRevision: 1,
      candidacyId,
      interviewId: null,
    };
    const asked = output.length;
    const engineCalls = watchEngine();

    const created = await mine.request(
      url,
      // A browser that asks for a stream still gets one plain answer: there
      // is nothing to watch being written.
      post(
        { ...selection, mode: "manual" },
        { accept: "application/x-ndjson" },
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    expect(created.headers.get("content-type")).toContain("application/json");
    const made = (await created.json()) as {
      document: { id: string; status: string; currentRevision: number };
      revision: {
        values: Record<string, string>;
        provenance: Record<string, unknown>;
        validation: Array<{ key: string; code: string }>;
        aiUsage: unknown;
      };
      errors: Array<{ key: string; code: string }>;
    };
    // The application and the matrix's own facts are filled in; what only
    // prose can fill, and a contact detail the matrix lacks, are left blank.
    expect(made.revision.values).toEqual({
      full_name: "Ada",
      company_name: "Manual Co",
      role_title: "Staff Engineer",
      job_description: "Hand-written role",
      email: "",
      summary: "",
      highlights: "",
    });
    // An honest state: blank required fields keep it at "Needs attention".
    expect(made.document.status).toBe("invalid");
    expect(made.document.currentRevision).toBe(1);
    const missing = [
      { key: "email", code: "missing" },
      { key: "summary", code: "missing" },
      { key: "highlights", code: "missing" },
    ];
    expect(made.errors).toEqual(missing);
    expect(made.revision.validation).toEqual(missing);
    expect(made.revision.aiUsage).toBeNull();
    expect(made.revision.provenance).toMatchObject({
      kind: "manual",
      modelOwnedKeys: ["summary", "highlights"],
      claimState: "unverified",
    });
    expect(made.revision.provenance).not.toHaveProperty("targetId");
    expect(made.revision.provenance["sourceDigest"]).toMatch(/^[a-f0-9]{64}$/);

    // It opens like any document: listed, loaded with its fields, drawn.
    const list = (await (await mine.request(url, { headers })).json()) as {
      documents: Array<{ id: string; status: string; title: string }>;
    };
    expect(
      list.documents.find((item) => item.id === made.document.id),
    ).toMatchObject({ status: "invalid", title: "Manual resume" });
    const opened = await mine.request(`${url}/${made.document.id}`, {
      headers,
    });
    expect(opened.status).toBe(200);
    expect(
      ((await opened.json()) as { fields: Array<{ key: string }> }).fields.map(
        (field) => field.key,
      ),
    ).toEqual([
      "full_name",
      "company_name",
      "role_title",
      "job_description",
      "email",
      "summary",
      "highlights",
    ]);
    const preview = await mine.request(
      `${url}/${made.document.id}/preview?revision=1`,
      { headers },
    );
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { html: string }).html).toContain(
      "Manual Co",
    );
    // The same selection is one document: a second manual create is pointed
    // at the first.
    const duplicate = await mine.request(
      url,
      post({ ...selection, mode: "manual" }),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      existingDocumentId: made.document.id,
      offer: "open-it",
    });
    // What the application states is not the person's to retype.
    const overwritten = await mine.request(
      `${url}/${made.document.id}/revisions`,
      post({
        baseRevision: 1,
        values: { ...made.revision.values, company_name: "Another Co" },
      }),
    );
    expect(overwritten.status).toBe(400);
    // The fields are written by hand and saved as an ordinary edit.
    const byHand = {
      ...made.revision.values,
      email: "ada@example.invalid",
      summary: "Written by hand",
      highlights: "Also by hand",
    };
    const edited = await mine.request(
      `${url}/${made.document.id}/revisions`,
      post({ baseRevision: 1, values: byHand }),
    );
    expect(edited.status, await edited.clone().text()).toBe(201);
    const reopened = (await (
      await mine.request(`${url}/${made.document.id}`, { headers })
    ).json()) as {
      document: { status: string; currentRevision: number };
      revision: {
        values: Record<string, string>;
        provenance: Record<string, unknown>;
      };
    };
    expect(reopened.document).toMatchObject({
      status: "ready",
      currentRevision: 2,
    });
    expect(reopened.revision.values).toEqual(byHand);
    expect(reopened.revision.provenance).toMatchObject({
      kind: "edited",
      modelOwnedKeys: ["summary", "highlights"],
    });
    // Hand-written content is still the candidate's to confirm before export.
    const exported = await mine.request(
      `${url}/${made.document.id}/exports`,
      post({ revision: 2, format: "md" }),
    );
    expect(exported.status).toBe(201);
    const download = await mine.request(
      `${url}/${made.document.id}/exports/${((await exported.json()) as { id: string }).id}/download`,
      { headers },
    );
    const text = await download.text();
    expect(text).toContain("Written by hand");
    expect(text).toContain("DRAFT — Unverified candidate content");

    // Creating, opening, drawing, editing and exporting asked no model.
    expect(output).toHaveLength(asked);
    expect(engineCalls()).toBe(0);
    // Nobody else can open it.
    expect(
      (await app(otherId).request(`${url}/${made.document.id}`, { headers }))
        .status,
    ).toBe(404);

    // Generating the same selection is pointed at it too, before any writing.
    const generatedAgain = await mine.request(
      url,
      post({ ...selection, aiTargetId: "test-model" }),
    );
    expect(generatedAgain.status).toBe(409);
    expect(await generatedAgain.json()).toMatchObject({
      existingDocumentId: made.document.id,
    });
    expect(output).toHaveLength(asked);
    // A model can still be asked for one field later, from the editor.
    const regenerated = await mine.request(
      `${url}/${made.document.id}/regenerate`,
      post({ baseRevision: 2, fieldKey: "summary", aiTargetId: "test-model" }),
    );
    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    expect(output).toHaveLength(asked + 1);
    expect((await regenerated.json()).values).toMatchObject({
      summary: "Evidence",
      highlights: "Also by hand",
    });
  }, 30_000);

  it("creates manually without a model being available, and for the general case with only the matrix", async () => {
    // No write target exists for this member's engine view, so nothing could
    // be generated; a document made by hand needs none.
    const templateId = await uploadMarkdown(
      app(ownerId),
      "Manual general template",
      "{name}\n{company_name}\n{interview_stage}\n{about}\n{notes}\n",
      [
        {
          key: "name",
          label: "Name",
          source: "candidate-profile",
          required: true,
          maxLength: null,
        },
        {
          key: "company_name",
          label: "Company name",
          source: "candidacy",
          required: false,
          maxLength: null,
        },
        {
          key: "interview_stage",
          label: "Interview stage",
          source: "interview",
          required: false,
          maxLength: null,
        },
        {
          key: "about",
          label: "About",
          source: "candidate-profile",
          required: true,
          maxLength: 40,
        },
        {
          key: "notes",
          label: "Notes",
          source: "manual",
          required: false,
          maxLength: null,
        },
      ],
    );
    const asked = output.length;
    const engineCalls = watchEngine();
    const created = await app(ownerId).request(
      url,
      post({
        title: "Manual general",
        templateId,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        mode: "manual",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const made = (await created.json()) as {
      document: { id: string; status: string };
      revision: {
        values: Record<string, string>;
        provenance: { modelOwnedKeys: string[] };
      };
      errors: unknown[];
    };
    // With no application there is nothing to copy: only the matrix's name.
    expect(made.revision.values).toEqual({
      name: "Ada",
      company_name: "",
      interview_stage: "",
      about: "",
      notes: "",
    });
    expect(made.revision.provenance.modelOwnedKeys).toEqual(["about"]);
    expect(made.errors).toEqual([{ key: "about", code: "missing" }]);
    expect(made.document.status).toBe("invalid");
    // The template's own limits apply to what is typed by hand.
    const tooLong = await app(ownerId).request(
      `${url}/${made.document.id}/preview`,
      post({
        baseRevision: 1,
        values: { ...made.revision.values, about: "A".repeat(41) },
      }),
    );
    expect(tooLong.status).toBe(200);
    expect(
      ((await tooLong.json()) as { validation: unknown[] }).validation,
    ).toEqual([{ key: "about", code: "too-long" }]);
    expect(output).toHaveLength(asked);
    expect(engineCalls()).toBe(0);
  }, 30_000);

  it("refuses a manual create that is not exactly one, or not the member's to make", async () => {
    const mine = app(ownerId);
    const templateId = await uploadMarkdown(
      mine,
      "Manual refusals",
      "{about}\n",
    );
    const selection = {
      title: "Refused manual",
      templateId,
      templateRevision: 1,
      profileId: "profile",
      profileRevision: 1,
      candidacyId: null,
      interviewId: null,
    };
    const asked = output.length;
    const engineCalls = watchEngine();
    for (const body of [
      selection,
      { ...selection, mode: "manual", aiTargetId: "test-model" },
      { ...selection, mode: "ai" },
      { ...selection, mode: "manual", values: { about: "Typed" } },
    ]) {
      const refused = await mine.request(url, post(body));
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe("invalid-request");
    }
    // Unknown template, unknown experience revision, another member's
    // template, and a member who may only read.
    expect(
      (
        await mine.request(
          url,
          post({ ...selection, templateId: randomUUID(), mode: "manual" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mine.request(
          url,
          post({ ...selection, profileRevision: 99, mode: "manual" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await app(otherId).request(url, post({ ...selection, mode: "manual" })))
        .status,
    ).toBe(404);
    expect(
      (
        await app(ownerId, ["interview.read"]).request(
          url,
          post({ ...selection, mode: "manual" }),
        )
      ).status,
    ).toBe(401);
    const list = (await (await mine.request(url, { headers })).json()) as {
      documents: Array<{ title: string }>;
    };
    expect(list.documents.some((item) => item.title === "Refused manual")).toBe(
      false,
    );
    expect(output).toHaveLength(asked);
    expect(engineCalls()).toBe(0);
  }, 30_000);

  it("refuses an oversized upload without a content-length header", async () => {
    const form = new FormData();
    form.set("name", "Too large");
    form.set("kind", "resume");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File([new Uint8Array(6 * 1024 * 1024)], "large.md"));
    const response = await app(ownerId).request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(response.status).toBe(413);
  });

  it("regenerates only one field into a new immutable revision", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Two fields");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "Use profile evidence");
    form.set("file", new File(["{summary} {phone}\n"], "two-fields.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const created = await mine.request(
      url,
      post({
        title: "Targeted document",
        templateId,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const documentId = ((await created.json()) as { document: { id: string } })
      .document.id;
    const edited = await mine.request(
      `${url}/${documentId}/revisions`,
      post({
        baseRevision: 1,
        values: { summary: "Manual", phone: "Private manual value" },
      }),
    );
    expect(edited.status, await edited.clone().text()).toBe(201);
    const directField = await mine.request(
      `${url}/${documentId}/regenerate`,
      post({ baseRevision: 2, fieldKey: "phone", aiTargetId: "test-model" }),
    );
    expect(directField.status).toBe(400);
    const regenerated = await mine.request(
      `${url}/${documentId}/regenerate`,
      post({ baseRevision: 2, fieldKey: "summary", aiTargetId: "test-model" }),
    );
    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    // The model is told what the field holds now, so it keeps its kind and length.
    const sent = JSON.parse((output.at(-1) as Asked).prompt) as {
      fields: Array<{ key: string; currentValue?: string }>;
    };
    expect(sent.fields).toEqual([
      expect.objectContaining({ key: "summary", currentValue: "Manual" }),
    ]);
    const current = await mine.request(`${url}/${documentId}`, { headers });
    const latest = (await current.json()) as {
      revision: {
        revision: number;
        values: Record<string, string>;
        provenance: { kind: string; fieldKeys: string[] };
      };
    };
    expect(latest.revision).toMatchObject({
      revision: 3,
      values: { summary: "Evidence", phone: "Private manual value" },
      provenance: { kind: "regenerated", fieldKeys: ["summary"] },
    });
    const previous = await mine.request(`${url}/${documentId}?revision=2`, {
      headers,
    });
    expect(((await previous.json()) as typeof latest).revision.values).toEqual({
      summary: "Manual",
      phone: "Private manual value",
    });
  });

  it("replays a keyed generation and labels exports until the candidate confirms that revision", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Retry and review");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["# {summary}\n"], "retry.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const body = {
      title: "Keyed document",
      templateId,
      templateRevision: 1,
      profileId: "profile",
      profileRevision: 1,
      candidacyId: null,
      interviewId: null,
      aiTargetId: "test-model",
    };
    const request = () => post(body, { "idempotency-key": "retry-review-1" });
    const callsBefore = output.length;
    const created = await mine.request(url, request());
    expect(created.status, await created.clone().text()).toBe(201);
    const first = (await created.json()) as {
      document: { id: string };
      revision: { provenance: { sourceDigest: string; claimState: string } };
    };
    expect(first.revision.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.revision.provenance.claimState).toBe("unverified");
    const targets = vi.spyOn(engine, "profiles").mockResolvedValue([]);
    let replay: Response;
    try {
      replay = await mine.request(url, request());
    } finally {
      targets.mockRestore();
    }
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(output.length).toBe(callsBefore + 1);
    expect(
      (
        await mine.request(
          url,
          post(
            { ...body, title: "Different title" },
            {
              "idempotency-key": "retry-review-1",
            },
          ),
        )
      ).status,
    ).toBe(409);

    const draftExport = await mine.request(
      `${url}/${first.document.id}/exports`,
      post({ revision: 1, format: "md" }),
    );
    const draftRow = (await draftExport.json()) as {
      id: string;
      draft: boolean;
    };
    expect(draftRow.draft).toBe(true);
    const draftId = draftRow.id;
    expect(
      await (
        await mine.request(
          `${url}/${first.document.id}/exports/${draftId}/download`,
          { headers },
        )
      ).text(),
    ).toContain("DRAFT — Unverified candidate content");

    const confirmed = await mine.request(
      `${url}/${first.document.id}/confirm`,
      post({ baseRevision: 1 }),
    );
    expect(confirmed.status).toBe(201);
    expect((await confirmed.json()).provenance.claimState).toBe("confirmed");
    const finalExport = await mine.request(
      `${url}/${first.document.id}/exports`,
      post({ revision: 2, format: "md" }),
    );
    const finalRow = (await finalExport.json()) as {
      id: string;
      draft: boolean;
    };
    expect(finalRow.draft).toBe(false);
    expect(
      await (
        await mine.request(
          `${url}/${first.document.id}/exports/${finalRow.id}/download`,
          { headers },
        )
      ).text(),
    ).not.toContain("DRAFT");
    const refreshed = await mine.request(
      `${url}/${first.document.id}/refresh-sources`,
      post({ baseRevision: 2 }),
    );
    expect(refreshed.status).toBe(201);
    expect((await refreshed.json()).provenance.claimState).toBe("unverified");
  });

  it("refuses targeted regeneration after approved source facts change until refresh", async () => {
    const mine = app(ownerId);
    const candidacy = await mine.request(
      `${url}/candidacies`,
      post({
        companyName: "Source Check",
        title: "Engineer",
        jobDescription: "Original role",
      }),
    );
    expect(candidacy.status).toBe(201);
    const candidacyId = ((await candidacy.json()) as { candidacyId: string })
      .candidacyId;
    const form = new FormData();
    form.set("name", "Source check");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{job_description}\n{summary}\n"], "source.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const created = await mine.request(
      url,
      post({
        title: "Source-bound document",
        templateId,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const documentId = ((await created.json()) as { document: { id: string } })
      .document.id;
    const changed = await mine.request(
      `${url}/candidacies/${candidacyId}/job-description`,
      { ...post({ jobDescription: "Updated role" }), method: "PATCH" },
    );
    expect(changed.status).toBe(200);
    const stale = await mine.request(
      `${url}/${documentId}/regenerate`,
      post({ baseRevision: 1, fieldKey: "summary", aiTargetId: "test-model" }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("source-refresh-required");
    const refreshed = await mine.request(
      `${url}/${documentId}/refresh-sources`,
      post({ baseRevision: 1 }),
    );
    expect(refreshed.status).toBe(201);
    expect(await refreshed.json()).toMatchObject({
      values: { job_description: "Updated role" },
      provenance: { modelOwnedKeys: ["summary"] },
    });
    const regenerated = await mine.request(
      `${url}/${documentId}/regenerate`,
      post({ baseRevision: 2, fieldKey: "summary", aiTargetId: "test-model" }),
    );
    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    expect((await regenerated.json()).values).toMatchObject({
      job_description: "Updated role",
    });
  });

  it("leaves no document when first generation is cancelled", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Cancellation template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{about}"], "cancel.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const controller = new AbortController();
    const entered = new Promise<void>((resolve) => {
      enteredGeneration = resolve;
    });
    waitForAbort = true;
    try {
      const pending = mine.request(url, {
        ...post({
          title: "Cancelled first generation",
          templateId,
          templateRevision: 1,
          profileId: "profile",
          profileRevision: 1,
          candidacyId: null,
          interviewId: null,
          aiTargetId: "test-model",
        }),
        signal: controller.signal,
      });
      await entered;
      controller.abort();
      expect((await pending).status).toBe(409);
      const documents = await mine.request(url, { headers });
      const rows = (
        (await documents.json()) as { documents: Array<{ title: string }> }
      ).documents;
      expect(
        rows.some((item) => item.title === "Cancelled first generation"),
      ).toBe(false);
    } finally {
      waitForAbort = false;
      enteredGeneration = null;
    }
  }, 30_000);

  it("stops writing and saves nothing when the page reading the stream goes away", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Reload template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{about}"], "reload.md"));
    const templateId = (
      (await (
        await mine.request(`${url}/templates`, {
          method: "POST",
          headers,
          body: form,
        })
      ).json()) as { template: { id: string } }
    ).template.id;
    const entered = new Promise<void>((resolve) => {
      enteredGeneration = resolve;
    });
    waitForAbort = true;
    try {
      const response = await mine.request(
        url,
        post(
          {
            title: "Abandoned by a reload",
            templateId,
            templateRevision: 1,
            profileId: "profile",
            profileRevision: 1,
            candidacyId: null,
            interviewId: null,
            aiTargetId: "test-model",
          },
          { accept: "application/x-ndjson" },
        ),
      );
      expect(response.status).toBe(200);
      await entered;
      const call = output.at(-1) as { signal?: AbortSignal } | undefined;
      expect(call?.signal?.aborted).toBe(false);
      // A reload closes the connection: the reader cancels the stream.
      await response.body?.cancel();
      await vi.waitFor(() => expect(call?.signal?.aborted).toBe(true));
      const rows = (
        (await (await mine.request(url, { headers })).json()) as {
          documents: Array<{ title: string }>;
        }
      ).documents;
      expect(rows.some((item) => item.title === "Abandoned by a reload")).toBe(
        false,
      );
    } finally {
      waitForAbort = false;
      enteredGeneration = null;
    }
  }, 30_000);

  it("tells a second window a document is already being written, and offers the saved one afterwards", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Concurrent template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{about}"], "concurrent.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    let release!: () => void;
    const arrived = () => undefined;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    concurrentGate = { entered: 0, arrived, release: releasePromise };
    try {
      const input = {
        title: "Concurrent document",
        templateId,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        aiTargetId: "test-model",
      };
      const first = mine.request(url, post(input));
      await vi.waitFor(() => expect(concurrentGate?.entered).toBe(1));
      // Another window asks for the same document while it is being written.
      const second = await mine.request(url, post(input));
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ inProgress: true, offer: "wait" });
      // It did not start a second, paid-for generation.
      expect(concurrentGate?.entered).toBe(1);
      release();
      const winner = await first;
      expect(winner.status).toBe(201);
      const winnerId = ((await winner.json()) as { document: { id: string } })
        .document.id;
      // Once saved, the same request is offered the saved document.
      const third = await mine.request(url, post(input));
      expect(third.status).toBe(409);
      expect(
        (await third.json()) as { existingDocumentId: string; offer: string },
      ).toMatchObject({ existingDocumentId: winnerId, offer: "open-it" });
      const listed = await mine.request(url, { headers });
      const rows = (
        (await listed.json()) as { documents: Array<{ title: string }> }
      ).documents;
      expect(
        rows.filter((row) => row.title === "Concurrent document"),
      ).toHaveLength(1);
    } finally {
      release();
      concurrentGate = null;
    }
  }, 30_000);

  it("rolls back source and export bytes when their owning write fails", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Atomic template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{name}"], "atomic.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const count = async (type: string) =>
      Number(
        (
          await pg.owner.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM platform.artifacts WHERE tenant_id=$1 AND owner_user_id=$2 AND artifact_type=$3",
            [tenantId, ownerId, type],
          )
        ).rows[0]!.n,
      );
    const sourceBefore = await count("interview.document-template-source");
    const stale = new FormData();
    stale.set("expectedRevision", "2");
    stale.set("instructions", "");
    stale.set("file", new File(["{name}"], "stale.md"));
    const staleResponse = await mine.request(
      `${url}/templates/${templateId}/revisions`,
      {
        method: "POST",
        headers,
        body: stale,
      },
    );
    expect(staleResponse.status).toBe(409);
    expect(await count("interview.document-template-source")).toBe(
      sourceBefore,
    );
    const duplicate = await mine.request(
      `${url}/templates/${randomUUID()}/duplicate`,
      post({ name: "Missing" }),
    );
    expect(duplicate.status).toBe(404);
    expect(await count("interview.document-template-source")).toBe(
      sourceBefore,
    );
    const exportBefore = await count("interview.document-export");
    const repository = new InterviewDocumentRepository(database);
    await expect(
      repository.recordExport(
        { tenantId, actorId: ownerId },
        {
          documentId: randomUUID(),
          revision: 1,
          format: "md",
          title: "Orphan check",
          bytes: Buffer.from("Orphan check"),
        },
      ),
    ).rejects.toThrow();
    expect(await count("interview.document-export")).toBe(exportBefore);
  }, 30_000);

  it("streams the plan, each section and the saved document while a document is written", async () => {
    const mine = app(ownerId);
    const rows = (
      (await (await mine.request(`${url}/templates`, { headers })).json()) as {
        templates: Array<{ template: { id: string; kind: string } }>;
      }
    ).templates;
    const cover = rows.find((row) => row.template.kind === "cover_letter");
    const response = await mine.request(
      url,
      post(
        {
          title: "Streamed cover letter",
          templateId: cover!.template.id,
          templateRevision: 1,
          profileId: "profile",
          profileRevision: 1,
          candidacyId: null,
          interviewId: null,
          aiTargetId: "test-model",
        },
        { accept: "application/x-ndjson" },
      ),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-type")).toContain("x-ndjson");
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { t: string; [key: string]: unknown });
    expect(events.map((event) => event.t)).toEqual([
      "plan",
      ...events.filter((event) => event.t === "batch").map(() => "batch"),
      "done",
    ]);
    const plan = events[0] as unknown as {
      batches: Array<{ id: string; count: number }>;
      fixed: Record<string, string>;
    };
    expect(plan.batches.length).toBeGreaterThan(0);
    expect(events.filter((event) => event.t === "batch")).toHaveLength(
      plan.batches.length,
    );
    const done = events.at(-1) as unknown as { document: { id: string } };
    const saved = await mine.request(`${url}/${done.document.id}`, {
      headers,
    });
    expect(saved.status).toBe(200);
    // The same request, asked again, is answered before anything streams.
    const again = await mine.request(
      url,
      post(
        {
          title: "Streamed cover letter",
          templateId: cover!.template.id,
          templateRevision: 1,
          profileId: "profile",
          profileRevision: 1,
          candidacyId: null,
          interviewId: null,
          aiTargetId: "test-model",
        },
        { accept: "application/x-ndjson" },
      ),
    );
    expect(again.status).toBe(409);
  }, 30_000);

  it("draws a template with given values, for its owner or when it is built in", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Previewed template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["# Hello {name}"], "preview.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    const id = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const drawn = await mine.request(
      `${url}/templates/${id}/preview`,
      post({ revision: 1, values: { name: "Ada" } }),
    );
    expect(drawn.status).toBe(200);
    const body = (await drawn.json()) as { kind: string; html: string };
    expect(body.kind).toBe("html");
    expect(body.html).toContain('data-field="name"');
    expect(body.html).toContain("Ada");
    expect(
      (
        await app(otherId).request(
          `${url}/templates/${id}/preview`,
          post({ revision: 1, values: {} }),
        )
      ).status,
    ).toBe(404);
    const rows = (
      (await (await mine.request(`${url}/templates`, { headers })).json()) as {
        templates: Array<{ template: { id: string; kind: string } }>;
      }
    ).templates;
    const resume = rows.find((row) => row.template.kind === "resume");
    const docx = (await (
      await app(otherId).request(
        `${url}/templates/${resume!.template.id}/preview`,
        post({ revision: 1, values: {} }),
      )
    ).json()) as { kind: string; docx: string };
    expect(docx.kind).toBe("docx");
    expect(Buffer.from(docx.docx, "base64").subarray(0, 2).toString()).toBe(
      "PK",
    );
  }, 30_000);

  it("creates an application and its stages for the member, and only for them", async () => {
    const mine = app(ownerId);
    const created = await mine.request(
      `${url}/candidacies`,
      post({
        companyName: "Zensurance",
        title: "Tech Lead",
        jobDescription: "  Own payments.  ",
        interview: { kind: "hiring_manager", label: "Hiring manager" },
      }),
    );
    expect(created.status).toBe(201);
    const { candidacyId, interviewId } = (await created.json()) as {
      candidacyId: string;
      interviewId: string;
    };
    const again = (await (
      await mine.request(
        `${url}/candidacies`,
        post({ companyName: "zensurance", title: "Staff Engineer" }),
      )
    ).json()) as { candidacyId: string; interviewId: string | null };
    expect(again.interviewId).toBeNull();
    const stage = await mine.request(
      `${url}/candidacies/${candidacyId}/interviews`,
      post({ kind: "technical", label: "Technical" }),
    );
    expect(stage.status).toBe(201);
    const context = (await (
      await mine.request(`${url}/context`, { headers })
    ).json()) as {
      candidacies: Array<{
        id: string;
        company_name: string;
        job_description: string | null;
      }>;
      interviews: Array<{ id: string; candidacy_id: string; label: string }>;
    };
    expect(
      context.candidacies
        .filter((item) => [candidacyId, again.candidacyId].includes(item.id))
        .map((item) => [item.company_name, item.job_description]),
    ).toEqual(
      expect.arrayContaining([
        ["Zensurance", "Own payments."],
        ["Zensurance", null],
      ]),
    );
    expect(
      context.interviews
        .filter((item) => item.candidacy_id === candidacyId)
        .map((item) => item.label),
    ).toEqual(["Hiring manager", "Technical"]);
    expect(interviewId).toBeTruthy();
    const company = await pg.owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM interview.companies WHERE tenant_id=$1 AND lower(name)='zensurance'",
      [tenantId],
    );
    expect(company.rows[0]?.n).toBe("1");
    // Another member neither sees it nor can add stages to it.
    const theirs = app(otherId);
    expect(
      (
        (await (
          await theirs.request(`${url}/context`, { headers })
        ).json()) as {
          candidacies: Array<{ id: string }>;
        }
      ).candidacies.map((item) => item.id),
    ).not.toContain(candidacyId);
    expect(
      (
        await theirs.request(
          `${url}/candidacies/${candidacyId}/interviews`,
          post({ kind: "final", label: "Final" }),
        )
      ).status,
    ).toBe(404);
    const invalid = await mine.request(
      `${url}/candidacies`,
      post({ companyName: "", title: "x" }),
    );
    expect(invalid.status).toBe(400);
  }, 30_000);

  it("says why a template was refused, in fixed words that quote nothing from it", async () => {
    const mine = app(ownerId);
    const intake = new FormData();
    intake.set("format", "docx");
    intake.set("file", new File(["this is not a zip"], "broken.docx"));
    const response = await mine.request(`${url}/templates/intake`, {
      method: "POST",
      headers,
      body: intake,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; reason?: string };
    };
    expect(body.error.code).toBe("invalid-field-or-template");
    expect(body.error.reason).toMatch(/\w{8}/);
    expect(body.error.reason).not.toContain("this is not a zip");
  });

  it("saves edited instructions as a new revision over the same fields", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Instruction revision template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "First");
    form.set("file", new File(["{name}"], "instructions.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const stale = await mine.request(
      `${url}/templates/${templateId}/instructions`,
      post({ expectedRevision: 2, instructions: "Stale" }),
    );
    expect(stale.status).toBe(409);
    const saved = await mine.request(
      `${url}/templates/${templateId}/instructions`,
      post({ expectedRevision: 1, instructions: "Second" }),
    );
    expect(saved.status).toBe(201);
    const latest = (await (
      await mine.request(`${url}/templates/${templateId}`, { headers })
    ).json()) as {
      revision: { revision: number; instructions: string };
      fields: Array<{ key: string }>;
    };
    expect(latest.revision).toMatchObject({
      revision: 2,
      instructions: "Second",
    });
    expect(latest.fields.map((field) => field.key)).toEqual(["name"]);
    const foreign = await app(randomUUID()).request(
      `${url}/templates/${templateId}/instructions`,
      post({ expectedRevision: 2, instructions: "Not yours" }),
    );
    expect(foreign.status).toBe(404);
  }, 30_000);

  it("rolls back a first document save when the request aborts during its insert", async () => {
    const mine = app(ownerId);
    const form = new FormData();
    form.set("name", "Save cancellation template");
    form.set("kind", "custom");
    form.set("format", "md");
    form.set("instructions", "");
    form.set("file", new File(["{about}"], "save-cancel.md"));
    const uploaded = await mine.request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const revisionsBefore = Number(
      (
        await pg.owner.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM interview.document_revisions WHERE tenant_id=$1 AND owner_user_id=$2",
          [tenantId, ownerId],
        )
      ).rows[0]!.n,
    );
    let modelArrived!: () => void;
    let modelRelease!: () => void;
    let lockArrived!: () => void;
    let lockRelease!: () => void;
    const modelEntered = new Promise<void>((resolve) => {
      modelArrived = resolve;
    });
    const modelHold = new Promise<void>((resolve) => {
      modelRelease = resolve;
    });
    const lockEntered = new Promise<void>((resolve) => {
      lockArrived = resolve;
    });
    const lockHold = new Promise<void>((resolve) => {
      lockRelease = resolve;
    });
    saveGenerationGate = { entered: modelArrived, release: modelHold };
    const controller = new AbortController();
    try {
      const pending = mine.request(url, {
        ...post({
          title: "Cancelled during save",
          templateId,
          templateRevision: 1,
          profileId: "profile",
          profileRevision: 1,
          candidacyId: null,
          interviewId: null,
          aiTargetId: "test-model",
        }),
        signal: controller.signal,
      });
      await modelEntered;
      const locking = pg.owner.transaction(async (client) => {
        await client.query(
          "LOCK TABLE interview.documents IN ACCESS EXCLUSIVE MODE",
        );
        lockArrived();
        await lockHold;
      });
      await lockEntered;
      modelRelease();
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const row = await pg.owner.query<{
          n: number;
        }>(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE usename='fixture_member' AND wait_event_type='Lock' AND query LIKE '%interview%documents%'`);
        if ((row.rows[0]?.n ?? 0) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      controller.abort();
      lockRelease();
      await locking;
      expect((await pending).status).toBe(409);
      const listed = await mine.request(url, { headers });
      const rows = (
        (await listed.json()) as { documents: Array<{ title: string }> }
      ).documents;
      expect(rows.some((row) => row.title === "Cancelled during save")).toBe(
        false,
      );
      const revisionsAfter = Number(
        (
          await pg.owner.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM interview.document_revisions WHERE tenant_id=$1 AND owner_user_id=$2",
            [tenantId, ownerId],
          )
        ).rows[0]!.n,
      );
      expect(revisionsAfter).toBe(revisionsBefore);
    } finally {
      controller.abort();
      modelRelease();
      lockRelease();
      saveGenerationGate = null;
    }
  }, 30_000);
});
