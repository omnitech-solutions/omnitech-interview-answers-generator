// An owner's pause and resume with a REAL companion over the real routes
// (dev loop 4 review, MUST-FIX 1). Studio pauses an active session when a
// heartbeat says capturing:false, so a companion that is paused by Studio must
// not say it, or the owner's next resume is undone by the following heartbeat.
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorld, type World } from "./world";

let world: World;
beforeAll(async () => {
  world = await startWorld(fixture);
}, 120_000);
afterAll(() => world?.stop());

const status = async (id: string) =>
  String(
    (
      await world.fx.owner.query(
        "SELECT status FROM interview.active_sessions WHERE id=$1",
        [id],
      )
    ).rows[0].status,
  );

describe("owner pause and resume with a running companion", () => {
  it("stays resumed after the companion's following heartbeats", async () => {
    const owner = await world.begin("pause-resume");
    const { companion, clock, open } = world.companion(owner);
    await open();
    world.as(owner.person);

    await world.send(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "pause",
    });
    await clock.advance(5_000);
    await companion.heartbeat();
    expect(await status(owner.id)).toBe("paused");
    expect(companion.snapshot().phase).toBe("paused");

    await world.send(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "resume",
    });
    for (let beat = 0; beat < 3; beat++) {
      await clock.advance(5_000);
      await companion.heartbeat();
    }
    expect(await status(owner.id)).toBe("active");
    expect(companion.snapshot().phase).toBe("listening");
  });
});
