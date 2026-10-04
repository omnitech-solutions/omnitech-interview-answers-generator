// The Web App Manifest that lets a browser offer "Install app" for Interview
// Studio's live overlay (ADR-0019). The installed window loads the same overlay
// route every other host loads (ADR-0017); the manifest only names it. Chrome
// needs no service worker to install (a manifest with icons, a start_url and a
// standalone display is enough), so none is shipped: the page is online-only
// and nothing is cached.
//
// [SAFETY] The manifest carries a tenant slug and static text, no session,
// credential or content, so it is served without a sign-in (a browser fetches it
// without cookies).

export const WEB_APP_PRODUCT_ID = "interview";
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export const isWebAppTenantSlug = (slug: string): boolean => SLUG.test(slug);

export type WebAppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

// The overlay route is the start page; the scope is the product, so Studio
// links stay inside the installed window.
export function liveWebAppManifest(tenantSlug: string): WebAppManifest {
  const scope = `/t/${encodeURIComponent(tenantSlug)}/p/${WEB_APP_PRODUCT_ID}/`;
  return {
    id: `${scope}live/overlay`,
    name: "Interview Studio · Live",
    short_name: "Studio Live",
    description:
      "The live Interview Studio card in its own window. It is visible in screen shares.",
    start_url: `${scope}live/overlay?host=pwa`,
    scope,
    display: "standalone",
    background_color: "#0f2557",
    theme_color: "#0f2557",
    icons: [
      { src: "/icons/studio-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/studio-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/studio-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
