import { createApplicationApi } from "@/src/platform/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Built on the first request, so `next build` never needs the database.
let api: ReturnType<typeof createApplicationApi> | undefined;
const handler = (request: Request) => {
  api ??= createApplicationApi();
  return api.fetch(request);
};

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
