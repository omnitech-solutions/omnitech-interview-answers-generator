import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";

test("@smoke-native native smoke: panel toolbar, chat.focus and the window dots", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const panel = await native.open();
  await panel.goto({ panel: "single", handsFree: true, sessionId: id });

  // The toolbar renders from the real overlay route.
  const toolbar = panel.page.getByRole("toolbar", { name: "Session controls" });
  await expect(toolbar).toBeVisible();

  // chat.focus from the shell reaches the page and focuses the message box.
  const message = panel.page.getByRole("textbox", { name: "Message" });
  await expect(message).not.toBeFocused();
  await panel.host.fireIntent("chat.focus");
  await expect(message).toBeFocused();

  // The window dots render as one group: red Quit, yellow Hide, green Full
  // screen. What each does is proven in session-lifecycle-native.spec.ts.
  const dots = panel.page.getByRole("group", { name: "Window controls" });
  await expect(
    dots.getByRole("button", { name: "Quit Interview Studio" }),
  ).toBeEnabled();
  await expect(dots.getByRole("button", { name: "Hide window" })).toBeEnabled();
  await expect(
    dots.getByRole("button", { name: /^Full screen: click/ }),
  ).toBeEnabled();
});
