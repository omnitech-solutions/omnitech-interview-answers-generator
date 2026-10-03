// The access context a session's gateway calls carry: the product, the session
// OWNER as the user and the product's read permission. Tenant and user come
// from the claimed session row, never from ingest or model content. The host's
// gateway authorizes by these permissions, as it does for every product call.
import type { AiAccessContext } from "@omnitech/ai-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import type { OwnerScope } from "./scope.js";

export const SESSION_GATEWAY_CONTEXT = Object.freeze({
  productId: INTERVIEW_PRODUCT_ID,
  permissions: Object.freeze(["interview.read"]) as readonly string[],
});

export const sessionGatewayContext = (scope: OwnerScope): AiAccessContext => ({
  tenantId: scope.tenantId,
  userId: scope.actorId,
  productId: SESSION_GATEWAY_CONTEXT.productId,
  permissions: [...SESSION_GATEWAY_CONTEXT.permissions],
});
