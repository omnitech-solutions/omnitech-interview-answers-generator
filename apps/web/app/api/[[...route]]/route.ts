import { handle } from "hono/vercel";

import { createApplicationApi } from "@/src/platform/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = handle(createApplicationApi());

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
