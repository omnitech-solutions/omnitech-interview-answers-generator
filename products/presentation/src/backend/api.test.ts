import {
  type AiEngine,
  createAiEngine,
  type Execution,
  type ImagePort,
  type ImageRequest,
  type ImageResult,
  type ModelInput,
  type ModelPort,
  type Scope,
} from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import type { PlatformContext } from "@omnitech/platform-contracts";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPresentationApi } from "./api";

// biome-ignore lint/suspicious/noExplicitAny: JSON read back from the code under test; each assertion names the fields it checks
type Json = any;

// fixture_member is NOSUPERUSER NOBYPASSRLS, so tenant policies bind it exactly
// as they bind the app role in production.
let pg: DisposablePostgres;
let member: PlatformDatabase;
const contexts = new Map<string, PlatformContext>();
// What the engine was asked for, as the model and image providers saw it, and
// the executions its policy was asked to authorise.
const modelCalls: { scope: Scope; input: ModelInput }[] = [];
const imageCalls: { scope: Scope; request: ImageRequest }[] = [];
const authorized: Execution[] = [];
let nextAiResult: unknown = {};
let nextImage: ImageResult | undefined;
let aiFailure: unknown;

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const noUsage = {
  status: "unavailable",
  reason: "test provider",
  cost: { status: "unavailable", reason: "test provider" },
} as const;

// A model that answers with whatever the test set, or fails with it.
const model: ModelPort = {
  async *stream(scope, input) {
    modelCalls.push({ scope, input });
    if (aiFailure !== undefined) throw aiFailure;
    yield { type: "text", text: JSON.stringify(nextAiResult) };
    yield { type: "usage", usage: noUsage };
  },
};

const imageMaker: ImagePort = {
  providerId: "test-images",
  capabilities: { editing: false, aspectRatios: ["1:1", "16:9", "9:16"] },
  async generate(scope, request) {
    imageCalls.push({ scope, request });
    if (aiFailure !== undefined) throw aiFailure;
    if (!nextImage) throw new Error("no image prepared");
    return nextImage;
  },
};

// A real engine over the providers above. Profile `members-only` is refused to
// a member without the share permission.
const engine: AiEngine = createAiEngine({
  profiles: [
    { id: "fast", provider: "text", label: "Fast model" },
    { id: "p", provider: "text" },
    { id: "members-only", provider: "text", label: "Members only" },
    { id: "images", provider: "pictures", label: "Pictures" },
    { id: "i", provider: "pictures" },
  ],
  providers: { text: model },
  images: { pictures: imageMaker },
  authorize: (execution, profile) => {
    authorized.push(execution);
    return profile.id !== "members-only" ||
      execution.permissions?.includes("presentation.share")
      ? true
      : "Members only.";
  },
});

function buildContext(
  tenant: { id: string; slug: string },
  userId: string,
  permissions: string[],
): PlatformContext {
  return {
    user: {
      id: userId,
      email: "ada@example.test",
      displayName: "Ada",
      avatarUrl: null,
    },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.slug },
    membership: { tenantId: tenant.id, userId, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions,
    products: [],
  };
}

function appFor(withEngine?: AiEngine) {
  return createPresentationApi({
    database: member,
    resolveContext: async (slug) => contexts.get(slug) ?? null,
    ...(withEngine ? { engine: withEngine } : {}),
  });
}

let app: ReturnType<typeof appFor>;
let appWithoutAi: ReturnType<typeof appFor>;

async function call(
  tenant: string,
  method: string,
  path: string,
  body?: unknown,
  target = app,
  headers: Record<string, string> = {},
) {
  const response = await target.request(
    `/presentation/v1${path}${path.includes("?") ? "&" : "?"}tenant=${tenant}`,
    {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Json) : undefined,
  };
}

