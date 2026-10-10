"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useState } from "react";

import type { PresentationTheme } from "../../domain/index";

import { createPresentationClient } from "../presentation-client";

export function useThemes({ tenantSlug }: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const [themes, setThemes] = useState<PresentationTheme[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [themeStatus, setThemeStatus] = useState("");
  useEffect(
    () =>
      client.loadThemes(setThemes, (reason) =>
        setThemeStatus(
          reason instanceof Error ? reason.message : "Unable to load themes.",
        ),
      ),
    [client],
  );
  async function createTheme() {
    if (!name.trim()) return;
    setThemeStatus("Saving theme…");
    try {
      const theme = await client.createTheme({
        name,
        description,
        definition: {
          background: "#f8fafc",
          text: "#111827",
          accent: "#4f46e5",
        },
      });
      setThemes((current) => [
        ...current,
        {
          id: theme.id,
          name,
          description,
          builtIn: false,
          definition: {
            background: "#f8fafc",
            text: "#111827",
            accent: "#4f46e5",
          },
          favorite: false,
          liked: false,
        },
      ]);
      setName("");
      setDescription("");
      setThemeStatus("Theme saved.");
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Unable to save theme.",
      );
    }
  }
  async function setReaction(
    theme: PresentationTheme,
    reaction: "favorite" | "like",
  ) {
    const enabled = !(reaction === "favorite" ? theme.favorite : theme.liked);
    try {
      await client.setThemeReaction(theme.id, reaction, enabled);
      setThemes((current) =>
        current.map((candidate) =>
          candidate.id === theme.id
            ? {
                ...candidate,
                ...(reaction === "favorite"
                  ? { favorite: enabled }
                  : { liked: enabled }),
              }
            : candidate,
        ),
      );
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Reaction failed.",
      );
    }
  }
  async function importTheme(file: File) {
    setThemeStatus("Importing PowerPoint theme…");
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const value = String(reader.result ?? "");
          resolve(value.includes(",") ? (value.split(",", 2)[1] ?? "") : value);
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read theme."));
        reader.readAsDataURL(file);
      });
      const imported = await client.importTheme({
        name: file.name.replace(/\.pptx$/i, "") || "Imported theme",
        fileBase64,
        sourceImportId: `pptx:${file.name}:${file.size}:${file.lastModified}`,
      });
      setThemes((current) => [
        ...current,
        {
          ...imported.theme,
          id: imported.id,
          builtIn: false,
          favorite: false,
          liked: false,
        },
      ]);
      setThemeStatus("PowerPoint theme imported.");
    } catch (reason) {
      setThemeStatus(
        reason instanceof Error ? reason.message : "Theme import failed.",
      );
    }
  }
  return {
    themes,
    name,
    setName,
    description,
    setDescription,
    themeStatus,
    createTheme,
    setReaction,
    importTheme,
  };
}
