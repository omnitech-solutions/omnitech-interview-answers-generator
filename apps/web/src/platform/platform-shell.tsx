"use client";

import type { AiTargetSummary } from "@omnitech/ai-contracts";
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
  const isPresentationRoute = pathname.includes("/p/presentation");
  const [theme, setTheme] = useState(context.preferences.theme);
  const [locale, setLocale] = useState(context.preferences.locale);
  const [aiProfileId, setAiProfileId] = useState(
    context.preferences.aiProfileId ?? "",
  );
  const [aiTargets, setAiTargets] = useState<AiTargetSummary[]>([]);

  useEffect(() => {
    void fetch(
      `/api/platform/v1/ai-targets?tenant=${encodeURIComponent(context.tenant.slug)}`,
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((targets: AiTargetSummary[]) => {
        const languageTargets = targets.filter(
          (target) =>
            target.kind === "language" && target.family === "direct-model",
        );
        setAiTargets(languageTargets);
        const selected =
          context.preferences.aiProfileId ?? languageTargets[0]?.id ?? "";
        setAiProfileId((current) => current || selected);
        if (selected)
          window.localStorage.setItem("platform.aiProfileId", selected);
      })
      .catch(() => undefined);
  }, [context.preferences.aiProfileId, context.tenant.slug]);

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
    nextAiProfileId = aiProfileId,
  ) {
    await fetch(
      `/api/platform/v1/preferences?tenant=${encodeURIComponent(context.tenant.slug)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: nextTheme,
          locale: nextLocale,
          aiProfileId: nextAiProfileId || null,
        }),
      },
    );
  }

  useEffect(() => {
    function onAiProfileChange(event: Event) {
      const profileId = (event as CustomEvent<{ profileId?: unknown }>).detail
        ?.profileId;
      if (typeof profileId !== "string" || profileId.length === 0) return;
      setAiProfileId(profileId);
      void savePreferences(theme, locale, profileId);
    }
    window.addEventListener("platform-ai-profile-change", onAiProfileChange);
    return () =>
      window.removeEventListener(
        "platform-ai-profile-change",
        onAiProfileChange,
      );
  }, [locale, theme]);

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
    <div
      className={`platform-frame ${isPresentationRoute ? "platform-frame-presentation" : ""}`}
    >
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
          {aiTargets.length > 0 ? (
            <label>
              <span className="platform-visually-hidden">AI model</span>
              <select
                aria-label="AI model"
                onChange={(event) => {
                  const nextProfileId = event.target.value;
                  setAiProfileId(nextProfileId);
                  window.localStorage.setItem(
                    "platform.aiProfileId",
                    nextProfileId,
                  );
                  void savePreferences(theme, locale, nextProfileId);
                }}
                value={aiProfileId}
              >
                {aiTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.modelId ?? target.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
