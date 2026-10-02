import type { HighlighterCore, LanguageInput } from "shiki/core";

// Code highlighting loads Shiki's core with the languages the studio's
// answers, briefs and references use, not the full bundle of ~200 grammars.
// Anything else is shown as plain text.
const LANGUAGES: Record<string, () => Promise<{ default: LanguageInput }>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  json: () => import("@shikijs/langs/json"),
  bash: () => import("@shikijs/langs/bash"),
  sql: () => import("@shikijs/langs/sql"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  yaml: () => import("@shikijs/langs/yaml"),
  diff: () => import("@shikijs/langs/diff"),
  python: () => import("@shikijs/langs/python"),
  // The diagram view's "Show syntax".
  mermaid: () => import("@shikijs/langs/mermaid"),
};
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rb: "ruby",
  yml: "yaml",
  py: "python",
  react: "tsx",
};
export const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Map<string, Promise<void>>();

function core() {
  highlighter ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("@shikijs/themes/github-light"),
    import("@shikijs/themes/github-dark"),
  ]).then(([{ createHighlighterCore }, engine, light, dark]) =>
    createHighlighterCore({
      themes: [light.default, dark.default],
      langs: [],
      engine: engine.createJavaScriptRegexEngine(),
    }),
  );
  return highlighter;
}

/** The highlighter with `language` ready, and the name to use for it. */
export async function highlighterFor(language: string) {
  const shiki = await core();
  const name = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const load = LANGUAGES[name];
  if (!load) return { shiki, lang: "text" };
  if (!loaded.has(name))
    loaded.set(
      name,
      load().then(async (module) => {
        await shiki.loadLanguage(module.default);
      }),
    );
  await loaded.get(name);
  return { shiki, lang: name };
}
