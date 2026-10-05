// Build-time registration is complete (AGENTS.md rule 4, ADR-0004; audit
// arch-09). A product exists for the app only once it appears in four places
// that are edited by hand: the web package's dependencies, the registry
// (frontend and manifest), the backend mount list, and Next's
// transpilePackages. This test finds every `products/*` package with a
// manifest and requires all four. A place a product is deliberately missing
// from is listed with the reason, and an entry that no longer applies fails.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { importSites, parse, repoRoot, walk } from "./guard-support.js";

type Place =
  | "web package.json dependency"
  | "registry.ts manifest import"
  | "products.ts backend import"
  | "next.config.ts transpilePackages";

const allowedGaps: ReadonlyArray<{
  product: string;
  place: Place;
  reason: string;
}> = [
  {
    product: "@omnitech/product-presentation",
    place: "next.config.ts transpilePackages",
    reason:
      "the presentation product ships compiled dist JavaScript that Next loads as is; only the interview product's package is transpiled from source (audit arch-09)",
  },
];

interface Product {
  name: string;
  dir: string;
}

function products(): Product[] {
  return walk("products", /^manifest\.tsx?$/)
    .filter((file) => /^products\/[^/]+\/src\/manifest\.tsx?$/.test(file))
    .map((file) => {
      const dir = file.split("/").slice(0, 2).join("/");
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
      ) as { name: string };
      return { name: manifest.name, dir };
    });
}

function transpiledPackages(): string[] {
  const source = parse("apps/web/next.config.ts");
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "transpilePackages" &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      for (const element of node.initializer.elements)
        if (ts.isStringLiteralLike(element)) names.push(element.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

const specifiers = (file: string) =>
  importSites(parse(file)).map((site) => site.specifier);

function missingPlaces(product: Product): Place[] {
  const web = JSON.parse(
    readFileSync(join(repoRoot, "apps/web/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const missing: Place[] = [];
  if (!(product.name in (web.dependencies ?? {})))
    missing.push("web package.json dependency");
  if (
    !specifiers("apps/web/src/platform/registry.ts").includes(
      `${product.name}/manifest`,
    )
  )
    missing.push("registry.ts manifest import");
  if (
    !specifiers("apps/web/src/platform/products.ts").includes(
      `${product.name}/backend`,
    )
  )
    missing.push("products.ts backend import");
  if (!transpiledPackages().includes(product.name))
    missing.push("next.config.ts transpilePackages");
  return missing;
}

const all = products();

it("finds the registered products", () => {
  expect(all.map((product) => product.name)).toEqual(
    expect.arrayContaining([
      "@omnitech/product-interview",
      "@omnitech/product-presentation",
    ]),
  );
  expect(existsSync(join(repoRoot, "apps/web/src/platform/registry.ts"))).toBe(
    true,
  );
});

it("registers every product with a manifest in all four places", () => {
  const gaps = all.flatMap((product) =>
    missingPlaces(product)
      .filter(
        (place) =>
          !allowedGaps.some(
            (gap) => gap.product === product.name && gap.place === place,
          ),
      )
      .map((place) => `${product.name} is missing from ${place}`),
  );
  expect(
    gaps,
    "Register the product in apps/web/package.json, src/platform/registry.ts, src/platform/products.ts and next.config.ts, or list the gap with a reason in scripts/product-registration.test.ts",
  ).toEqual([]);
});

it("keeps every allowed gap real and reasoned", () => {
  for (const gap of allowedGaps) {
    expect(gap.reason.length, gap.product).toBeGreaterThan(30);
    const product = all.find((candidate) => candidate.name === gap.product);
    expect(product, `${gap.product} is no longer a product`).toBeDefined();
    expect(
      missingPlaces(product as Product),
      `${gap.product} is no longer missing from ${gap.place}: delete the entry`,
    ).toContain(gap.place);
  }
});
