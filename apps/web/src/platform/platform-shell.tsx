"use client";

import type { PlatformContext } from "@omnitech/platform-contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import React, { useEffect, useState } from "react";

export function PlatformShell({
  context,
  children,
}: {
  context: PlatformContext;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [theme, setTheme] = useState(context.preferences.theme);

  useEffect(() => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.dataset["theme"] = resolved;
  }, [theme]);

  const routes = context.products.flatMap((product) =>
    Object.entries(product.navigation.routes)
      .filter(([, route]) => !route.hidden)
      .map(([routeId, route]) => ({
        ...route,
        routeId,
        href: `/t/${context.tenant.slug}${route.path}`,
      })),
  );

  return (
    <div className="platform-frame">
      <header className="platform-header">
        <Link className="platform-brand" href={`/t/${context.tenant.slug}`}>
          <span aria-hidden="true" className="platform-brand-mark">
            O
          </span>
          <span>
            <strong>Omnitech Studio</strong>
            <small>{context.tenant.name}</small>
          </span>
        </Link>
        <nav aria-label="Product navigation" className="platform-navigation">
          {routes.map((route) => (
            <Link
              aria-current={
                pathname.startsWith(route.href) ? "page" : undefined
              }
              href={route.href}
              key={route.routeId}
            >
              {route.label}
            </Link>
          ))}
        </nav>
        <div className="platform-globals">
          <label>
            <span className="platform-visually-hidden">Theme</span>
            <select
              onChange={(event) =>
                setTheme(event.target.value as "system" | "light" | "dark")
              }
              value={theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <span className="platform-user" title={context.user.email}>
            {context.user.displayName}
          </span>
        </div>
      </header>
      <main className="platform-content">{children}</main>
    </div>
  );
}
