// The window follows the toolbar (QA issue 001): the toolbar sits in a `display: contents` wrapper,
// which has no box, so a ResizeObserver on the panel's rows never saw it grow and the real window
// stayed too narrow (the close dot was clipped). Measured in a real browser; jsdom lays nothing out.
import { expect, test } from "../src/fixtures/panel-test";

// QA issue 001 (bionic/inbox/redesign/native-qa-todo.md): the fix is not found yet; the test stays as the
// statement of the expected behaviour and runs again once it is.
test.fixme("@native native window re-fits when the toolbar grows wider than the window", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({
    auto: "off",
    viewport: { width: 1320, height: 820 },
  });
  // Leave one narrow pane so the toolbar, not the panes, decides the width.
  for (const name of ["Chat", "Answer"] as const)
    await page.getByRole("button", { name, exact: true }).click();
  const widthNow = async () =>
    Number((await host.calls("setWindowSize")).at(-1)?.params["width"]);
  await expect.poll(widthNow).toBeLessThan(900);

  // The toolbar gains a long label (an account chip, a device name).
  await page.locator(".pn-toolbar").evaluate((toolbar) => {
    (toolbar as HTMLElement).style.minWidth = "1100px";
  });
  // The toolbar really is that wide (the page's viewport is 1320).
  await expect
    .poll(() =>
      page
        .locator(".pn-toolbar")
        .evaluate((el) => (el as HTMLElement).offsetWidth),
    )
    .toBeGreaterThanOrEqual(1100);
  await expect.poll(widthNow).toBeGreaterThanOrEqual(1100);
});

test("@native native window keeps a margin around the toolbar, panels and footer so their rounded corners are not cropped", async ({
  openPanel,
}) => {
  const { page } = await openPanel({ viewport: { width: 1320, height: 820 } });
  const edges = await page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect();
    const toolbar = box(".pn-toolbar");
    const body = box(".pn-single-body");
    const foot = box(".pn-single-foot");
    return {
      top: toolbar?.top,
      left: body?.left,
      right: window.innerWidth - (body?.right ?? 0),
      bottom: window.innerHeight - (foot?.bottom ?? 0),
    };
  });
  for (const gap of Object.values(edges)) expect(gap).toBeGreaterThanOrEqual(8);
});
