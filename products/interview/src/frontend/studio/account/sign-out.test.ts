import { describe, expect, it, vi } from "vitest";

import { signedOutPath, signOutOfBrowser } from "./sign-out";

const json = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

describe("signOutOfBrowser", () => {
  it("fetches a CSRF token, then POSTs it to Auth.js's sign-out", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ csrfToken: "t0ken" }))
      .mockResolvedValueOnce(json({ url: "/signed-out" }));
    expect(await signOutOfBrowser(fetcher)).toEqual({ ok: true });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/auth/csrf");
    const [url, init] = fetcher.mock.calls[1] ?? [];
    expect(url).toBe("/api/auth/signout");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe(
      "csrfToken=t0ken&callbackUrl=%2Fsigned-out",
    );
  });

  it.each([
    ["the token request fails", [json({}, false)]],
    ["there is no token", [json({})]],
    ["sign-out is refused", [json({ csrfToken: "x" }), json({}, false)]],
  ])("fails when %s", async (_name, answers) => {
    const fetcher = vi.fn<typeof fetch>();
    for (const answer of answers) fetcher.mockResolvedValueOnce(answer);
    expect(await signOutOfBrowser(fetcher)).toEqual({ ok: false });
  });

  it("fails, never throws, when the network does", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    expect(await signOutOfBrowser(fetcher)).toEqual({ ok: false });
  });
});

it("tells the signed-out page whether it was a local user", () => {
  expect(signedOutPath("local")).toBe("/signed-out?as=local");
  expect(signedOutPath("account")).toBe("/signed-out");
});
