import {
  createPlatformDatabase,
  type PlatformDatabase,
  withTenant,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { DocumentArtifactRepository } from "@omnitech/platform-storage";
import { afterAll, beforeAll, expect, it } from "vitest";
import { documentTemplates } from "../db/documents.js";
import {
  DocumentNotFound,
  DocumentRetryConflict,
  DocumentRevisionConflict,
  InterviewDocumentRepository,
} from "./repository.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;
let repository: InterviewDocumentRepository;
let artifacts: DocumentArtifactRepository;
const ids = { tenantId: "", alice: "", bob: "", candidacyId: "" };
const scope = () => ({ tenantId: ids.tenantId, actorId: ids.alice });
const bobScope = () => ({ tenantId: ids.tenantId, actorId: ids.bob });
const id = async (query: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(query, values)).rows[0]?.id);

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview TO fixture_member;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA platform TO fixture_member;
  `);
  ids.tenantId = await id(
    "INSERT INTO platform.tenants(slug,name) VALUES('repository-documents','Documents') RETURNING id",
  );
  ids.alice = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('repository-alice@x','Alice') RETURNING id",
  );
  ids.bob = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('repository-bob@x','Bob') RETURNING id",
  );
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'member')",
    [ids.tenantId, ids.alice, ids.bob],
  );
  const company = await id(
    "INSERT INTO interview.companies(tenant_id,name) VALUES($1,'Acme') RETURNING id",
    [ids.tenantId],
  );
  const person = await id(
    "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,'Alice') RETURNING id",
    [ids.tenantId],
  );
  await pg.owner.query(
    "INSERT INTO interview.member_people(tenant_id,user_id,person_id) VALUES($1,$2,$3)",
    [ids.tenantId, ids.alice, person],
  );
  ids.candidacyId = await id(
    "INSERT INTO interview.candidacies(tenant_id,company_id,candidate_person_id,title,job_description) VALUES($1,$2,$3,'Engineer','Build systems') RETURNING id",
    [ids.tenantId, company, person],
  );
  await pg.owner.query(
    "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,'omnitech.interview','profile','Profile',1)",
    [ids.tenantId, ids.alice],
  );
  await pg.owner.query(
    "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview','profile',1,'Profile',$3,'{}')",
    [ids.tenantId, ids.alice, "0".repeat(64)],
  );
  member = createPlatformDatabase(pg.memberUrl);
  artifacts = new DocumentArtifactRepository(member);
  repository = new InterviewDocumentRepository(member);
}, 60_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

const fields = [
  {
    key: "full_name",
    label: "Full name",
    source: "candidate-profile" as const,
    required: true,
    maxLength: 80,
  },
];

it("keeps validated batch checkpoints bound to owner and source snapshot", async () => {
  const identity = {
    key: "repository-resume-1",
    bindingHash: "a".repeat(64),
    sourceDigest: "b".repeat(64),
  };
  await repository.reserveGeneration(scope(), identity);
  expect(await repository.getGenerationBatches(scope(), identity)).toEqual({});
  await repository.saveGenerationBatch(scope(), identity, {
    id: "batch-1",
    fieldsHash: "c".repeat(64),
    values: { summary: "Evidence" },
    usage: { totalTokens: 12, costUsd: 0.002 },
  });
  expect(await repository.getGenerationBatches(scope(), identity)).toEqual({
    "batch-1": {
      fieldsHash: "c".repeat(64),
      values: { summary: "Evidence" },
      usage: { totalTokens: 12, costUsd: 0.002 },
    },
  });
  await expect(
    repository.getGenerationBatches(bobScope(), identity),
  ).rejects.toBeInstanceOf(DocumentRetryConflict);
  await expect(
    repository.getGenerationBatches(scope(), {
      ...identity,
      sourceDigest: "changed",
    }),
  ).rejects.toBeInstanceOf(DocumentRetryConflict);
  await expect(
    repository.saveGenerationBatch(scope(), identity, {
      id: "batch-1",
      fieldsHash: "c".repeat(64),
      values: { summary: "Different" },
    }),
  ).rejects.toBeInstanceOf(DocumentRetryConflict);
});

it("versions a template, duplicates it, and keeps it private", async () => {
  const source = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-template-source",
    title: "resume.md",
    bytes: Buffer.from("# {{full_name}}"),
  });
  const created = await repository.createTemplate(scope(), {
    name: "Resume",
    kind: "resume",
    format: "md",
    sourceArtifactId: source,
    fields,
    instructions: "Use evidence",
  });
  expect(created.revision.revision).toBe(1);
  expect(await repository.listTemplates(bobScope())).toEqual([]);
  const copiedSource = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-template-source",
    title: "resume-copy.md",
    bytes: Buffer.from("# {{full_name}}"),
  });
  const second = await repository.addTemplateRevision(scope(), {
    templateId: created.template.id,
    expectedRevision: 1,
    sourceArtifactId: copiedSource,
    fields,
    instructions: "Use only evidence",
  });
  expect(second.revision).toBe(2);
  const [listed] = await repository.listTemplates(scope());
  expect(listed).toMatchObject({
    latestRevision: 2,
    fieldCount: fields.length,
  });
  expect(listed?.revisions.map((item) => item.revision)).toEqual([2, 1]);
  await expect(
    repository.addTemplateRevision(scope(), {
      templateId: created.template.id,
      expectedRevision: 1,
      sourceArtifactId: copiedSource,
      fields,
      instructions: "Stale",
    }),
  ).rejects.toBeInstanceOf(DocumentRevisionConflict);
  const duplicateSource = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-template-source",
    title: "duplicate.md",
    bytes: Buffer.from("# {{full_name}}"),
  });
  const copy = await repository.duplicateTemplate(scope(), {
    sourceTemplateId: created.template.id,
    name: "Resume copy",
    sourceArtifactId: duplicateSource,
  });
  expect(copy.template.name).toBe("Resume copy");
  expect(copy.revision.instructions).toBe("Use only evidence");
  expect(
    (await repository.getTemplateRevision(scope(), copy.template.id))?.fields,
  ).toEqual(fields);
  expect(
    await repository.getTemplateRevision(bobScope(), copy.template.id),
  ).toBeNull();
});

it("provisions one read-only tenant built-in and refuses a member ownerless insert", async () => {
  const sourceArtifactId = await artifacts.provisionBuiltIn({
    tenantId: ids.tenantId,
    key: "default-resume-v1",
    title: "Default resume.md",
    bytes: Buffer.from("# {{full_name}}"),
  });
  const input = {
    key: "default-resume-v1",
    name: "Default resume",
    kind: "resume" as const,
    format: "md" as const,
    sourceArtifactId,
    fields,
    instructions: "Use verified experience",
  };
  const builtIn = await repository.provisionBuiltInTemplate(scope(), input);
  expect(
    (await repository.provisionBuiltInTemplate(scope(), input)).template.id,
  ).toBe(builtIn.template.id);
  expect(
    (await repository.getTemplateRevision(bobScope(), builtIn.template.id))
      ?.fields,
  ).toEqual(fields);
  await expect(
    repository.addTemplateRevision(bobScope(), {
      templateId: builtIn.template.id,
      expectedRevision: 1,
      sourceArtifactId,
      fields,
      instructions: "Member changed it",
    }),
  ).rejects.toBeInstanceOf(DocumentNotFound);
  await expect(
    withTenant(
      { ...bobScope(), productId: "omnitech.interview" },
      (db) =>
        db.insert(documentTemplates).values({
          tenantId: ids.tenantId,
          ownerUserId: null,
          kind: "resume",
          format: "md",
          name: "Forged built-in",
        }),
      { database: member },
    ),
  ).rejects.toThrow();
});

it("appends a built-in revision when its file or instructions change, and only then", async () => {
  const input = {
    key: "versioned-resume",
    name: "Versioned resume",
    kind: "resume" as const,
    format: "md" as const,
    sourceBytes: Buffer.from("# {{full_name}}"),
    fields,
    instructions: "First wording",
  };
  const first = await repository.provisionBuiltInTemplate(scope(), input);
  expect(first.revision.revision).toBe(1);
  const again = await repository.provisionBuiltInTemplate(scope(), input);
  expect(again.revision.revision).toBe(1);
  const reworded = await repository.provisionBuiltInTemplate(scope(), {
    ...input,
    instructions: "Second wording",
  });
  expect(reworded.revision.revision).toBe(2);
  const replaced = await repository.provisionBuiltInTemplate(scope(), {
    ...input,
    instructions: "Second wording",
    sourceBytes: Buffer.from("# Resume of {{full_name}}"),
  });
  expect(replaced.revision.revision).toBe(3);
  const latest = await repository.getTemplateRevision(
    scope(),
    first.template.id,
  );
  expect(latest?.revision).toMatchObject({
    revision: 3,
    instructions: "Second wording",
  });
  expect(
    (await repository.getTemplateRevision(scope(), first.template.id, 1))
      ?.revision.instructions,
  ).toBe("First wording");
});

it("does not append a built-in revision for fields whose keys jsonb reorders", async () => {
  const sectioned = fields.map((field) => ({ ...field, section: "Header" }));
  const input = {
    key: "sectioned-resume",
    name: "Sectioned resume",
    kind: "resume" as const,
    format: "md" as const,
    sourceBytes: Buffer.from("# {{full_name}}"),
    fields: sectioned,
    instructions: "Same every time",
  };
  const first = await repository.provisionBuiltInTemplate(scope(), input);
  for (let run = 0; run < 3; run++)
    expect(
      (await repository.provisionBuiltInTemplate(scope(), input)).revision
        .revision,
    ).toBe(first.revision.revision);
});

it("saves immutable snapshots, rejects stale edits, restores, and records selected-revision exports", async () => {
  const source = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-template-source",
    title: "cover.md",
    bytes: Buffer.from("Hello {{full_name}}"),
  });
  const { template } = await repository.createTemplate(scope(), {
    name: "Cover",
    kind: "cover_letter",
    format: "md",
    sourceArtifactId: source,
    fields,
    instructions: "",
  });
  const created = await repository.createDocument(scope(), {
    title: "Acme cover",
    templateId: template.id,
    templateRevision: 1,
    profileId: "profile",
    profileRevision: 1,
    candidacyId: ids.candidacyId,
    interviewId: null,
    values: { full_name: "Alice" },
    provenance: { full_name: "generated" },
  });
  expect(created.revision.revision).toBe(1);
  expect(created.document.status).toBe("ready");
  expect(
    (
      await repository.findMatchingDocument(scope(), {
        templateId: template.id,
        templateRevision: 1,
        profileId: "profile",
        profileRevision: 1,
        candidacyId: ids.candidacyId,
        interviewId: null,
      })
    )?.id,
  ).toBe(created.document.id);
  expect(await repository.listDocuments(bobScope())).toEqual([]);
  expect(
    await repository.getDocument(bobScope(), created.document.id),
  ).toBeNull();

  const edited = await repository.appendRevision(scope(), {
    documentId: created.document.id,
    baseRevision: 1,
    values: { full_name: "Alice Liddell" },
    provenance: { full_name: "edited" },
  });
  expect(edited.revision).toBe(2);
  await expect(
    repository.appendRevision(scope(), {
      documentId: created.document.id,
      baseRevision: 1,
      values: { full_name: "Stale" },
      provenance: {},
    }),
  ).rejects.toBeInstanceOf(DocumentRevisionConflict);
  expect(
    (await repository.getDocument(scope(), created.document.id, 1))?.revision
      .values,
  ).toEqual({ full_name: "Alice" });
  const restored = await repository.restoreRevision(scope(), {
    documentId: created.document.id,
    baseRevision: 2,
    sourceRevision: 1,
  });
  expect(restored.revision).toBe(3);
  expect(restored.values).toEqual({ full_name: "Alice" });
  expect(restored.provenance).toEqual({
    full_name: "generated",
    restoredFromRevision: 1,
    claimState: "unverified",
  });
  const exportedArtifact = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-export",
    title: "cover.md",
    bytes: Buffer.from("Hello Alice"),
  });
  const exported = await repository.recordExport(scope(), {
    documentId: created.document.id,
    revision: 1,
    format: "md",
    artifactId: exportedArtifact,
  });
  expect(exported.revision).toBe(1);
  expect(await repository.getExportArtifactId(scope(), exported.id)).toBe(
    exportedArtifact,
  );
  expect(
    await repository.getExportArtifactId(bobScope(), exported.id),
  ).toBeNull();
  expect(
    await repository.listExports(scope(), created.document.id),
  ).toHaveLength(1);
  const invalid = await repository.appendRevision(scope(), {
    documentId: created.document.id,
    baseRevision: 3,
    values: { full_name: "" },
    provenance: { full_name: "edited" },
  });
  expect(invalid.validation).toEqual([{ key: "full_name", code: "missing" }]);
  expect(
    (await repository.getDocument(scope(), created.document.id))?.document
      .status,
  ).toBe("invalid");
  await expect(
    repository.appendRevision(bobScope(), {
      documentId: created.document.id,
      baseRevision: 4,
      values: { full_name: "Bob" },
      provenance: {},
    }),
  ).rejects.toBeInstanceOf(DocumentNotFound);
});

it("hides listed document metadata when its profile or candidacy binding is revoked", async () => {
  const source = await artifacts.create({
    ...scope(),
    artifactType: "interview.document-template-source",
    title: "binding.md",
    bytes: Buffer.from("{{full_name}}"),
  });
  const { template } = await repository.createTemplate(scope(), {
    name: "Binding check",
    kind: "resume",
    format: "md",
    sourceArtifactId: source,
    fields,
    instructions: "",
  });
  const created = await repository.createDocument(scope(), {
    title: "Private title",
    templateId: template.id,
    templateRevision: 1,
    profileId: "profile",
    profileRevision: 1,
    candidacyId: ids.candidacyId,
    interviewId: null,
    values: { full_name: "Alice" },
    provenance: { full_name: "generated" },
  });
  const listed = async () =>
    (await repository.listDocuments(scope())).some(
      (item) => item.id === created.document.id,
    );
  expect(await listed()).toBe(true);
  await pg.owner.query(
    "UPDATE interview.candidate_profiles SET revoked_at=now() WHERE tenant_id=$1 AND actor_id=$2 AND id='profile'",
    [ids.tenantId, ids.alice],
  );
  try {
    expect(await listed()).toBe(false);
  } finally {
    await pg.owner.query(
      "UPDATE interview.candidate_profiles SET revoked_at=NULL WHERE tenant_id=$1 AND actor_id=$2 AND id='profile'",
      [ids.tenantId, ids.alice],
    );
  }
  expect(await listed()).toBe(true);
  const unrelatedPerson = await id(
    "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,'Unrelated') RETURNING id",
    [ids.tenantId],
  );
  const originalPerson = await id(
    "SELECT candidate_person_id AS id FROM interview.candidacies WHERE tenant_id=$1 AND id=$2",
    [ids.tenantId, ids.candidacyId],
  );
  await pg.owner.query(
    "UPDATE interview.candidacies SET candidate_person_id=$1 WHERE tenant_id=$2 AND id=$3",
    [unrelatedPerson, ids.tenantId, ids.candidacyId],
  );
  try {
    expect(await listed()).toBe(false);
  } finally {
    await pg.owner.query(
      "UPDATE interview.candidacies SET candidate_person_id=$1 WHERE tenant_id=$2 AND id=$3",
      [originalPerson, ids.tenantId, ids.candidacyId],
    );
  }
  expect(await listed()).toBe(true);
});
