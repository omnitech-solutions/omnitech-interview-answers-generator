import { handle } from "hono/vercel";

import { createApi } from "@/src/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = handle(createApi());

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
