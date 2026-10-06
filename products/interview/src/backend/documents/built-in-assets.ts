import type { BuiltInKey } from "./built-in-templates";

// [SAFETY] One literal URL per committed stand-in file. A bundler (Next's
// Turbopack) resolves each `new URL("./assets/<name>", import.meta.url)` to its
// own emitted file; a path built from a variable ("./assets/${name}") collapsed to
// a single file in the production bundle, so every built-in template read the
// same bytes and the markdown one was refused ("Markdown must be UTF-8"), which
// broke the Documents page. Keep this table literal and in step with
// `builtInTemplates()` (built-in-assets.test.ts checks it).
const BUILT_IN_ASSETS: Readonly<Record<BuiltInKey, URL>> = {
  resume: new URL("./assets/resume.docx", import.meta.url),
  "cover-letter": new URL("./assets/cover-letter.docx", import.meta.url),
  "interview-prep": new URL("./assets/interview-prep.md", import.meta.url),
};

export const builtInAssetUrl = (key: BuiltInKey): URL => BUILT_IN_ASSETS[key];
