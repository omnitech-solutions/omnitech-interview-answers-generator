import { describe, expect, it } from "vitest";
import { normalizeVerifiedEmail } from "./index.js";

describe("presentation importer identity matching", () => {
  it("matches verified identities by normalized email", () => {
    expect(normalizeVerifiedEmail("  User@Example.COM ")).toBe(
      "user@example.com",
    );
  });
});