async function createDocument(
  tenant: string,
  title: string,
  outline?: string[],
) {
  const created = await call(tenant, "POST", "/documents", {
    title,
    idempotencyKey: crypto.randomUUID(),
    ...(outline ? { outline } : {}),
  });
  expect(created.status).toBe(201);
  const document = await call(tenant, "GET", `/documents/${created.body!.id}`);
  return document.body as Record<string, Json>;
}

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, presentation TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, presentation TO fixture_member;`);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
  );
  const userId = user.rows[0]!.id;
  const tenants = await pg.owner.query<{ id: string; slug: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North'), ('south', 'South') RETURNING id, slug",
  );
  for (const tenant of tenants.rows) {
    contexts.set(
      tenant.slug,
      buildContext(tenant, userId, ["presentation.share"]),
    );
  }
  contexts.set(
    "viewer",
    buildContext(
      tenants.rows.find((tenant) => tenant.slug === "north")!,
      userId,
      [],
    ),
  );
  member = createPlatformDatabase(pg.memberUrl);
  app = appFor(engine);
  appWithoutAi = appFor();
}, 60_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

describe("access", () => {
  it.each([
    ["GET", "/documents"],
    ["GET", "/documents/00000000-0000-4000-8000-000000000000"],
    ["GET", "/themes"],
    ["GET", "/images"],
    ["POST", "/documents"],
    ["DELETE", "/documents/00000000-0000-4000-8000-000000000000"],
  ])("refuses %s %s without a tenant membership", async (method, path) => {
    const response = await call("stranger", method, path, {});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("refuses the 400-class writes when there is no membership", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const writes = [
      ["PATCH", `/documents/${id}`],
      ["POST", `/documents/${id}/duplicate`],
      ["PUT", `/documents/${id}/favorite`],
      ["PUT", `/documents/${id}/slides`],
      ["DELETE", `/documents/${id}/slides/${id}`],
      ["PATCH", `/documents/${id}/slides/${id}`],
      ["POST", `/documents/${id}/recordings`],
      ["GET", `/documents/${id}/recordings`],
      ["POST", `/documents/${id}/exports`],
      ["POST", `/documents/${id}/shares`],
      ["DELETE", `/shares/${id}`],
      ["POST", "/themes"],
      ["PUT", `/themes/${id}/like`],
      ["POST", "/images"],
    ] as const;
    for (const [method, path] of writes) {
      const response = await call("stranger", method, path, {});
      expect([400, 401]).toContain(response.status);
    }
  });
});

describe("documents", () => {
  it("creates, lists, reads and saves a document with revision control", async () => {
    const document = await createDocument("north", "Quarterly plan", [
      "Goals",
      "Risks & <costs>",
    ]);
    expect(document["title"]).toBe("Quarterly plan");
    expect(document["revision"]).toBe(1);
    expect(document["slides"]).toHaveLength(2);
    expect(document["slides"][1].sourceXml).toContain(
      "Risks &amp; &lt;costs&gt;",
    );

    const list = await call("north", "GET", "/documents");
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: document["id"],
          title: "Quarterly plan",
          slideCount: 2,
          favorite: false,
        }),
      ]),
    );

    const saved = await call("north", "PATCH", `/documents/${document["id"]}`, {
      title: "Quarterly plan v2",
      outline: ["Goals"],
      settings: { fontSize: "large" },
      themeId: null,
      expectedRevision: 1,
    });
    expect(saved).toEqual({ status: 200, body: { revision: 2 } });
    const reread = await call("north", "GET", `/documents/${document["id"]}`);
    expect(reread.body).toMatchObject({
      title: "Quarterly plan v2",
      revision: 2,
      outline: ["Goals"],
      settings: { fontSize: "large" },
    });

    const theme = await call("north", "POST", "/themes", {
      name: "Applied",
      definition: {},
    });
    await call("north", "PATCH", `/documents/${document["id"]}`, {
      themeId: theme.body!["id"],
      expectedRevision: 2,
    });
    expect(
      (await call("north", "GET", `/documents/${document["id"]}`)).body,
    ).toMatchObject({
      themeId: theme.body!["id"],
      revision: 3,
      title: "Quarterly plan v2",
      outline: ["Goals"],
      settings: { fontSize: "large" },
    });

    const stale = await call("north", "PATCH", `/documents/${document["id"]}`, {
      title: "Lost update",
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({
      error: "The presentation changed since it was loaded.",
    });
  });

  it("returns the same document for a repeated create idempotency key", async () => {
    const body = { title: "Once", idempotencyKey: "retry-key-0001" };
    const first = await call("north", "POST", "/documents", body);
    const second = await call("north", "POST", "/documents", body);
    expect(second.body).toEqual(first.body);
  });

  it("rejects invalid input and unknown documents", async () => {
    expect(
      (
        await call("north", "POST", "/documents", {
          title: "",
          idempotencyKey: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "north",
          "PATCH",
          "/documents/00000000-0000-4000-8000-000000000000",
          {
            expectedRevision: 0,
          },
        )
      ).status,
    ).toBe(400);
    const missing = await call(
      "north",
      "GET",
      "/documents/00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toEqual({ status: 404, body: { error: "Not found" } });
  });

  it("rejects an unknown theme as a bad request, not an authentication failure", async () => {
    const unknownTheme = "00000000-0000-4000-8000-0000000000aa";
    const badTheme = { status: 400, body: { error: "Theme not found." } };
    expect(
      await call("north", "POST", "/documents", {
        title: "Unthemed",
        themeId: unknownTheme,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toEqual(badTheme);
    const document = await createDocument("north", "Retheme me");
    expect(
      await call("north", "PATCH", `/documents/${document["id"]}`, {
        themeId: unknownTheme,
        expectedRevision: document["revision"],
      }),
    ).toEqual(badTheme);
    // The refused save left the document untouched.
    expect(
      (await call("north", "GET", `/documents/${document["id"]}`)).body,
    ).toMatchObject({ revision: document["revision"], themeId: null });
    // A body that is not JSON is equally a bad request.
    for (const [method, path] of [
      ["POST", "/presentation/v1/documents?tenant=north"],
      ["PATCH", `/presentation/v1/documents/${document["id"]}?tenant=north`],
    ] as const) {
      const response = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(response.status).toBe(400);
    }
  });

  it("hides one tenant's documents from another tenant", async () => {
    const document = await createDocument("north", "North only", ["A", "B"]);
    const id = document["id"];
    const slideId = document["slides"][0].id;

    expect((await call("south", "GET", `/documents/${id}`)).status).toBe(404);
    expect(
      (await call("south", "GET", "/documents")).body!.map(
        (row: Json) => row.id,
      ),
    ).not.toContain(id);
    expect(
      (
        await call("south", "PATCH", `/documents/${id}`, {
          title: "Hijacked",
          expectedRevision: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("south", "POST", `/documents/${id}/duplicate`)).status,
    ).toBe(400);
    expect(
      (await call("south", "POST", `/documents/${id}/shares`, {})).status,
    ).toBe(404);
    expect(
      (
        await call("south", "PUT", `/documents/${id}/slides`, {
          id: slideId,
          position: 0,
          sourceXml: "<SECTION><H1>Hijacked</H1></SECTION>",
          revision: 1,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await call("south", "DELETE", `/documents/${id}/slides/${slideId}`))
        .status,
    ).toBe(400);
    await call("south", "DELETE", `/documents/${id}`);

    const intact = await call("north", "GET", `/documents/${id}`);
    expect(intact.body).toMatchObject({ title: "North only", revision: 1 });
    expect(intact.body!["slides"][0].sourceXml).toContain("<H1>A</H1>");
  });

  it("soft-deletes a document so it no longer lists or opens", async () => {
    const document = await createDocument("north", "Short lived");
    const removed = await call(
      "north",
      "DELETE",
      `/documents/${document["id"]}`,
    );
    expect(removed.status).toBe(204);
    expect(
      (await call("north", "GET", `/documents/${document["id"]}`)).status,
    ).toBe(404);
    expect(
      (await call("north", "GET", "/documents")).body!.map(
        (row: Json) => row.id,
      ),
    ).not.toContain(document["id"]);
  });

  it("duplicates a document with its slides and refuses an unknown source", async () => {
    const document = await createDocument("north", "Original", ["One", "Two"]);
    const copy = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/duplicate`,
    );
    expect(copy.status).toBe(201);
    const reread = await call("north", "GET", `/documents/${copy.body!["id"]}`);
    expect(reread.body).toMatchObject({ title: "Original copy" });
    expect(reread.body!["slides"].map((s: Json) => s.sourceXml)).toEqual(
      document["slides"].map((s: Json) => s.sourceXml),
    );
    expect(
      (
        await call(
          "north",
          "POST",
          "/documents/00000000-0000-4000-8000-000000000000/duplicate",
        )
      ).status,
    ).toBe(400);
  });

  it("toggles a favorite per user", async () => {
    const document = await createDocument("north", "Starred");
    const path = `/documents/${document["id"]}/favorite`;
    expect((await call("north", "PUT", path, { enabled: true })).status).toBe(
      204,
    );
    expect((await call("north", "PUT", path, { enabled: true })).status).toBe(
      204,
    );
    const listed = await call("north", "GET", "/documents");
    expect(
      listed.body!.find((row: Json) => row.id === document["id"]).favorite,
    ).toBe(true);
    expect(
      (await call("north", "GET", `/documents/${document["id"]}`)).body![
        "favorite"
      ],
    ).toBe(true);
    expect((await call("north", "PUT", path, { enabled: false })).status).toBe(
      204,
    );
    expect(
      (await call("north", "GET", `/documents/${document["id"]}`)).body![
        "favorite"
      ],
    ).toBe(false);
    expect((await call("north", "PUT", path, { enabled: "yes" })).status).toBe(
      400,
    );
  });
});

