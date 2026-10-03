// Interview Studio's API calls name the tenant the page belongs to
// (/t/<slug>/…); the host resolves the signed-in member of that tenant.
export const TENANT_HEADER = "x-omnitech-tenant";

export function studioFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const slug = /^\/t\/([^/]+)/.exec(window.location.pathname)?.[1];
  if (!slug) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(TENANT_HEADER, decodeURIComponent(slug));
  return fetch(input, { ...init, headers });
}

// studioFetch for one effect's loads: its cleanup aborts them, so a re-run
// (a changed dependency, or React StrictMode in development) never leaves a
// second live request behind the first.
export function studioFetchUntil(signal: AbortSignal): typeof fetch {
  return (input, init = {}) => studioFetch(input, { ...init, signal });
}
