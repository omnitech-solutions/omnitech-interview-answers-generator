"use client";

import type { ProfileSummary } from "@omnitech/ai-engine";
import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useState } from "react";
import { createPresentationClient } from "../presentation-client";
import {
  AI_PROFILE_KEY,
  CREATE_SETTINGS_KEY,
  localStore,
  persistSelectedAiProfile,
  sessionStore,
} from "../presentation-settings";

export function usePresentationCreate({ tenantSlug }: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [textContent, setTextContent] = useState("concise");
  const [tone, setTone] = useState("Auto");
  const [audience, setAudience] = useState("Auto");
  const [scenario, setScenario] = useState("Auto");
  const [theme, setTheme] = useState("ebony");
  const [slideCount, setSlideCount] = useState(10);
  const [layout, setLayout] = useState("dynamic");
  const [language, setLanguage] = useState("English");
  const [targets, setTargets] = useState<ProfileSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  useEffect(() => {
    const raw = sessionStore.get(CREATE_SETTINGS_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          prompt?: string;
          slideCount?: number;
          layout?: string;
          language?: string;
          targetId?: string;
        };
        if (saved.prompt) {
          setTopic(saved.prompt);
          setTitle(saved.prompt.split(/[.!?]/)[0]?.slice(0, 80) ?? "");
        }
        if (saved.slideCount) setSlideCount(saved.slideCount);
        if (saved.layout) setLayout(saved.layout);
        if (saved.language) setLanguage(saved.language);
        if (saved.targetId) setTargetId(saved.targetId);
      } catch {
        // Ignore stale settings and let the create form use its defaults.
      }
      sessionStore.remove(CREATE_SETTINGS_KEY);
    }
  }, []);
  useEffect(
    () =>
      client.loadAiTargets((available) => {
        const languageTargets = available.filter(
          (target) => target.kind === "model",
        );
        setTargets(languageTargets);
        const persisted = localStore.get(AI_PROFILE_KEY);
        setTargetId(
          (current) => current || persisted || languageTargets[0]?.id || "",
        );
      }),
    [client],
  );
  async function create() {
    setStatus("Creating…");
    try {
      const result = await client.createDocument({
        title: title || topic || "Untitled presentation",
        outline,
        settings: {
          textContent,
          tone,
          audience,
          scenario,
          theme,
          slideCount,
          layout,
          language,
          targetId,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(
        `/t/${tenantSlug}/p/presentation/editor/${result.id}`,
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Creation failed.");
    }
  }
  async function generateOutline() {
    setStatus("Generating outline…");
    try {
      const execution = await client.generateOutline({
        prompt: topic,
        profileId: targetId || "document-fast",
        slideCount,
        language,
        layout,
        textContent,
        tone,
        audience,
        scenario,
      });
      setTitle(execution.result.title ?? title);
      setOutline(execution.result.outline ?? []);
      setStatus("Outline ready.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Generation failed.",
      );
    }
  }
  function selectAiProfile(profileId: string) {
    setTargetId(profileId);
    persistSelectedAiProfile(profileId);
  }

  return {
    title,
    setTitle,
    topic,
    setTopic,
    outline,
    setOutline,
    status,
    textContent,
    setTextContent,
    tone,
    setTone,
    audience,
    setAudience,
    scenario,
    setScenario,
    theme,
    setTheme,
    slideCount,
    setSlideCount,
    layout,
    setLayout,
    language,
    setLanguage,
    targets,
    targetId,
    create,
    generateOutline,
    selectAiProfile,
  };
}
