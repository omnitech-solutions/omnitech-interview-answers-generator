import { expect, test } from "../src/fixtures/test";
import { db } from "../src/helpers/sql";

test("@webkit web smoke: End with confirmation ends the session on the server and shows the ended view", async ({
  live,
  page,
}) => {
  await live.goto();
  const session = await live.startRehearsal();

  await live.end();

  await expect
    .poll(async () => (await db.session(session.id))?.status)
    .toBe("ended");
  // The ended view replaces the live controls: the bar's End button is gone and
  // the summary of the finished session is shown.
  await expect(live.sessionBar()).toBeHidden();
  await expect(
    page.getByRole("heading", { name: /^Session ended/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start another session" }),
  ).toBeVisible();
});