describe("slides", () => {
  it("adds, edits, reorders and deletes slides keeping positions contiguous", async () => {
    const document = await createDocument("north", "Slides", ["A", "B", "C"]);
    const id = document["id"];
    const [a, b, c] = document["slides"] as Array<{
      id: string;
      revision: number;
    }>;

    const added = await call("north", "PUT", `/documents/${id}/slides`, {
      position: 3,
      sourceXml: "<SECTION><H1>D</H1></SECTION>",
    });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ revision: 1 });

    const edited = await call("north", "PUT", `/documents/${id}/slides`, {
      id: a!.id,
      position: 0,
      sourceXml: "<SECTION><H1>A2</H1></SECTION>",
      content: { note: "x" },
      revision: 1,
    });
    expect(edited.body).toEqual({ id: a!.id, revision: 2 });

    const conflict = await call("north", "PUT", `/documents/${id}/slides`, {
      id: a!.id,
      position: 0,
      sourceXml: "<SECTION><H1>stale</H1></SECTION>",
      revision: 1,
    });
    expect(conflict.status).toBe(409);

    expect(
      (await call("north", "PUT", `/documents/${id}/slides`, { position: -1 }))
        .status,
    ).toBe(400);

    expect(
      (
        await call("north", "PATCH", `/documents/${id}/slides/${c!.id}`, {
          position: 0,
        })
      ).status,
    ).toBe(204);
    let reread = (await call("north", "GET", `/documents/${id}`)).body!;
    expect(reread["slides"].map((s: Json) => s.id).slice(0, 3)).toEqual([
      c!.id,
      a!.id,
      b!.id,
    ]);
    expect(reread["slides"].map((s: Json) => s.position)).toEqual([0, 1, 2, 3]);
    expect(reread["revision"]).toBe(2);

    expect(
      (
        await call("north", "PATCH", `/documents/${id}/slides/${c!.id}`, {
          position: 9,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "north",
          "PATCH",
          `/documents/${id}/slides/00000000-0000-4000-8000-000000000000`,
          { position: 0 },
        )
      ).status,
    ).toBe(400);

    expect(
      (await call("north", "DELETE", `/documents/${id}/slides/${c!.id}`))
        .status,
    ).toBe(204);
    reread = (await call("north", "GET", `/documents/${id}`)).body!;
    expect(reread["slides"].map((s: Json) => s.position)).toEqual([0, 1, 2]);
    expect(reread["slides"].map((s: Json) => s.id)).not.toContain(c!.id);
    expect(
      (await call("north", "DELETE", `/documents/${id}/slides/${c!.id}`))
        .status,
    ).toBe(400);
  });
});

