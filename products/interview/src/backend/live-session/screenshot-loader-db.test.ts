// The screenshot loader's SQL join on a disposable PostgreSQL as the member
// role (requires Docker, like the other session suites): a stored snapshot is
// loaded by its provenance id for the owner's ACTIVE session only; a paused
// session is the retryable "closed" answer, and another owner's or another
// tenant's id is refused as not found (ADR-0016 Decision 3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  screenshot,
  startFixture,
} from "./live-session-fixture";
import { snapshotProvenanceId } from "./owner-input";
import { ActiveSessionRepository } from "./repository";
import {
  createSessionScreenshotLoader,
  type ScreenshotLoadError,
} from "./screenshot-loader";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

// A header-valid PNG: signature, IHDR (width x height), IEND.
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const owner = (tenantId: string, person: Person) => ({
  tenantId,
  actorId: person.id,
});
const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "loaded",
    (error) => (error as ScreenshotLoadError).code,
  );

async function seeded(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const bytes = png(640, 480);
  const ack = await ingestObservation(
    fx.member,
    started.credential.value,
    fx.tenantA,
    screenshot("scr", 0, "image/png", bytes.byteLength, "shot-1"),
    { payload: bytes },
  );
  expect(ack.status).toBe("accepted");
  const id = snapshotProvenanceId(started.session.id, "scr", "shot-1");
  return {
    person,
    scope,
    sessionId: started.session.id,
    bytes,
    attachment: {
      kind: "image" as const,
      id,
      name: "screenshot-1",
      reference: id,
    },
  };
}

describe("the database snapshot read", () => {
  it("loads the stored bytes for the owner's active session, then answers closed once paused", async () => {
    const world = await seeded("loader-owner");
    const load = createSessionScreenshotLoader(fx.member);
    const bytes = await load(
      owner(fx.tenantA, world.person),
      world.attachment,
      undefined,
    );
    expect(Buffer.from(bytes).equals(Buffer.from(world.bytes))).toBe(true);

    await repo.controlSession(world.scope, world.sessionId, "pause");
    expect(
      await codeOf(
        load(owner(fx.tenantA, world.person), world.attachment, undefined),
      ),
    ).toBe("session_closed");
  });

  it("refuses another owner's snapshot, in the same tenant and in another, as not found", async () => {
    const world = await seeded("loader-victim");
    const other = await fx.provision(fx.tenantA, "loader-other");
    const stranger = await fx.provision(fx.tenantB, "loader-stranger");
    const load = createSessionScreenshotLoader(fx.member);
    expect(
      await codeOf(load(owner(fx.tenantA, other), world.attachment, undefined)),
    ).toBe("not_found");
    expect(
      await codeOf(
        load(owner(fx.tenantB, stranger), world.attachment, undefined),
      ),
    ).toBe("not_found");
  });
});
