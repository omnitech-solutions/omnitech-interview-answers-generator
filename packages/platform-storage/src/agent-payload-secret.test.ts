import { describe, expect, it } from "vitest";
import { agentPayloadSecret } from "./agent-payload-secret";

describe("agentPayloadSecret", () => {
  it("prefers the dedicated payload secret", () => {
    expect(
      agentPayloadSecret({
        AGENT_PAYLOAD_SECRET: "payload",
        CONNECTED_ACCOUNT_SECRET: "account",
      }),
    ).toBe("payload");
  });

  it("falls back to the connected-account secret for local development", () => {
    expect(agentPayloadSecret({ CONNECTED_ACCOUNT_SECRET: "account" })).toBe(
      "account",
    );
    expect(
      agentPayloadSecret({
        AGENT_PAYLOAD_SECRET: "",
        CONNECTED_ACCOUNT_SECRET: "account",
      }),
    ).toBe("account");
  });

  it("is undefined when neither secret is set", () => {
    expect(agentPayloadSecret({})).toBeUndefined();
  });
});