describe("themes", () => {
  it("creates themes and records per-user favorite and like reactions", async () => {
    const created = await call("north", "POST", "/themes", {
      name: "Sunrise",
      definition: { background: "#ffeecc", text: "#221100" },
    });
    expect(created.status).toBe(201);
    const id = created.body!["id"];

    for (const reaction of ["favorite", "like"] as const) {
      expect(
        (
          await call("north", "PUT", `/themes/${id}/${reaction}`, {
            enabled: true,
          })
        ).status,
      ).toBe(204);
    }
    let theme = (await call("north", "GET", "/themes")).body!.find(
      (t: Json) => t.id === id,
    );
    expect(theme).toMatchObject({
      name: "Sunrise",
      description: "",
      builtIn: false,
      favorite: true,
      liked: true,
    });
    for (const reaction of ["favorite", "like"] as const) {
      await call("north", "PUT", `/themes/${id}/${reaction}`, {
        enabled: false,
      });
    }
    theme = (await call("north", "GET", "/themes")).body!.find(
      (t: Json) => t.id === id,
    );
    expect(theme).toMatchObject({ favorite: false, liked: false });

    expect(
      (await call("south", "GET", "/themes")).body!.map((t: Json) => t.id),
    ).not.toContain(id);
    expect(
      (await call("north", "PUT", `/themes/${id}/love`, { enabled: true }))
        .status,
    ).toBe(400);
    expect((await call("north", "POST", "/themes", { name: "" })).status).toBe(
      400,
    );
  });

  it("imports a real PowerPoint file's theme once per import id", async () => {
    const pptx = new PptxGenJS();
    pptx.addSlide().addText("Hello", { x: 1, y: 1 });
    const bytes = (await pptx.write({
      outputType: "uint8array",
    })) as Uint8Array;
    const fileBase64 = Buffer.from(bytes).toString("base64");

    const first = await call("north", "POST", "/themes/import", {
      name: "Board deck",
      fileBase64,
      sourceImportId: "import-board-1",
    });
    expect(first.status).toBe(201);
    expect(first.body!["theme"]).toMatchObject({
      name: "Board deck",
      definition: {
        fonts: { heading: expect.any(String), body: expect.any(String) },
      },
    });
    const again = await call("north", "POST", "/themes/import", {
      name: "Board deck renamed",
      fileBase64,
      sourceImportId: "import-board-1",
    });
    expect(again.body!["id"]).toBe(first.body!["id"]);
    const themes = (await call("north", "GET", "/themes")).body!;
    expect(themes.filter((t: Json) => t.id === first.body!["id"])).toHaveLength(
      1,
    );
    expect(themes.find((t: Json) => t.id === first.body!["id"]).name).toBe(
      "Board deck renamed",
    );
  });

  it("refuses files that are not a PowerPoint theme", async () => {
    const noTheme = Buffer.from(
      await new JSZip()
        .file("hello.txt", "hi")
        .generateAsync({ type: "uint8array" }),
    ).toString("base64");
    const refused = await call("north", "POST", "/themes/import", {
      name: "Nope",
      fileBase64: noTheme,
      sourceImportId: "import-nope",
    });
    expect(refused).toEqual({
      status: 400,
      body: { error: "The PowerPoint file could not be read as a theme." },
    });
    const garbage = await call("north", "POST", "/themes/import", {
      name: "Nope",
      fileBase64: Buffer.from(
        "this is not a zip archive at all, sorry",
      ).toString("base64"),
      sourceImportId: "import-garbage",
    });
    expect(garbage.status).toBe(400);
    expect(garbage.body!["error"]).toEqual(expect.any(String));
    const invalid = await call("north", "POST", "/themes/import", {
      name: "x",
    });
    expect(invalid.body).toEqual({ error: "Invalid PowerPoint theme upload." });
    const stranger = await call("stranger", "POST", "/themes/import", {
      name: "Nope",
      fileBase64: noTheme,
      sourceImportId: "import-stranger",
    });
    expect(stranger.status).toBe(400);
  });
});

describe("images and recordings", () => {
  it("stores uploaded images for their owner and refuses unsafe references", async () => {
    const saved = await call("north", "POST", "/images", {
      assetReference: PNG,
      metadata: { name: "dot" },
    });
    expect(saved.status).toBe(201);
    const remote = await call("north", "POST", "/images", {
      assetReference: "https://cdn.example.test/a.png",
      mimeType: "image/jpeg",
    });
    expect(remote.status).toBe(201);
    const images = (await call("north", "GET", "/images")).body!;
    expect(images.find((i: Json) => i.id === saved.body!["id"])).toMatchObject({
      assetReference: PNG,
      providerId: "upload",
      modelId: "user-upload",
      metadata: { name: "dot", mimeType: "image/png" },
    });
    expect(
      images.find((i: Json) => i.id === remote.body!["id"]).metadata,
    ).toMatchObject({
      mimeType: "image/jpeg",
    });
    expect((await call("south", "GET", "/images")).body).toEqual([]);

    for (const assetReference of [
      "http://localhost/a.png",
      "ftp://example.test/a.png",
      "not a url",
    ]) {
      expect(
        (await call("north", "POST", "/images", { assetReference })).body,
      ).toEqual({ error: "Unable to save image." });
    }
    expect((await call("north", "POST", "/images", {})).body).toEqual({
      error: "Invalid image upload.",
    });
  });

  it("records and lists recordings of a document for their owner only", async () => {
    const document = await createDocument("north", "Rehearsal");
    const path = `/documents/${document["id"]}/recordings`;
    const saved = await call("north", "POST", path, {
      assetReference: "recording://take-1",
      metadata: { seconds: 12 },
    });
    expect(saved.status).toBe(201);
    const listed = await call("north", "GET", path);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: saved.body!["id"],
        assetReference: "recording://take-1",
        metadata: { seconds: 12 },
      }),
    ]);
    expect((await call("north", "POST", path, {})).body).toEqual({
      error: "Invalid recording.",
    });
    expect((await call("south", "GET", path)).body).toEqual([]);
    expect(
      (await call("south", "POST", path, { assetReference: "recording://x" }))
        .status,
    ).toBe(404);
  });
});

// The text of every message of one role that reached the model.
function textsOf(call: { input: ModelInput }, role: string): string[] {
  return call.input.messages
    .filter((message) => message.role === role)
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []));
}

// Who the engine was told is asking: the member of the tenant, in this product.
function askedBy(tenant: string) {
  const context = contexts.get(tenant)!;
  return {
    scope: {
      tenantId: context.tenant.id,
      actorId: context.user.id,
      productId: "omnitech.presentation",
    },
    permissions: context.permissions,
  };
}

async function recordedImages(): Promise<
  { id: string; prompt_reference: string }[]
