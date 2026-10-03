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
      // A public link opens outside any tenant, so it has no products to link.
      products={[]}
      routeId="presentation.shared"
      tenantSlug=""
    />
  );
}
