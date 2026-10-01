import { SharedPresentation } from "@omnitech/product-presentation/frontend";

export default async function SharedPresentationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <SharedPresentation
      pathSegments={["shared", token]}
      routeId="presentation.shared"
      tenantSlug=""
    />
  );
}
