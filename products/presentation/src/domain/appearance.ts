const presets: Readonly<Record<string, { background: string; text: string }>> =
  {
    indigo: { background: "#24205a", text: "#a5b4fc" },
    orbit: { background: "#f8f8f8", text: "#393185" },
    cosmos: { background: "#01040e", text: "#818cf8" },
    piano: { background: "#f1f2f4", text: "#202833" },
    ebony: { background: "#111827", text: "#f8fafc" },
    mystique: { background: "#ffffff", text: "#7c3aed" },
  };

export function slideAppearance(settings: Readonly<Record<string, unknown>>) {
  const definition =
    typeof settings["themeDefinition"] === "object" &&
    settings["themeDefinition"] !== null
      ? (settings["themeDefinition"] as Record<string, unknown>)
      : (presets[String(settings["theme"])] ?? {});
  const color = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : fallback;
  return {
    fontSize:
      settings["fontSize"] === "small"
        ? 20
        : settings["fontSize"] === "large"
          ? 30
          : 26,
    textAlign:
      settings["textAlign"] === "center"
        ? ("center" as const)
        : settings["textAlign"] === "right"
          ? ("right" as const)
          : ("left" as const),
    background: color(definition["background"], "#f8fafc"),
    text: color(definition["text"], "#111827"),
  };
}
