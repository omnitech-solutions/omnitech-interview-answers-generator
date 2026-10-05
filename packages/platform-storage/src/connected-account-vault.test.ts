import { describe, expect, it } from "vitest";
import { ConnectedAccountVault } from "./connected-account-vault";

describe("ConnectedAccountVault", () => {
  it("round-trips a token without storing plaintext", () => {
    const vault = new ConnectedAccountVault("a".repeat(32));
    const encrypted = vault.encrypt("provider-token");
    expect(JSON.stringify(encrypted)).not.toContain("provider-token");
    expect(vault.decrypt(encrypted)).toBe("provider-token");
  });

  it("rejects short secrets", () => {
    expect(() => new ConnectedAccountVault("short")).toThrow(
      /at least 32 characters/,
    );
  });
});
