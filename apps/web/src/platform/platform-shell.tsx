"use client";

import type { AiTargetSummary } from "@omnitech/ai-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import React, { useEffect } from "react";

// The tenant's frame around its products. Each product brings its own
// navigation and settings; the frame applies the member's preferences.
export function PlatformShell({
  context,
  children,
}: {
  context: PlatformContext;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isPresentationRoute = pathname.includes("/p/presentation");
  const isInterviewRoute = pathname.includes("/p/interview");
  const { theme, locale } = context.preferences;
  const tenant = encodeURIComponent(context.tenant.slug);

  // Products read the member's AI profile, defaulting to the first model.
  useEffect(() => {
    void fetch(`/api/platform/v1/ai-targets?tenant=${tenant}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((targets: AiTargetSummary[]) => {
        const selected =
          context.preferences.aiProfileId ??
          targets.find(
            (target) =>
              target.kind === "language" && target.family === "direct-model",
          )?.id;
        if (selected)
          window.localStorage.setItem("platform.aiProfileId", selected);
      })
      .catch(() => undefined);
  }, [context.preferences.aiProfileId, tenant]);

  useEffect(() => {
    document.documentElement.dataset["theme"] =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // A product that changes the AI profile saves it as the member's choice.
  useEffect(() => {
    function onAiProfileChange(event: Event) {
      const profileId = (event as CustomEvent<{ profileId?: unknown }>).detail
        ?.profileId;
      if (typeof profileId !== "string" || profileId.length === 0) return;
      void fetch(`/api/platform/v1/preferences?tenant=${tenant}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme, locale, aiProfileId: profileId }),
      });
    }
    window.addEventListener("platform-ai-profile-change", onAiProfileChange);
    return () =>
      window.removeEventListener(
        "platform-ai-profile-change",
        onAiProfileChange,
      );
  }, [locale, theme, tenant]);

  return (
    <div
      className={`platform-frame ${isPresentationRoute ? "platform-frame-presentation" : ""} ${isInterviewRoute ? "platform-frame-interview" : ""}`}
    >
      <main className="platform-content">{children}</main>
    </div>
  );
}
