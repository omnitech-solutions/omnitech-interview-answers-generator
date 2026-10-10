"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";

import { StudioPage } from "../shell";
import { useThemes } from "./use-themes";

export function ThemeLibrary(props: ProductPageProps) {
  const {
    themes,
    name,
    setName,
    description,
    setDescription,
    themeStatus,
    createTheme,
    setReaction,
    importTheme,
  } = useThemes(props);
  return (
    <StudioPage
      description="Built-in and tenant-owned colors, typography, and layout systems."
      title="Themes"
    >
      <form
        className="studio-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void createTheme();
        }}
      >
        <h2>Create custom theme</h2>
        <label>
          Name
          <input
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          Description
          <input
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>
        <button className="studio-primary-action" type="submit">
          Save theme
        </button>
        <p aria-live="polite">{themeStatus}</p>
        <label>
          Import PowerPoint theme
          <input
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importTheme(file);
            }}
            type="file"
          />
        </label>
      </form>
      <div className="studio-card-grid">
        {themes.map((theme) => (
          <article className="studio-theme-card" key={theme.id}>
            <div
              className="studio-theme-preview"
              style={{
                background: String(theme.definition["background"] ?? "#f8fafc"),
                color: String(theme.definition["text"] ?? "#111827"),
              }}
            >
              <strong>Aa</strong>
            </div>
            <h2>{theme.name}</h2>
            <p>{theme.description}</p>
            <span>{theme.builtIn ? "Built in" : "Custom"}</span>
            <div className="studio-actions">
              <button
                onClick={() => void setReaction(theme, "favorite")}
                type="button"
              >
                {theme.favorite ? "★ Favorited" : "☆ Favorite"}
              </button>
              <button
                onClick={() => void setReaction(theme, "like")}
                type="button"
              >
                {theme.liked ? "♥ Liked" : "♡ Like"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </StudioPage>
  );
}
