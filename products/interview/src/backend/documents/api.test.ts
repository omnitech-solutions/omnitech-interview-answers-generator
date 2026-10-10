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
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDocumentsApi, resolveDocumentsScope } from "./api";
import { DEFAULT_DOCUMENTS_CONFIG } from "./config";
import {
  FULLSTACK_POSTING,
  resumeRunDocx,
  SYNTHETIC_MATRIX,
} from "./fixtures/resume-run";
import { InterviewDocumentRepository } from "./repository";
import { documentSourceDigest } from "./source-digest";

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
// A scripted model, for the tests that need the model to say particular
// things: it is given the keys it was asked for and the whole request.
type Scripted = {
  keys: string[];
  prompt: string;
  system: string;
};
let script: ((asked: Scripted) => unknown | Promise<unknown>) | null = null;
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
    if (script) {
      const schema = input.schema as { properties?: Record<string, unknown> };
      const said = (role: string) =>
        input.messages
          .filter((message) => message.role === role)
          .flatMap((message) =>
            message.parts.map((part) =>
              part.type === "text" ? part.text : "",
            ),
          )
          .join("");
      yield {
        type: "text",
        text: JSON.stringify(
          await script({
            keys: Object.keys(schema.properties ?? {}),
            prompt: said("user"),
            system: said("system"),
          }),
        ),
      };
      return;
    }
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
      // A hand edit that names something the matrix does not ("Lovelace")
      // is the person's to vouch for: "confirmed by me".
      post({
        baseRevision: 1,
        values: { about: "Ada Lovelace" },
        confirm: ["about"],
      }),
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
    // Counted from now: a method watched by an earlier test keeps its calls.
    const calls = () =>
      spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    const before = calls();
    return () => calls() - before;
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
        values: { ...made.revision.values, about: "a".repeat(41) },
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

