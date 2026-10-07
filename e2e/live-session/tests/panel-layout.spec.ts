// The pane row (requirement M10), measured in a real browser: jsdom lays nothing out, and a wrapper that
// shrank the Code panel to its content passed every unit test. The transcript is 330 px (never under 300),
// the other visible panels share the rest equally and fill the row's height, and the row fills the window.
import { expect, test } from "../src/fixtures/panel-test";

type Box = { x: number; y: number; width: number; height: number };

for (const width of [900, 1180, 1320] as const)
  test(`@native native pane row at ${width} px: transcript 330, the others equal, every panel fills the row`, async ({
    openPanel,
  }) => {
    const { page } = await openPanel({ viewport: { width, height: 820 } });
    const rowBox = async (): Promise<Box> =>
      (await page.locator(".pn-single-body").boundingBox()) as Box;
    const panels = async (): Promise<Record<string, Box>> =>
      page.locator('[data-slot="panel"]').evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            const title =
              element.querySelector('[data-slot="panel-title"]')?.textContent ??
              "?";
            return [
              title,
              { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            ];
          }),
        ),
      );

    const all = await panels();
    const row = await rowBox();
    const chat = all["Transcript & chat"] as Box;
    const answer = all["Answer"] as Box;
    const code = all["Code"] as Box;
    expect(chat.width).toBeCloseTo(330, 0);
    expect(Math.abs(answer.width - code.width)).toBeLessThanOrEqual(1);
    for (const box of [chat, answer, code]) {
      expect(Math.abs(box.height - row.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y - row.y)).toBeLessThanOrEqual(1);
    }
    // The row fills the window: the last panel ends at the row's right edge.
    expect(
      Math.abs(code.x + code.width - (row.x + row.width)),
    ).toBeLessThanOrEqual(2);

    // Chat hidden: Answer and Code share the whole row equally.
    await page.getByTestId("pn-panes").getByRole("button").first().click();
    await expect(
      page.locator('[data-slot="panel-title"]', {
        hasText: "Transcript & chat",
      }),
    ).toHaveCount(0);
    const two = await panels();
    const a = two["Answer"] as Box;
    const c = two["Code"] as Box;
    expect(Math.abs(a.width - c.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.x + c.width - (row.x + row.width))).toBeLessThanOrEqual(
      2,
    );
    expect(Math.abs(c.height - row.height)).toBeLessThanOrEqual(2);
  });
