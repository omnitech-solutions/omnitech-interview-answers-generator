import Link from "next/link";

import {
  refuseTenantAccess,
  resolvePlatformContext,
} from "@/src/platform/context";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const context = await resolvePlatformContext(tenantSlug);
  if (!context) return refuseTenantAccess();
  return (
    <section className="platform-settings">
      <p className="platform-eyebrow">Workspace settings</p>
      <h1>Connected accounts</h1>
      <p>
        Connected accounts authorize product actions and are independent from
        the identity used to sign in.
      </p>
      <div className="platform-integration-grid">
        <article>
          <h2>Google</h2>
          <p>Allow products to create and select files with your approval.</p>
          <Link
            href={`/api/integrations/google/authorize?tenant=${tenantSlug}`}
          >
            Connect Google
          </Link>
        </article>
        <article>
          <h2>LinkedIn</h2>
          <p>
            Import your profile. Connection access is requested only for
            applications approved by LinkedIn.
          </p>
          <Link
            href={`/api/integrations/linkedin/authorize?tenant=${tenantSlug}`}
          >
            Connect LinkedIn
          </Link>
        </article>
      </div>
    </section>
  );
}