// The real run of 2026-10-10 (bionic/briefs/BRIEF-document-generation-quality-
// and-ai-logging.md): two parallel calls, a model that put one employer's work
// under another's name and used an employer twice, empty contact details and
// an empty consultancy block. The fixture is that run's shape with a synthetic
// matrix; the model here still misbehaves, and it can no longer matter.
describe("a resume written under a cast and verified", () => {
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`
        : JSON.stringify(value);
  const CONTACT = {
    email: "rowan@example.invalid",
    phone: "555 0100",
    portfolio: "example.invalid/rowan",
  };
  const mine = () =>
    createDocumentsApi({
      database,
      engine,
      localContact: async () => CONTACT,
      // The fixture template is shorter than the real one; at this size per
      // call it is written in two calls, as the real one is.
      config: {
        ...DEFAULT_DOCUMENTS_CONFIG,
        generation: { maxCalls: 4, fieldsPerCall: 12, attempts: 2 },
      },
      resolveScope: async (request) =>
        resolveDocumentsScope(
          context(ownerId),
          request.headers.get("x-omnitech-tenant") ?? "",
          request.method,
        ),
    });
  type Issue = {
    key: string;
    code: string;
    against?: string;
    missing?: Array<{ text: string; kind: string; foundIn?: string }>;
  };
  type Saved = {
    document: { id: string; status: string; currentRevision: number };
    revision: {
      revision: number;
      values: Record<string, string>;
      validation: Issue[];
      provenance: {
        modelOwnedKeys: string[];
        cast?: {
          slots: Record<string, string[]>;
          leftOut: string[];
          ranking: string;
        };
        confirmedFields?: Record<string, string>;
      };
    };
    review?: {
      confirmedFields: string[];
      cast: {
        consultancy: string | null;
        ranking: string;
        leftOut: Array<{ id: string; company: string }>;
        contracts: Array<{ block: string; company: string }>;
      } | null;
    };
  };
  const SAFE = "delivered steady improvements with the team";
  const OTHER_EMPLOYERS_WORK =
    "Integrated Tidewater Learning into the Compass platform in 6 weeks";
  // Left to choose, this model names an employer that is already used
  // elsewhere, and writes one client's work under another client.
  const misbehaving = (keys: string[]) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        SERVER_FILLED.test(key)
          ? "Ostrava Insurance Tech"
          : key === "contract3_bullet1"
            ? OTHER_EMPLOYERS_WORK
            : key === "contracts_acquired_skills"
              ? "React, GraphQL"
              : SAFE,
      ]),
    );
  const RANKED = ["/roles/5", "/roles/1", "/roles/2", "/roles/3", "/roles/4"];
  // A field the server fills from the cast: an employer, a title or a date.
  const SERVER_FILLED =
    /^(?:current_(?:company|role|from)|my_company_\w+|contract_(?:company|role)\d|prior_my_company\d(?:_(?:role|from|to))?|earlier_exp_(?:from|to))$/;
  let templateId = "";
  let candidacyId = "";
  let documentId = "";
  const asked: Scripted[] = [];
  const linesOf = async (response: Response) => {
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    return Array.from(xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g), (match) =>
      Array.from((match[1] ?? "").matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((run) => (run[1] ?? "").replaceAll("&amp;", "&"))
        .join(""),
    );
  };
  const download = async (id: string, revision: number) => {
    const exported = await mine().request(
      `${url}/${id}/exports`,
      post({ revision, format: "docx" }),
    );
    expect(exported.status, await exported.clone().text()).toBe(201);
    const exportId = ((await exported.json()) as { id: string }).id;
    return linesOf(
      await mine().request(`${url}/${id}/exports/${exportId}/download`, {
        headers,
      }),
    );
  };
  const read = async (id: string) =>
    (await (await mine().request(`${url}/${id}`, { headers })).json()) as Saved;

  beforeAll(async () => {
    const digest = createHash("sha256")
      .update(canonical(SYNTHETIC_MATRIX))
      .digest("hex");
    await pg.owner.query(
      `INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision)
       VALUES($1,$2,'omnitech.interview','run-matrix','Run matrix',1)`,
      [tenantId, ownerId],
    );
    await pg.owner.query(
      `INSERT INTO interview.candidate_profile_revisions
       (tenant_id,actor_id,product_id,id,revision,name,sha256,matrix)
       VALUES($1,$2,'omnitech.interview','run-matrix',1,'Run matrix',$3,$4::jsonb)`,
      [tenantId, ownerId, digest, JSON.stringify(SYNTHETIC_MATRIX)],
    );
    const form = new FormData();
    form.set("name", "Run resume");
    form.set("kind", "resume");
    form.set("format", "docx");
    form.set("instructions", "Write only from the evidence.");
    form.set(
      "file",
      new File([new Uint8Array(await resumeRunDocx())], "resume.docx"),
    );
    const uploaded = await mine().request(`${url}/templates`, {
      method: "POST",
      headers,
      body: form,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    templateId = ((await uploaded.json()) as { template: { id: string } })
      .template.id;
    const candidacy = await mine().request(
      `${url}/candidacies`,
      post({
        companyName: "FullStack",
        title: "Principal Full Stack Engineer (React & AI-Driven)",
        jobDescription: FULLSTACK_POSTING,
      }),
    );
    expect(candidacy.status).toBe(201);
    candidacyId = ((await candidacy.json()) as { candidacyId: string })
      .candidacyId;
  });
  afterEach(() => {
    script = null;
    asked.length = 0;
  });

  it("derives the blocks of an uploaded template from its field keys", async () => {
    const detail = (await (
      await mine().request(`${url}/templates/${templateId}`, { headers })
    ).json()) as {
      fields: Array<{
        key: string;
        group?: { id: string; part: string; optional?: boolean };
      }>;
    };
    const group = (key: string) =>
      detail.fields.find((field) => field.key === key)?.group;
    expect(group("contract_company2")).toEqual({
      id: "contract-2",
      kind: "contract",
      part: "company",
      optional: true,
    });
    expect(group("contract2_bullet1")?.id).toBe("contract-2");
    expect(group("my_company_name")?.id).toBe("consultancy");
    expect(group("summary_paragraph1")).toBeUndefined();
    expect(group("email_address")).toBeUndefined();
  });

  it("writes in parallel calls yet takes every employer from the cast, flags another employer's work, and blocks export until it is put right", async () => {
    // Two writing calls must be in flight together, as in the original run.
    let arrived = 0;
    let open: () => void = () => undefined;
    const together = new Promise<void>((resolve) => {
      open = resolve;
    });
    script = async (call) => {
      asked.push(call);
      if (call.keys.includes("order")) return { order: RANKED };
      if (++arrived === 2) open();
      await together;
      return misbehaving(call.keys);
    };
    const created = await mine().request(
      url,
      post({
        title: "Resume | FullStack",
        templateId,
        templateRevision: 1,
        profileId: "run-matrix",
        profileRevision: 1,
        candidacyId,
        interviewId: null,
        aiTargetId: "test-model",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const made = (await created.json()) as Saved & { errors: Issue[] };
    documentId = made.document.id;
    const values = made.revision.values;

    // One small ranking call, then two writing calls.
    const [ranking, ...writing] = asked;
    expect(ranking?.keys).toEqual(["order"]);
    expect(ranking?.prompt).not.toContain("Compass");
    expect(writing).toHaveLength(2);

    // [1] No call was asked for an employer, a title or a date: the model's
    // "Ostrava Insurance Tech" for every company never had a place to land.
    const written = writing.flatMap((call) => call.keys);
    expect(written.filter((key) => SERVER_FILLED.test(key))).toEqual([]);
    expect(new Set(written).size).toBe(written.length);
    // Every employer is the cast's: the four most relevant clients under the
    // consultancy, each once, and the prior employer its own.
    expect(
      [1, 2, 3, 4].map((slot) => values[`contract_company${slot}`]),
    ).toEqual(["Signalpath", "Tidewater Learning", "Plotline", "Fleetmark"]);
    expect(values["contract_role3"]).toBe(
      "Senior Software Developer / Architect",
    );
    expect(values["my_company_name"]).toBe("Larkspur Works");
    expect(values["my_company_from"]).toBe("July 2020");
    expect(values["current_company"]).toBe("Northbeam Payments");
    expect(values["prior_my_company1"]).toBe("Ostrava Insurance Tech");
    expect(values["earlier_exp_from"]).toBe("2014");
    const employers = [
      "current_company",
      "contract_company1",
      "contract_company2",
      "contract_company3",
      "contract_company4",
      "prior_my_company1",
    ].map((key) => values[key]);
    expect(new Set(employers).size).toBe(employers.length);
    // [2] The fifth client is left out: not a prior employer, not in a prompt.
    expect(made.revision.provenance.cast?.ranking).toBe("model");
    expect(made.revision.provenance.cast?.leftOut).toEqual(["/roles/4"]);
    expect(Object.values(values)).not.toContain("Backerly");
    for (const call of writing) expect(call.prompt).not.toContain("Backerly");

    // Each call was given its own blocks' roles, and the block of a company
    // holds that company's role and no other.
    for (const call of writing) {
      const prompt = JSON.parse(call.prompt) as {
        blocks: Array<{ block: string; roles: Array<{ company: string }> }>;
        candidateProfile?: unknown;
      };
      expect(prompt.candidateProfile).toBeUndefined();
      for (const block of prompt.blocks) {
        const slot = /^contract-(\d)$/.exec(block.block)?.[1];
        if (slot)
          expect(block.roles.map((role) => role.company)).toEqual([
            values[`contract_company${slot}`],
          ]);
      }
      // Contact details are the document's, never a prompt's.
      expect(call.prompt).not.toContain(CONTACT.email);
      expect(call.prompt).not.toContain(CONTACT.phone);
    }

    // [3] The contact fields are filled from this machine's contact details.
    expect(values["email_address"]).toBe(CONTACT.email);
    expect(values["heading_phone_number"]).toBe(CONTACT.phone);
    expect(values["portfolio"]).toBe(CONTACT.portfolio);

    // The model still wrote Tidewater's work under Plotline. It is caught:
    // the field fails, with what was not found and where it belongs.
    expect(values["contract3_bullet1"]).toBe(OTHER_EMPLOYERS_WORK);
    expect(made.errors).toEqual([
      {
        key: "contract3_bullet1",
        code: "unsupported",
        against: "Plotline",
        missing: [
          { text: "6 weeks", kind: "figure", foundIn: "Tidewater Learning" },
          { text: "Tidewater", kind: "name", foundIn: "Tidewater Learning" },
          { text: "Learning", kind: "name", foundIn: "Tidewater Learning" },
          { text: "Compass", kind: "name", foundIn: "Tidewater Learning" },
        ],
      },
    ]);
    expect(made.revision.validation).toEqual(made.errors);
    expect(made.document.status).toBe("invalid");

    // The page is told the same, and which client was left out.
    const shown = await read(documentId);
    expect(shown.revision.validation).toEqual(made.errors);
    expect(shown.review?.cast).toMatchObject({
      consultancy: "Larkspur Works",
      ranking: "model",
      leftOut: [{ id: "/roles/4", company: "Backerly" }],
    });
    expect(shown.review?.cast?.contracts.map((role) => role.company)).toEqual([
      "Signalpath",
      "Tidewater Learning",
      "Plotline",
      "Fleetmark",
    ]);

    // Export is refused, in both formats, and nothing is recorded.
    for (const format of ["docx", "md"]) {
      const refused = await mine().request(
        `${url}/${documentId}/exports`,
        post({ revision: 1, format }),
      );
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error: {
          code: "verification-failed",
          fields: [{ ...made.errors[0], label: "Contract3 bullet1" }],
        },
      });
    }
    expect(
      (
        (await (
          await mine().request(`${url}/${documentId}/exports`, { headers })
        ).json()) as { exports: unknown[] }
      ).exports,
    ).toEqual([]);
  }, 30_000);

  it("regenerates the one failing field from its own role, which clears the block on export", async () => {
    script = (call) => {
      asked.push(call);
      return Object.fromEntries(
        call.keys.map((key) => [
          key,
          "Rebuilt listing search for commercial property, cutting latency to 45ms",
        ]),
      );
    };
    const regenerated = await mine().request(
      `${url}/${documentId}/regenerate`,
      post({
        baseRevision: 1,
        fieldKey: "contract3_bullet1",
        aiTargetId: "test-model",
      }),
    );
    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    // One call, for the one field, given Plotline's role and no other's.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.keys).toEqual(["contract3_bullet1"]);
    const prompt = JSON.parse(asked[0]?.prompt ?? "{}") as {
      blocks: Array<{ block: string; roles: Array<{ company: string }> }>;
      otherRoles: string[];
    };
    expect(prompt.blocks).toEqual([
      {
        block: "contract-3",
        fields: ["contract3_bullet1"],
        roles: [SYNTHETIC_MATRIX.roles[2]],
      },
    ]);
    expect(
      prompt.otherRoles.some((line) => line.startsWith("Tidewater Learning")),
    ).toBe(true);
    // The text that failed is not shown back to the model to rephrase, and
    // the general facts repeat no employer.
    expect(asked[0]?.prompt).not.toContain("Compass");
    expect(
      (JSON.parse(asked[0]?.prompt ?? "{}") as { fields: unknown[] }).fields,
    ).toEqual([
      {
        key: "contract3_bullet1",
        label: "Contract3 bullet1",
        maxLength: null,
        block: "contract-3",
        rejected: true,
        targetWords: 10,
        maxWords: 15,
      },
    ]);
    expect(
      Object.keys(
        (JSON.parse(asked[0]?.prompt ?? "{}") as { facts: object }).facts,
      ).filter((key) => SERVER_FILLED.test(key)),
    ).toEqual([]);

    const shown = await read(documentId);
    expect(shown.revision.revision).toBe(2);
    expect(shown.revision.validation).toEqual([]);
    expect(shown.document.status).toBe("ready");
    // The cast is the same one: regenerating a field does not recast.
    expect(shown.review?.cast?.leftOut).toEqual([
      {
        id: "/roles/4",
        company: "Backerly",
        title: "Senior Software Developer / Architect",
      },
    ]);

    // [4] The export is the template's layout with nothing dangling.
    const lines = await download(documentId, 2);
    expect(lines).toContain(
      ` ${CONTACT.phone}   |    ${CONTACT.email}   |    ${CONTACT.portfolio}   |    Calgary, AB`,
    );
    expect(lines).toContain(
      "Larkspur Works ~ Lead Full Stack Developer / Architect / Contractor (July 2020- September 2024)",
    );
    expect(lines).toContain(
      "Plotline (Senior Software Developer / Architect): ",
    );
    expect(lines.join("\n")).not.toContain("Compass");
    expect(lines.join("\n")).not.toContain("Backerly");
  }, 30_000);

  it("holds a hand edit to the same check until the person confirms it, and again when the text changes", async () => {
    const before = (await read(documentId)).revision.values;
    const claim = "Rebuilt the quoting platform on Kubernetes";
    const edited = await mine().request(
      `${url}/${documentId}/revisions`,
      post({
        baseRevision: 2,
        values: { ...before, contract1_bullet1: claim },
      }),
    );
    expect(edited.status).toBe(201);
    const unsupported = [
      {
        key: "contract1_bullet1",
        code: "unsupported",
        against: "Signalpath",
        missing: [{ text: "Kubernetes", kind: "name" }],
      },
    ];
    expect((await read(documentId)).revision.validation).toEqual(unsupported);
    // A draft is checked before it is saved, too.
    const draft = await mine().request(
      `${url}/${documentId}/preview`,
      post({
        baseRevision: 3,
        values: { ...before, contract1_bullet1: `${claim} and Kafka` },
      }),
    );
    expect(
      ((await draft.json()) as { validation: Issue[] }).validation[0]?.missing,
    ).toEqual([
      { text: "Kubernetes", kind: "name" },
      { text: "Kafka", kind: "name", foundIn: "Fleetmark" },
    ]);
    expect(
      (
        await mine().request(
          `${url}/${documentId}/exports`,
          post({ revision: 3, format: "docx" }),
        )
      ).status,
    ).toBe(409);
    // "Confirmed by me": the person is the authority on their own history.
    const confirmed = await mine().request(
      `${url}/${documentId}/revisions`,
      post({
        baseRevision: 3,
        values: { ...before, contract1_bullet1: claim },
        confirm: ["contract1_bullet1"],
      }),
    );
    expect(confirmed.status).toBe(201);
    const standing = await read(documentId);
    expect(standing.revision.validation).toEqual([]);
    expect(standing.review?.confirmedFields).toEqual(["contract1_bullet1"]);
    expect(standing.document.status).toBe("ready");
    expect(await download(documentId, 4)).toContain(claim);
    // The confirmation is of that text: changing it asks again.
    const changed = await mine().request(
      `${url}/${documentId}/revisions`,
      post({
        baseRevision: 4,
        values: { ...before, contract1_bullet1: `${claim} and Terraform` },
      }),
    );
    expect(changed.status).toBe(201);
    const lapsed = await read(documentId);
    expect(lapsed.review?.confirmedFields).toEqual([]);
    expect(lapsed.revision.validation[0]?.missing).toEqual([
      { text: "Kubernetes", kind: "name" },
      { text: "Terraform", kind: "name" },
    ]);
    // A field that is not the template's cannot be confirmed.
    expect(
      (
        await mine().request(
          `${url}/${documentId}/revisions`,
          post({ baseRevision: 5, values: before, confirm: ["no_such_field"] }),
        )
      ).status,
    ).toBe(400);
    // Restoring the confirmed revision brings its confirmation back with it.
    const restored = await mine().request(
      `${url}/${documentId}/restore`,
      post({ baseRevision: 5, sourceRevision: 4 }),
    );
    expect(restored.status).toBe(201);
    expect((await read(documentId)).revision.validation).toEqual([]);
  }, 30_000);

  it("swaps the client that was left out into a contract block, rewriting that block from its own role", async () => {
    script = (call) => {
      asked.push(call);
      return Object.fromEntries(
        call.keys.map((key) => [
          key,
          /skills?$/.test(key)
            ? "React, Elixir"
            : "Built referral payouts for crowdfunding campaigns",
        ]),
      );
    };
    const swap = (body: Record<string, unknown>) =>
      mine().request(
        `${url}/${documentId}/cast`,
        post({ baseRevision: 6, aiTargetId: "test-model", ...body }),
      );
    // Only a client that was left out, into a block that holds a client.
    expect(
      (await swap({ block: "contract-4", roleId: "/roles/6" })).status,
    ).toBe(400);
    expect(
      (await swap({ block: "contract-4", roleId: "/roles/1" })).status,
    ).toBe(400);
    expect((await swap({ block: "prior-1", roleId: "/roles/4" })).status).toBe(
      400,
    );
    expect(asked).toHaveLength(0);
    const swapped = await swap({ block: "contract-4", roleId: "/roles/4" });
    expect(swapped.status, await swapped.clone().text()).toBe(201);
    // The block's prose and the shared skills line, from Backerly's role.
    expect(asked).toHaveLength(1);
    expect([...(asked[0]?.keys ?? [])].sort()).toEqual([
      "contract4_bullet1",
      "contract4_bullet2",
      "contracts_acquired_skills",
    ]);
    const prompt = JSON.parse(asked[0]?.prompt ?? "{}") as {
      blocks: Array<{ block: string; roles: Array<{ company: string }> }>;
    };
    expect(
      prompt.blocks.find((block) => block.block === "contract-4")?.roles,
    ).toEqual([SYNTHETIC_MATRIX.roles[4]]);
    const shown = await read(documentId);
    expect(shown.revision.values["contract_company4"]).toBe("Backerly");
    expect(shown.revision.values["contract_role4"]).toBe(
      "Senior Software Developer / Architect",
    );
    expect(shown.revision.values["contract4_bullet1"]).toBe(
      "Built referral payouts for crowdfunding campaigns",
    );
    expect(shown.review?.cast?.leftOut.map((role) => role.company)).toEqual([
      "Fleetmark",
    ]);
    expect(shown.review?.cast?.contracts.map((role) => role.company)).toEqual([
      "Signalpath",
      "Tidewater Learning",
      "Plotline",
      "Backerly",
    ]);
    expect(shown.revision.validation).toEqual([]);
    expect(Object.values(shown.revision.values)).not.toContain("Fleetmark");
  }, 30_000);

  it("holds a document made before this change to the same check, and brings it under a cast when every field is rewritten", async () => {
    // The original run, as it was saved: the model chose the employers. One
    // is used twice, one block shows another employer's work, there is no
    // consultancy, no contact details and no cast.
    const repo = new InterviewDocumentRepository(database);
    const template = await repo.getTemplateRevision(
      { tenantId, actorId: ownerId },
      templateId,
      1,
    );
    const keys = template?.fields.map((field) => field.key) ?? [];
    const old: Record<string, string> = {
      ...Object.fromEntries(keys.map((key) => [key, SAFE])),
      heading_name: "Rowan Ashby",
      city: "Calgary",
      province: "AB",
      heading_phone_number: "",
      email_address: "",
      portfolio: "",
      current_company: "Northbeam Payments",
      my_company_name: "",
      my_company_role: "",
      my_company_from: "",
      my_company_to: "",
      contract_company1: "Signalpath",
      contract_company2: "Ostrava Insurance Tech",
      contract2_bullet1: OTHER_EMPLOYERS_WORK,
      contract_company3: "Plotline",
      contract_company4: "Signalpath",
      prior_my_company1: "Ostrava Insurance Tech",
      contracts_acquired_skills: "React, GraphQL",
    };
    const modelOwnedKeys = keys.filter(
      (key) =>
        ![
          "heading_name",
          "city",
          "province",
          "heading_phone_number",
          "email_address",
          "portfolio",
        ].includes(key),
    );
    const { document } = await repo.createDocument(
      { tenantId, actorId: ownerId },
      {
        title: "Old resume",
        templateId,
        templateRevision: 1,
        profileId: "run-matrix",
        profileRevision: 1,
        candidacyId: null,
        interviewId: null,
        values: old,
        provenance: {
          kind: "generated",
          targetId: "test-model",
          sourceDigest: documentSourceDigest({ target_role: "" }, {}),
          modelOwnedKeys,
          claimState: "unverified",
        },
      },
    );
    // As saved it reads "ready"; opened, it is checked as it stands now.
    const shown = await read(document.id);
    expect(shown.review?.cast).toBeNull();
    expect(
      shown.revision.validation.filter((issue) => issue.code === "unsupported"),
    ).toEqual([
      {
        key: "contract2_bullet1",
        code: "unsupported",
        against: "Ostrava Insurance Tech",
        missing: [
          { text: "6 weeks", kind: "figure", foundIn: "Tidewater Learning" },
          { text: "Tidewater", kind: "name", foundIn: "Tidewater Learning" },
          { text: "Learning", kind: "name", foundIn: "Tidewater Learning" },
          { text: "Compass", kind: "name", foundIn: "Tidewater Learning" },
        ],
      },
    ]);
    // The empty consultancy block does not apply: nothing of it is missing.
    // The contact details are (they are the person's to supply).
    expect(
      shown.revision.validation
        .filter((issue) => issue.code === "missing")
        .map((issue) => issue.key),
    ).toEqual(["heading_phone_number", "email_address", "portfolio"]);
    // The employers it shows are no longer the model's to rewrite one by one.
    expect(shown.revision.provenance.modelOwnedKeys).not.toContain(
      "contract_company2",
    );
    expect(
      (
        await mine().request(
          `${url}/${document.id}/exports`,
          post({ revision: 1, format: "docx" }),
        )
      ).status,
    ).toBe(409);

    // "Refresh source facts" fills the contact details stored since.
    const refreshed = await mine().request(
      `${url}/${document.id}/refresh-sources`,
      post({ baseRevision: 1 }),
    );
    expect(refreshed.status).toBe(201);
    expect((await read(document.id)).revision.values["email_address"]).toBe(
      CONTACT.email,
    );

    // "Regenerate every field" decides a cast: employers become the server's.
    script = (call) => {
      asked.push(call);
      return misbehaving(call.keys);
    };
    const rewritten = await mine().request(
      `${url}/${document.id}/regenerate`,
      post({ baseRevision: 2, mode: "all", aiTargetId: "test-model" }),
    );
    expect(rewritten.status, await rewritten.clone().text()).toBe(201);
    const after = await read(document.id);
    // No posting on a general document: the four most recent clients.
    expect(after.review?.cast).toMatchObject({
      consultancy: "Larkspur Works",
      ranking: "recency",
      leftOut: [{ company: "Signalpath" }],
    });
    expect(
      [1, 2, 3, 4].map(
        (slot) => after.revision.values[`contract_company${slot}`],
      ),
    ).toEqual(["Tidewater Learning", "Plotline", "Fleetmark", "Backerly"]);
    expect(after.revision.values["my_company_name"]).toBe("Larkspur Works");
    expect(after.revision.values["prior_my_company1"]).toBe(
      "Ostrava Insurance Tech",
    );
    expect(
      asked
        .flatMap((call) => call.keys)
        .filter((key) => SERVER_FILLED.test(key)),
    ).toEqual([]);
    // The misbehaving model wrote Tidewater's work under Fleetmark this time.
    expect(after.revision.validation).toMatchObject([
      { key: "contract3_bullet1", code: "unsupported", against: "Fleetmark" },
    ]);
  }, 30_000);
});
