"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import type React from "react";

export function StudioPage({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="studio-page">
      <header className="studio-page-header">
        <div>
          <p className="studio-eyebrow">Studio</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions ? <div className="studio-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function ProductLinks({
  products,
}: {
  products: ProductPageProps["products"];
}) {
  const others = products.filter((product) => !product.current);
  if (others.length === 0) return null;
  return (
    <nav aria-label="Products" className="presentation-product-links">
      {others.map((product) => (
        <a href={product.href} key={product.productId}>
          {product.name}
        </a>
      ))}
    </nav>
  );
}

export function ReferenceHeader({
  title = "Presentation Studio",
  products,
}: {
  title?: string;
  products: ProductPageProps["products"];
}) {
  return (
    <header className="presentation-reference-header">
      <span className="presentation-reference-mark" aria-hidden="true">
        ◌
      </span>
      <span>{title}</span>
      <ProductLinks products={products} />
    </header>
  );
}
