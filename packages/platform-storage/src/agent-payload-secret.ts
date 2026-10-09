// The one definition of which secret encrypts agent prompt payloads. The
// fallback to the connected-account key is kept for single-machine local
// development only; set AGENT_PAYLOAD_SECRET wherever the two keys should be
// rotated or leaked independently.
export function agentPayloadSecret(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return (
    env["AGENT_PAYLOAD_SECRET"] || env["CONNECTED_ACCOUNT_SECRET"] || undefined
  );
}