> {
  const result = await pg.owner.query<{ id: string; prompt_reference: string }>(
    "SELECT id, prompt_reference FROM presentation.generated_images",
  );
  return result.rows;
}

describe("AI generation", () => {
  it("answers 503 on every AI route when no engine is configured", async () => {
    for (const [method, path] of [
      ["POST", "/generate/outline"],
      ["POST", "/images/generate"],
      ["POST", "/documents/x/slides/generate"],
    ] as const) {
      const response = await call("north", method, path, {}, appWithoutAi);
      expect(response).toEqual({
        status: 503,
        body: { error: "AI is not configured." },
      });
    }
  });

  it("builds the outline prompt from every supplied option", async () => {
    modelCalls.length = 0;
    nextAiResult = { title: "T", outline: ["a"] };
    const response = await call("north", "POST", "/generate/outline", {
      prompt: "Pitch our garden",
      profileId: "fast",
      slideCount: 5,
      language: "French",
      textContent: "Brief",
      tone: "Playful",
      audience: "Investors",
      scenario: "Demo day",
      layout: "narrative",
    });
    expect(response).toEqual({ status: 200, body: { result: nextAiResult } });
    const request = modelCalls[0]!;
    expect(request.input.profileId).toBe("fast");
    expect(request.scope).toMatchObject({ productId: "omnitech.presentation" });
    expect(request.input.schema).toMatchObject({
      required: ["title", "outline"],
    });
    expect(textsOf(request, "user")).toEqual([
      [
        "Pitch our garden",
        "Create an outline for exactly 5 slides.",
        "Write the outline in French.",
        "Use Brief text content.",
        "Tone: Playful.",
        "Audience: Investors.",
        "Scenario: Demo day.",
        "Use a narrative presentation structure.",
      ].join("\n\n"),
    ]);
  });

  it("omits automatic options from the outline prompt", async () => {
    modelCalls.length = 0;
    nextAiResult = { title: "T", outline: ["a"] };
    await call("north", "POST", "/generate/outline", {
      prompt: "Just this",
      profileId: "fast",
      tone: "Auto",
      audience: "Auto",
      scenario: "Auto",
    });
    expect(textsOf(modelCalls[0]!, "user")).toEqual(["Just this"]);
  });

  it("rejects invalid generation requests and reports engine failures as 502", async () => {
    expect(
      (await call("north", "POST", "/generate/outline", { prompt: "" })).body,
    ).toEqual({
      error: "Invalid generation request.",
    });
    expect(
      (
        await call("north", "POST", "/generate/outline", {
          prompt: "x",
          profileId: "p",
          slideCount: 0,
        })
      ).body,
    ).toEqual({ error: "Invalid generation request." });
    aiFailure = new Error("model overloaded");
    try {
      expect(
        await call("north", "POST", "/generate/outline", {
          prompt: "x",
          profileId: "p",
        }),
      ).toEqual({ status: 502, body: { error: "Generation failed." } });
      aiFailure = "boom";
      expect(
        (
          await call("north", "POST", "/generate/outline", {
            prompt: "x",
            profileId: "p",
          })
        ).body,
      ).toEqual({ error: "Generation failed." });
    } finally {
      aiFailure = undefined;
    }
  });

  it("answers a refused or unknown profile with the same 502 and never asks the model", async () => {
    modelCalls.length = 0;
    nextAiResult = { title: "T", outline: ["a"] };
    const refused = await call("viewer", "POST", "/generate/outline", {
      prompt: "x",
      profileId: "members-only",
    });
    expect(refused).toEqual({
      status: 502,
      body: { error: "Generation failed." },
    });
    const unknown = await call("north", "POST", "/generate/outline", {
      prompt: "x",
      profileId: "no-such-profile",
    });
    expect(unknown).toEqual({
      status: 502,
      body: { error: "Generation failed." },
    });
    expect(modelCalls).toHaveLength(0);
  });

  it("gives the engine the member's tenant, user and permissions, and the request's own signal", async () => {
    authorized.length = 0;
    nextAiResult = { title: "T", outline: ["a"] };
    const cancel = new AbortController();
    const response = await app.request(
      "/presentation/v1/generate/outline?tenant=north",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "x", profileId: "fast" }),
        signal: cancel.signal,
      },
    );
    expect(response.status).toBe(200);
    const execution = authorized.at(-1)!;
    expect(execution).toMatchObject(askedBy("north"));
    // Cancelling the request is what cancels the engine's call.
    expect(execution.signal.aborted).toBe(false);
    cancel.abort();
    expect(execution.signal.aborted).toBe(true);

    await call("viewer", "POST", "/generate/outline", {
      prompt: "x",
      profileId: "fast",
    });
    expect(authorized.at(-1)).toMatchObject(askedBy("viewer"));
    expect(authorized.at(-1)!.permissions).toEqual([]);
  });

  it("generates a single slide at the requested position", async () => {
    modelCalls.length = 0;
    authorized.length = 0;
    nextAiResult = { sourceXml: "<SECTION><H1>New</H1></SECTION>" };
    const path =
      "/documents/00000000-0000-4000-8000-000000000000/slides/generate";
    const withPosition = await call("north", "POST", path, {
      prompt: "A slide",
      profileId: "fast",
      position: 2,
    });
    expect(withPosition).toEqual({
      status: 201,
      body: { result: nextAiResult, position: 2 },
    });
    expect(textsOf(modelCalls[0]!, "user")).toEqual(["A slide"]);
    expect(modelCalls[0]!.input.schema).toMatchObject({
      required: ["sourceXml"],
    });
    expect(authorized.at(-1)).toMatchObject(askedBy("north"));
    const defaulted = await call("north", "POST", path, {
      prompt: "A slide",
      profileId: "fast",
    });
    expect(defaulted.body).toEqual({ result: nextAiResult, position: 0 });
    expect((await call("north", "POST", path, {})).body).toEqual({
      error: "Invalid slide generation request.",
    });
    aiFailure = new Error("slide failed");
    try {
      expect(
        await call("north", "POST", path, { prompt: "x", profileId: "p" }),
      ).toEqual({
        status: 502,
        body: { error: "Slide generation failed." },
      });
      aiFailure = 1;
      expect(
        (await call("north", "POST", path, { prompt: "x", profileId: "p" }))
          .body,
      ).toEqual({
        error: "Slide generation failed.",
      });
    } finally {
      aiFailure = undefined;
    }
  });

  it("generates an image, records its provenance and lists it", async () => {
    imageCalls.length = 0;
    authorized.length = 0;
    nextImage = {
      assetReference: PNG,
      mimeType: "image/png",
      providerId: "openai",
      modelId: "image-1",
      provenance: { seed: 7 },
    };
    const response = await call("north", "POST", "/images/generate", {
      prompt: "A garden",
      profileId: "images",
      aspectRatio: "16:9",
      modelId: "image-1",
    });
    expect(response).toEqual({
      status: 200,
      body: { imageId: expect.any(String) },
    });
    expect(imageCalls[0]!.request).toEqual({
      profileId: "images",
      prompt: "A garden",
      aspectRatio: "16:9",
      modelId: "image-1",
    });
    expect(imageCalls[0]!.scope).toMatchObject({
      productId: "omnitech.presentation",
    });
    expect(authorized.at(-1)).toMatchObject(askedBy("north"));
    const listed = (await call("north", "GET", "/images")).body!;
    const recorded = listed.find(
      (i: Json) => i.id === response.body!["imageId"],
    );
    expect(recorded).toMatchObject({
      assetReference: PNG,
      providerId: "openai",
      modelId: "image-1",
      metadata: { seed: 7 },
    });

    await call("north", "POST", "/images/generate", {
      prompt: "bare",
      profileId: "images",
    });
    expect(imageCalls[1]!.request).toEqual({
      profileId: "images",
      prompt: "bare",
    });
  });

  it("stores a generated image under the trace the engine made it in", async () => {
    nextImage = {
      assetReference: PNG,
      mimeType: "image/png",
      providerId: "openai",
      modelId: "image-1",
      provenance: {},
    };
    const promptReferenceOf = async (imageId: string) =>
      (await recordedImages()).find((image) => image.id === imageId)
        ?.prompt_reference;

    // The request names no trace: one is made for the call.
    authorized.length = 0;
    const made = await call("north", "POST", "/images/generate", {
      prompt: "x",
      profileId: "images",
    });
    const madeTraceId = authorized.at(-1)!.traceId;
    expect(madeTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(await promptReferenceOf(made.body!["imageId"])).toBe(
      `run:${madeTraceId}`,
    );

    // The request's own trace is the one used.
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const traced = await call(
      "north",
      "POST",
      "/images/generate",
      { prompt: "x", profileId: "images" },
      app,
      { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    );
    expect(authorized.at(-1)!.traceId).toBe(traceId);
    expect(await promptReferenceOf(traced.body!["imageId"])).toBe(
      `run:${traceId}`,
    );
  });

  it("refuses an image model id that could steer a provider URL", async () => {
    imageCalls.length = 0;
    for (const modelId of [
      "../admin",
      "/etc/passwd",
      "https://evil.example/x",
      "fal-ai/../../x",
      "a?b=c",
      "m".repeat(101),
    ]) {
      const refused = await call("north", "POST", "/images/generate", {
        prompt: "x",
        profileId: "images",
        modelId,
      });
      expect(refused.status).toBe(400);
    }
    expect(imageCalls).toHaveLength(0);
  });

  it("accepts a generated image by URL or data URL, refuses any other reference, and records nothing it refuses", async () => {
    const generate = (profileId = "images") =>
      call("north", "POST", "/images/generate", { prompt: "x", profileId });
    const made = {
      mimeType: "image/png",
      providerId: "openai",
      modelId: "m",
      provenance: {},
    };
    for (const assetReference of [
      PNG,
      "https://cdn.example.test/a.png",
      "http://cdn.example.test/a.png",
    ]) {
      nextImage = { ...made, assetReference };
      expect((await generate()).status).toBe(200);
    }

    const before = (await recordedImages()).length;
    for (const assetReference of [
      "not a url",
      "ftp://example.test/a.png",
      "data:text/html,<p>x</p>",
      "/tmp/a.png",
    ]) {
      nextImage = { ...made, assetReference };
      expect(await generate()).toEqual({
        status: 502,
        body: {
          error: "Image assets must use an HTTP(S) URL or image data URL.",
        },
      });
    }
    expect(
      (await call("north", "POST", "/images/generate", { prompt: "" })).body,
    ).toEqual({ error: "Invalid image request." });
    nextImage = { ...made, assetReference: PNG };
    aiFailure = 1;
    try {
      expect(await generate("i")).toEqual({
        status: 502,
        body: { error: "Image generation failed." },
      });
    } finally {
      aiFailure = undefined;
    }
    expect(await recordedImages()).toHaveLength(before);
  });
});

