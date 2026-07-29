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
  const [locale, setLocale] = useState(context.preferences.locale);

  useEffect(() => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.dataset["theme"] = resolved;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  async function savePreferences(
    nextTheme: "system" | "light" | "dark",
    nextLocale: string,
  ) {
    await fetch(
      `/api/platform/v1/preferences?tenant=${encodeURIComponent(context.tenant.slug)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: nextTheme, locale: nextLocale }),
      },
    );
  }

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
                (() => {
                  const nextTheme = event.target.value as
                    | "system"
                    | "light"
                    | "dark";
                  setTheme(nextTheme);
                  void savePreferences(nextTheme, locale);
                })()
              }
              value={theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            <span className="platform-visually-hidden">Language</span>
            <select
              onChange={(event) => {
                const nextLocale = event.target.value;
                setLocale(nextLocale);
                void savePreferences(theme, nextLocale);
              }}
              value={locale}
            >
              <option value="en">English</option>
              <option value="fr-CA">Français (Canada)</option>
            </select>
          </label>
          <Link
            className="platform-settings-link"
            href={`/t/${context.tenant.slug}/settings/integrations`}
          >
            Connections
          </Link>
          <span className="platform-user" title={context.user.email}>
            {context.user.displayName}
          </span>
        </div>
      </header>
      <main className="platform-content">{children}</main>
    </div>
  );
}
