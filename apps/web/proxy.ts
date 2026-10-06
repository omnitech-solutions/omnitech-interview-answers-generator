import { type NextRequest, NextResponse } from "next/server";

import { REQUESTED_PATH_HEADER } from "@/src/platform/request-path";

// Tenant layouts are not told their own path. This records it as a request
// header so a signed-out visitor sent to sign-in can be returned to the page
// they asked for. It reads and decides nothing else.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    REQUESTED_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/t/:path*" };
