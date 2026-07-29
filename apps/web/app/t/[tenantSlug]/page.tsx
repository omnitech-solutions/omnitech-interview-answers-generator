import { redirect } from "next/navigation";

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<never> {
  const { tenantSlug } = await params;
  redirect(`/t/${tenantSlug}/workspace`);
}
