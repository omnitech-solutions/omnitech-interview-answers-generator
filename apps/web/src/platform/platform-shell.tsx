"use client";

import type { AiTargetSummary } from "@omnitech/ai-contracts";
import type {
  PlatformContext,
  ProductFrame,
} from "@omnitech/platform-contracts";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { safeStorage } from "./safe-storage";

const AI_PROFILE_KEY = "platform.aiProfileId";
const localStore = safeStorage("local");

// Products ask the shell to change the member's theme through this event; the
// shell is the one owner of the document theme and of its saved preference.
const THEME_CHANGE_EVENT = "platform-theme-change";

// The tenant's frame around its products. Each product brings its own
// navigation and settings; the frame applies the member's preferences.
export function PlatformShell({
  context,
  frames,
  children,
}: {
  context: PlatformContext;
  // Each registered product's frame, by the route segment naming it.
  frames: Readonly<Record<string, ProductFrame>>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // A product page is /t/:tenantSlug/p/:productId/*; its registration
  // chooses the frame, and every other page is standard.
  const productSegment = /^\/t\/[^/]+\/p\/([^/]+)/.exec(pathname)?.[1];
  // [GUARD] Only the registry's own keys: /p/constructor names no frame.
  const frame =
    productSegment && Object.hasOwn(frames, productSegment)
      ? (frames[productSegment] ?? "standard")
      : "standard";
  const { locale } = context.preferences;
  // The member's theme: the saved preference until a product changes it.
  const [theme, setTheme] = useState(context.preferences.theme);
  useEffect(
    () => setTheme(context.preferences.theme),
    [context.preferences.theme],
  );
  // The latest saved AI profile, so a theme save never writes back a stale one.
  const aiProfileRef = useRef(context.preferences.aiProfileId);
  const tenant = encodeURIComponent(context.tenant.slug);

  // Products read the member's AI profile, defaulting to the first model.
  // [STRATEGY] A saved choice needs no request; only without one are the
  // targets listed, and cleanup aborts that load.
  const savedAiProfile = context.preferences.aiProfileId;
  useEffect(() => {
    if (savedAiProfile) {
      localStore.set(AI_PROFILE_KEY, savedAiProfile);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/platform/v1/ai-targets?tenant=${tenant}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((targets: AiTargetSummary[]) => {
        const selected = targets.find(
          (target) =>
            target.kind === "language" && target.family === "direct-model",
        )?.id;
        if (selected) localStore.set(AI_PROFILE_KEY, selected);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [savedAiProfile, tenant]);

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

  // A product that changes the AI profile or the theme saves it as the member's
  // choice.
  useEffect(() => {
    function save(next: {
      theme: typeof theme;
      aiProfileId?: string | null | undefined;
    }) {
      void fetch(`/api/platform/v1/preferences?tenant=${tenant}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: next.theme,
          locale,
          aiProfileId: next.aiProfileId,
        }),
      });
    }
    function onAiProfileChange(event: Event) {
      const profileId = (event as CustomEvent<{ profileId?: unknown }>).detail
        ?.profileId;
      if (typeof profileId !== "string" || profileId.length === 0) return;
      aiProfileRef.current = profileId;
      save({ theme, aiProfileId: profileId });
    }
    function onThemeChange(event: Event) {
      const next = (event as CustomEvent<{ theme?: unknown }>).detail?.theme;
      if (next !== "light" && next !== "dark" && next !== "system") return;
      setTheme(next);
      save({ theme: next, aiProfileId: aiProfileRef.current });
    }
    window.addEventListener("platform-ai-profile-change", onAiProfileChange);
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => {
      window.removeEventListener(
        "platform-ai-profile-change",
        onAiProfileChange,
      );
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
    };
  }, [locale, theme, tenant]);

  return (
    <div className={`platform-frame platform-frame-${frame}`}>
      <main className="platform-content">{children}</main>
    </div>
  );
}