describe("sharing", () => {
  it("opens a shared document by token without a tenant until it is revoked", async () => {
    const document = await createDocument("north", "Public plan", ["Intro"]);
    const share = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/shares`,
      {},
    );
    expect(share.status).toBe(201);
    const token = share.body!["token"];

    const shared = await app.request(`/presentation/v1/shared/${token}`);
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({
      id: document["id"],
      title: "Public plan",
      favorite: false,
    });

    expect(
      (await call("south", "DELETE", `/shares/${share.body!["id"]}`)).status,
    ).toBe(204);
    expect((await app.request(`/presentation/v1/shared/${token}`)).status).toBe(
      200,
    );
    expect(
      (await call("north", "DELETE", `/shares/${share.body!["id"]}`)).status,
    ).toBe(204);
    const revoked = await app.request(`/presentation/v1/shared/${token}`);
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toEqual({
      error: "Share not found or expired.",
    });
  });

  it("stops serving a share when it expires or its document is deleted", async () => {
    const expiring = await createDocument("north", "Expiring");
    const expiringShare = await call(
      "north",
      "POST",
      `/documents/${expiring["id"]}/shares`,
      {},
    );
    await pg.owner.query(
      "UPDATE presentation.shares SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [expiringShare.body!["id"]],
    );
    expect(
      (
        await app.request(
          `/presentation/v1/shared/${expiringShare.body!["token"]}`,
        )
      ).status,
    ).toBe(404);

    const doomed = await createDocument("north", "Doomed");
    const doomedShare = await call(
      "north",
      "POST",
      `/documents/${doomed["id"]}/shares`,
      {},
    );
    await call("north", "DELETE", `/documents/${doomed["id"]}`);
    expect(
      (
        await app.request(
          `/presentation/v1/shared/${doomedShare.body!["token"]}`,
        )
      ).status,
    ).toBe(404);
  });

  it("refuses shares, recordings and exports for deleted or unknown documents", async () => {
    const deleted = await createDocument("north", "Deleted deck");
    const existing = await call(
      "north",
      "POST",
      `/documents/${deleted["id"]}/shares`,
      {},
    );
    expect(existing.status).toBe(201);
    expect(
      (await call("north", "DELETE", `/documents/${deleted["id"]}`)).status,
    ).toBe(204);

    const notFound = { status: 404, body: { error: "Not found" } };
    for (const id of [deleted["id"], "00000000-0000-4000-8000-000000000000"]) {
      expect(
        await call("north", "POST", `/documents/${id}/shares`, {}),
      ).toEqual(notFound);
      expect(
        await call("north", "POST", `/documents/${id}/recordings`, {
          assetReference: "recording://late",
        }),
      ).toEqual(notFound);
      expect(
        await call("north", "POST", `/documents/${id}/exports`, {
          format: "pdf",
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toEqual(notFound);
    }
    // Another tenant's document is as unknown as a missing one.
    const northOnly = await createDocument("north", "North deck");
    expect(
      await call("south", "POST", `/documents/${northOnly["id"]}/shares`, {}),
    ).toEqual(notFound);

    // Nothing was written against the deleted document after its deletion.
    const written = await pg.owner.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM presentation.shares WHERE document_id = $1)
            + (SELECT count(*) FROM presentation.recordings WHERE document_id = $1)
            + (SELECT count(*) FROM presentation.exports WHERE document_id = $1)
         AS count`,
      [deleted["id"]],
    );
    expect(Number(written.rows[0]!.count)).toBe(1);
    // The share made before the deletion no longer resolves.
    expect(
      (await app.request(`/presentation/v1/shared/${existing.body!["token"]}`))
        .status,
    ).toBe(404);
  });

  it("rejects malformed tokens and members without the share permission", async () => {
    const malformed = await app.request("/presentation/v1/shared/short");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid share token." });
    const document = await createDocument("north", "Private");
    const forbidden = await call(
      "viewer",
      "POST",
      `/documents/${document["id"]}/shares`,
      {},
    );
    expect(forbidden).toEqual({ status: 403, body: { error: "Forbidden" } });
    expect((await call("north", "GET", "/documents")).status).toBe(200);
  });
});

