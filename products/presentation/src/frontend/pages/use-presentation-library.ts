"use client";

import type { ProfileSummary } from "@omnitech/ai-engine";
import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useState } from "react";

import type { PresentationSummary } from "../../domain/index";
import { createPresentationClient } from "../presentation-client";
import {
  AI_PROFILE_KEY,
  CREATE_SETTINGS_KEY,
  localStore,
  persistSelectedAiProfile,
  sessionStore,
} from "../presentation-settings";

export function usePresentationLibrary({ tenantSlug }: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const [items, setItems] = useState<PresentationSummary[]>([]);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<"all" | "recent" | "favorites">("recent");
  const [search, setSearch] = useState("");
  const [listView, setListView] = useState(false);
  const [sortByTitle, setSortByTitle] = useState(false);
  const [slideCount, setSlideCount] = useState(10);
  const [layout, setLayout] = useState("dynamic");
  const [language, setLanguage] = useState("English");
  const [targets, setTargets] = useState<ProfileSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  useEffect(
    () =>
      client.loadDocuments(setItems, (reason) =>
        setError(reason instanceof Error ? reason.message : "Unable to load."),
      ),
    [client],
  );
  useEffect(
    () =>
      client.loadAiTargets((available) => {
        setTargets(available.filter((target) => target.kind === "model"));
        const persisted = localStore.get(AI_PROFILE_KEY);
        setTargetId(
          (current) => current || persisted || available[0]?.id || "",
        );
      }),
    [client],
  );
  const visibleItems = [...items]
    .sort((left, right) =>
      sortByTitle
        ? left.title.localeCompare(right.title)
        : right.updatedAt.localeCompare(left.updatedAt),
    )
    .filter((item) => {
      if (tab === "favorites" && !item.favorite) return false;
      return item.title.toLowerCase().includes(search.toLowerCase());
    });
  function openCreate() {
    sessionStore.set(
      CREATE_SETTINGS_KEY,
      JSON.stringify({
        prompt: prompt.trim(),
        slideCount,
        layout,
        language,
        targetId,
      }),
    );
    window.location.assign(`/t/${tenantSlug}/p/presentation/create`);
  }
  function toggleFavorite(item: PresentationSummary) {
    return void client
      .setDocumentFavorite(item.id, !item.favorite)
      .then(() =>
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, favorite: !candidate.favorite }
              : candidate,
          ),
        ),
      )
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to update favorite.",
        ),
      );
  }

  function selectAiProfile(profileId: string) {
    setTargetId(profileId);
    persistSelectedAiProfile(profileId);
  }

  return {
    items,
    error,
    prompt,
    setPrompt,
    tab,
    setTab,
    search,
    setSearch,
    listView,
    setListView,
    sortByTitle,
    setSortByTitle,
    slideCount,
    setSlideCount,
    layout,
    setLayout,
    language,
    setLanguage,
    targets,
    targetId,
    visibleItems,
    openCreate,
    toggleFavorite,
    selectAiProfile,
  };
}