describe("exports", () => {
  it("exports a PPTX whose slides match the document", async () => {
    const document = await createDocument("north", "Export me", [
      "Alpha",
      "Beta",
    ]);
    const exported = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/exports`,
      {
        format: "pptx",
        idempotencyKey: "export-key-0001",
      },
    );
    expect(exported.status).toBe(201);
    expect(exported.body!["status"]).toBe("succeeded");
    const zip = await JSZip.loadAsync(
      Buffer.from(
        String(exported.body!["assetReference"]).split(",")[1]!,
        "base64",
      ),
    );
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain(
      "Alpha",
    );
    expect(await zip.file("ppt/slides/slide2.xml")!.async("string")).toContain(
      "Beta",
    );

    const persisted = await pg.owner.query(
      "SELECT status, format FROM presentation.exports WHERE id = $1",
      [exported.body!["id"]],
    );
    expect(persisted.rows).toEqual([{ status: "succeeded", format: "pptx" }]);

    const retried = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/exports`,
      {
        format: "pptx",
        idempotencyKey: "export-key-0001",
      },
    );
    expect(retried.body!["id"]).toBe(exported.body!["id"]);
  });

  it("exports a PDF with one page per slide", async () => {
    const document = await createDocument("north", "PDF me", [
      "One",
      "Two",
      "Three",
    ]);
    const exported = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/exports`,
      {
        format: "pdf",
        idempotencyKey: "export-key-0002",
      },
    );
    const pdf = await PDFDocument.load(
      Buffer.from(
        String(exported.body!["assetReference"]).split(",")[1]!,
        "base64",
      ),
    );
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toBe("PDF me");
  });

  it("refuses unknown documents, bad formats and unexportable content", async () => {
    const missing = await call(
      "north",
      "POST",
      "/documents/00000000-0000-4000-8000-000000000000/exports",
      { format: "pdf", idempotencyKey: "export-key-0003" },
    );
    expect(missing.status).toBe(404);
    const document = await createDocument("north", "Remote image");
    expect(
      (
        await call("north", "POST", `/documents/${document["id"]}/exports`, {
          format: "docx",
          idempotencyKey: "export-key-0004",
        })
      ).status,
    ).toBe(400);
    await call("north", "PUT", `/documents/${document["id"]}/slides`, {
      id: document["slides"][0].id,
      position: 0,
      sourceXml: '<SECTION><IMG url="https://example.test/a.png" /></SECTION>',
      revision: 1,
    });
    const refused = await call(
      "north",
      "POST",
      `/documents/${document["id"]}/exports`,
      {
        format: "pptx",
        idempotencyKey: "export-key-0005",
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.body!["error"]).toContain("Upload PNG or JPEG");
    await call("north", "DELETE", `/documents/${document["id"]}`);
    expect(
      (
        await call("north", "POST", `/documents/${document["id"]}/exports`, {
          format: "pdf",
          idempotencyKey: "export-key-0007",
        })
      ).body,
    ).toEqual({ error: "Not found" });
    const other = await call(
      "south",
      "POST",
      `/documents/${document["id"]}/exports`,
      {
        format: "pdf",
        idempotencyKey: "export-key-0006",
      },
    );
    expect(other.status).toBe(404);
  });
});

describe("cross-tenant references", () => {
  it("refuses to favorite, theme or export another tenant's records", async () => {
    const document = await createDocument("north", "North secrets", ["A"]);
    const northTheme = await call("north", "POST", "/themes", {
      name: "North brand",
      definition: { background: "#000000" },
    });
    const themeId = northTheme.body!["id"];

    expect(
      (
        await call("south", "PUT", `/documents/${document["id"]}/favorite`, {
          enabled: true,
        })
      ).status,
    ).toBe(400);
    for (const reaction of ["favorite", "like"] as const) {
      expect(
        (
          await call("south", "PUT", `/themes/${themeId}/${reaction}`, {
            enabled: true,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call("south", "POST", "/documents", {
          title: "Borrowed theme",
          themeId,
          idempotencyKey: crypto.randomUUID(),
        })
      ).status,
    ).not.toBe(201);
    const own = await createDocument("south", "South deck");
    expect(
      (
        await call("south", "PATCH", `/documents/${own["id"]}`, {
          themeId,
          expectedRevision: own["revision"],
        })
      ).status,
    ).not.toBe(200);

    const exported = await call(
      "south",
      "POST",
      `/documents/${document["id"]}/exports`,
      { format: "pdf", idempotencyKey: "cross-tenant-export" },
    );
    expect(exported).toEqual({ status: 404, body: { error: "Not found" } });

    // No row of another tenant may point at north's records.
    const stray = await pg.owner.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM presentation.document_favorites WHERE document_id = $1 AND tenant_id <> d.tenant_id)
            + (SELECT count(*) FROM presentation.exports WHERE document_id = $1 AND tenant_id <> d.tenant_id)
            + (SELECT count(*) FROM presentation.theme_favorites WHERE theme_id = $2)
            + (SELECT count(*) FROM presentation.theme_likes WHERE theme_id = $2)
            + (SELECT count(*) FROM presentation.presentations WHERE theme_id = $2) AS count
         FROM presentation.documents d WHERE d.id = $1`,
      [document["id"], themeId],
    );
    expect(Number(stray.rows[0]!.count)).toBe(0);
  });

  it("still applies a built-in theme and the tenant's own theme", async () => {
    const themes = (await call("south", "GET", "/themes")).body as Json[];
    const builtIn = themes.find((theme) => theme.builtIn);
    const own = await call("south", "POST", "/themes", {
      name: "South brand",
      definition: { background: "#ffffff" },
    });
    for (const themeId of [builtIn?.id, own.body!["id"]].filter(Boolean)) {
      const created = await call("south", "POST", "/documents", {
        title: "Themed",
        themeId,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(created.status).toBe(201);
      const document = await call(
        "south",
        "GET",
        `/documents/${created.body!["id"]}`,
      );
      expect(document.body!["themeId"]).toBe(themeId);
      expect(
        (
          await call("south", "PATCH", `/documents/${created.body!["id"]}`, {
            themeId,
            expectedRevision: document.body!["revision"],
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call("south", "PUT", `/themes/${themeId}/like`, {
            enabled: true,
          })
        ).status,
      ).toBe(204);
    }
  });
});

describe("request bounds and content-free failures", () => {
  it("refuses an oversize body by streamed size, ignoring content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"title":"'));
        controller.enqueue(new TextEncoder().encode("a".repeat(2_200_000)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const response = await app.request(
      "/presentation/v1/documents?tenant=north",
      {
        method: "POST",
        body: stream,
        duplex: "half",
        headers: { "content-length": "10", "content-type": "application/json" },
      } as RequestInit,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "The request is too large.",
    });
  });

  it("answers failures with fixed text and logs no request content", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    aiFailure = new Error("provider echoed SECRET-PROMPT-TEXT");
    try {
      const generation = await call("north", "POST", "/generate/outline", {
        prompt: "SECRET-PROMPT-TEXT",
        profileId: "p",
      });
      expect(generation).toEqual({
        status: 502,
        body: { error: "Generation failed." },
      });
      const exported = await call(
        "north",
        "POST",
        "/documents/not-a-uuid/exports",
        {
          format: "pptx",
          idempotencyKey: "SECRET-PROMPT-TEXT",
        },
      );
      expect(JSON.stringify(exported.body)).not.toContain("SECRET-PROMPT-TEXT");
      const badImage = await call("north", "POST", "/images/generate", {
        prompt: "x",
        profileId: "i",
      });
      expect(JSON.stringify(badImage.body)).not.toContain("SECRET-PROMPT-TEXT");
      expect(JSON.stringify(logged.mock.calls)).not.toContain(
        "SECRET-PROMPT-TEXT",
      );
      expect(logged).toHaveBeenCalled();
    } finally {
      aiFailure = undefined;
      logged.mockRestore();
    }
  });
});
