// The UI migration audit: proves the old Interview Studio UI is gone and stays
// gone after the move to `@oc-tech/omni-ui-components`. ONE manifest of retired
// symbols (`retiredUi`) drives every check; the test beside this file fails on
// any hit and prints the count report. It parses with the TypeScript compiler
// API (already a dependency), so aliased imports, barrels, JSX, createElement
// and class names inside any string or template are all seen, which `rg` is not.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { importSites, parse, repoRoot, walk } from "./guard-support";

const FRONTEND = "products/interview/src/frontend";
const OVERLAY = `${FRONTEND}/studio/live/overlay`;
const PANELS = `${OVERLAY}/panels`;

/** A class family: an exact class, or (with a trailing `*`) a prefix. */
export type ClassFamily = string;

export const retiredUi = {
  // Names that must not be declared locally, imported from a relative path or
  // rendered. The library `Button` (a package import) is fine; a local or
  // relative `Button` is the retired `ui/button.tsx`.
  components: [
    "Button",
    "StudioButton",
    "UiButton",
    "BUTTON_VARIANTS",
    "BUTTON_SIZES",
  ],
  // Repository paths without extension; an import that resolves to one fails.
  modules: [
    `${FRONTEND}/ui/button`,
    `${FRONTEND}/ui/ui.css`,
    `${FRONTEND}/ui/join`,
    `${FRONTEND}/ui/index`,
    `${FRONTEND}/ui`,
    `${PANELS}/screen-picker`,
    `${PANELS}/screen-picker.css`,
    `${PANELS}/follow-latest`,
    // The web overlay card and the Document Picture-in-Picture float (ADR-0033):
    // the native app is the only live-session surface.
    ...[
      "overlay-card",
      "chat-log",
      "command-bar",
      "hands-free-controls",
      "companion-setup",
      "device-only-notice",
      "auto-status",
      "mask-editor",
      "session-switcher",
      "settings-popover",
      "source-popover",
      "listening-hint",
      "overlay-shortcuts",
      "card-position",
      "local-preview",
      "menu-placement",
      "overlay-capture",
      "overlay-task",
    ].map((name) => `${OVERLAY}/${name}`),
    ...["card-host", "float-host", "pip-document", "float-access"].map(
      (name) => `${FRONTEND}/studio/live/${name}`,
    ),
  ],
  // Class families that no string, template or clsx/cn argument may contain and
  // no stylesheet may select. Filled from the track reports.
  cssSelectors: [
    "studio-button",
    "pn-primary",
    "pn-codecard",
    "pn-analysis-text",
    "pn-display-*",
    "ov-footer",
    "ov-confirm",
    "ov-clock",
    // The overlay card's styles (ov-status, the footer's idle text, stays).
    "ov-card",
    "ov-head*",
    "ov-menu*",
    "ov-band*",
    "ov-capture*",
    "ov-sheet*",
    "ov-switcher*",
    "ov-slot*",
    "ov-disclosure*",
    "ov-rev*",
    "ov-link",
    "ov-root",
    "ov-followup",
    "ov-input",
    "ov-send",
    "ov-chat*",
    "ov-solution*",
    "ov-stage*",
    "ov-task*",
    "ov-auto*",
    "ov-popover*",
    "ov-pill*",
    "ov-block*",
    "ov-approach*",
    "ov-companion*",
    "ov-source*",
    "ov-columns",
    "ov-spinner",
    "ov-dot",
    "ov-modal*",
    "ov-thumb*",
    "ov-region*",
    "ov-preset*",
    "ov-mic",
    "ov-meter",
    "ov-kbd",
    "ov-idle*",
    "ov-ended*",
    "ov-listening",
    "ov-flash",
  ] as ClassFamily[],
  // CSS custom properties that no stylesheet may define or read: the old
  // button roles of ui/tokens.css (the library paints with --oui-*).
  cssVariables: ["--ui-*"] as string[],
} as const;

export type Primitive =
  | "button"
  | "input"
  | "select"
  | "textarea"
  | "dialog"
  | "table";
export const PRIMITIVES: readonly Primitive[] = [
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
  "table",
];

/** The swapped surfaces the raw-primitive audit covers (non-test files). */
export const swappedSurfaces = [
  `${PANELS}/`,
  `${OVERLAY}/`,
  `${FRONTEND}/studio/`,
];

export type RawTag = Primitive | "checkable";

export interface AllowEntry {
  // A file, or a directory prefix ending in "/" (the longest match wins).
  file: string;
  // The most raw elements of each tag the entry may cover. A count above its
  // max fails; a count below it fails too (lower the number): a ratchet.
  max: Partial<Record<RawTag, number>>;
  reason: string;
}

export interface Hit {
  kind: "import" | "component" | "string" | "selector" | "variable";
  file: string;
  line: number;
  detail: string;
}

export interface RawSite {
  file: string;
  line: number;
  tag: Primitive;
  checkable: boolean;
}

export interface StringSite {
  file: string;
  line: number;
  text: string;
  /** True when the piece ends a template head/middle (a dynamic class prefix). */
  open: boolean;
}

export interface Scan {
  hits: Hit[];
  raw: RawSite[];
  strings: StringSite[];
  files: string[];
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/** Every `.ts`/`.tsx` audited: product frontends and the web app. */
export function auditedFiles(): string[] {
  const roots = ["products", "apps/web"];
  return roots
    .flatMap((root) => walk(root, /\.tsx?$/))
    .filter(
      (path) => path.startsWith("apps/web/") || path.includes("/src/frontend/"),
    );
}

function familyMatches(family: ClassFamily, token: string): boolean {
  return family.endsWith("*")
    ? token.startsWith(family.slice(0, -1))
    : token === family;
}

/** Class-like tokens of a string (`.a` and `a` both yield `a`). */
export function tokensOf(text: string): string[] {
  return text.match(/[A-Za-z_][\w-]*/g) ?? [];
}

export const retiredFamilyIn = (token: string): ClassFamily | undefined =>
  retiredUi.cssSelectors.find((family) => familyMatches(family, token));

function resolveModule(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const parts = [...from.split("/").slice(0, -1)];
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/").replace(/\.(tsx?|js)$/, "");
}

const isRetiredModule = (path: string) =>
  (retiredUi.modules as readonly string[]).includes(path);

/** The tag name of a JSX element or `createElement` first argument, if any. */
function renderedName(node: ts.Node): string | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    return ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
  if (
    ts.isCallExpression(node) &&
    node.arguments.length > 0 &&
    ((ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "createElement") ||
      (ts.isIdentifier(node.expression) &&
        node.expression.text === "createElement"))
  ) {
    const first = node.arguments[0]!;
    if (ts.isIdentifier(first)) return first.text;
    if (ts.isStringLiteralLike(first)) return first.text;
  }
  return undefined;
}

function scanFile(path: string, scan: Scan): void {
  const file = parse(path);
  const line = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const add = (hit: Hit) => scan.hits.push(hit);

  // Imports and re-exports, barrels included, resolved to repository paths.
  for (const site of importSites(file)) {
    const target = resolveModule(path, site.specifier);
    if (target && isRetiredModule(target))
      add({
        kind: "import",
        file: path,
        line: site.line,
        detail: `${site.specifier} (retired module)`,
      });
  }

  // Bindings a JSX tag can resolve to: package imports are the library.
  const packageBindings = new Set<string>();
  const relativeBindings = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const names: Array<{ local: string; imported: string }> = [];
    const clause = statement.importClause;
    if (clause.name)
      names.push({ local: clause.name.text, imported: "default" });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        names.push({
          local: element.name.text,
          imported: (element.propertyName ?? element.name).text,
        });
    for (const { local, imported } of names) {
      if (specifier.startsWith(".")) {
        relativeBindings.set(local, imported);
        // An aliased import of a retired name: `Button as UiButton`.
        if (
          (retiredUi.components as readonly string[]).includes(imported) &&
          imported !== local
        )
          add({
            kind: "component",
            file: path,
            line: line(statement),
            detail: `${imported} imported as ${local}`,
          });
        else if ((retiredUi.components as readonly string[]).includes(imported))
          add({
            kind: "component",
            file: path,
            line: line(statement),
            detail: `${imported} imported from ${specifier}`,
          });
      } else packageBindings.add(local);
    }
  }

  const retiredComponents = retiredUi.components as readonly string[];
  const visit = (node: ts.Node) => {
    // Declarations that recreate a retired component name locally.
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      retiredComponents.includes(node.name.text)
    )
      add({
        kind: "component",
        file: path,
        line: line(node),
        detail: `${node.name.text} declared locally`,
      });
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      retiredComponents.includes(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer) ||
        ts.isCallExpression(node.initializer))
    )
      add({
        kind: "component",
        file: path,
        line: line(node),
        detail: `${node.name.text} declared locally`,
      });

    // JSX / createElement of a retired symbol.
    const name = renderedName(node);
    if (name) {
      if (
        retiredComponents.includes(name) &&
        !packageBindings.has(name) &&
        !relativeBindings.has(name)
      )
        add({
          kind: "component",
          file: path,
          line: line(node),
          detail: `<${name}> rendered`,
        });
      // Raw primitives: lowercase JSX tags and createElement("button", ...).
      if ((PRIMITIVES as readonly string[]).includes(name)) {
        const attrs = ts.isJsxOpeningElement(node)
          ? node.attributes
          : ts.isJsxSelfClosingElement(node)
            ? node.attributes
            : undefined;
        const checkable =
          name === "input" &&
          !!attrs?.properties.some(
            (prop) =>
              ts.isJsxAttribute(prop) &&
              prop.name.getText() === "type" &&
              prop.initializer !== undefined &&
              ts.isStringLiteral(prop.initializer) &&
              ["checkbox", "radio"].includes(prop.initializer.text),
          );
        scan.raw.push({
          file: path,
          line: line(node),
          tag: name as Primitive,
          checkable,
        });
      }
    }

    // Every string, template piece and clsx/cn argument.
    if (ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent)) {
      scan.strings.push({
        file: path,
        line: line(node),
        text: node.text,
        open: false,
      });
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      scan.strings.push({
        file: path,
        line: line(node),
        text: node.text,
        open: true,
      });
    } else if (ts.isTemplateTail(node)) {
      scan.strings.push({
        file: path,
        line: line(node),
        text: node.text,
        open: false,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

export function scanFrontend(): Scan {
  const files = auditedFiles();
  const scan: Scan = { hits: [], raw: [], strings: [], files };
  for (const path of files) scanFile(path, scan);
  // Retired class families inside any string. Test files may NAME a retired
  // class only to assert its absence, so only shipped code is held to this.
  for (const site of scan.strings) {
    if (isTest(site.file)) continue;
    for (const token of tokensOf(site.text)) {
      const family = retiredFamilyIn(token);
      if (family)
        scan.hits.push({
          kind: "string",
          file: site.file,
          line: site.line,
          detail: `"${token}" (retired family ${family})`,
        });
    }
  }
  return scan;
}

// ---------------------------------------------------------------------------
// Raw primitive audit

export const isSwappedSurface = (path: string) =>
  !isTest(path) &&
  !/-kit\.|-probe\.|-fixtures?\./.test(path) &&
  swappedSurfaces.some((prefix) => path.startsWith(prefix));

const STUDIO_WEB =
  "Studio web page: never part of the native swap (the library covers the native window); it keeps its own Studio styles. Shrinks only when the page is rebuilt on library controls.";
const NATIVE_PANEL_OPEN =
  "Native panel control not yet on a library component (found by this audit); owner decides whether to port it. Lower the number when it is.";

/** The ratchet: each entry may only shrink, and every one carries a reason. */
export const rawAllowList: readonly AllowEntry[] = [
  {
    file: `${PANELS}/answer-dock.tsx`,
    max: { button: 2 },
    reason:
      "Screenshot tray: thumbnail open/remove buttons are app-owned markup with no library equivalent (T-gap recorded in the swap reports). " +
      NATIVE_PANEL_OPEN,
  },
  {
    file: `${PANELS}/answer-pane.tsx`,
    max: { button: 1 },
    reason: `The note's dismiss (x) button. ${NATIVE_PANEL_OPEN}`,
  },
  {
    file: `${PANELS}/panel-views.tsx`,
    max: { button: 2, select: 2 },
    reason: `The Settings window (?panel=settings): Quit, Close and two native selects the tests drive. ${NATIVE_PANEL_OPEN}`,
  },
  {
    file: `${PANELS}/panels-root.tsx`,
    max: { button: 1 },
    reason: `"Review consent" action in the signed-in banner. ${NATIVE_PANEL_OPEN}`,
  },
  {
    file: `${PANELS}/popover.tsx`,
    max: { button: 1 },
    reason:
      "App-owned popover trigger; reached by shared/revisions-control.tsx (native answer pane and the web live page).",
  },
  {
    file: `${PANELS}/status-strip.tsx`,
    max: { button: 1 },
    reason: `The strip's stop action (pn-mini-button). ${NATIVE_PANEL_OPEN}`,
  },
  {
    file: `${OVERLAY}/panels/coach-layout.tsx`,
    max: { button: 1 },
    reason:
      "A question row in the coach layouts: a two-line row (a label that wraps, and its time) that is pressed as a whole, which the library Button (one truncated line) cannot draw. To go when the library has a list row.",
  },
  {
    file: `${OVERLAY}/code-canvas.tsx`,
    max: { button: 9 },
    reason:
      "Live code canvas used by Studio's coding-panel (web live page); not reachable from the native window.",
  },
  {
    file: `${FRONTEND}/studio/live/`,
    max: {
      button: 35,
      checkable: 4,
      select: 1,
      textarea: 1,
      input: 1,
      table: 1,
    },
    reason: `${STUDIO_WEB} (live session page, setup, banners, shared screenshots/revisions/crop controls).`,
  },
  {
    file: `${FRONTEND}/studio/account/`,
    max: { button: 3 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/briefings/`,
    // +1 button: "Condense for the assistant" in the pack's Edit setup
    // (behavioural/setup-card.tsx), a `bp-link` like the links beside it.
    max: { button: 28, textarea: 4, input: 5, select: 1, checkable: 2 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/documents/`,
    max: { button: 36, textarea: 4, input: 5, select: 1 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/home/`,
    max: { button: 9, input: 7 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/rehearsal/`,
    max: { button: 5, textarea: 2, input: 1, select: 2 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/workspace/`,
    max: { button: 13, textarea: 2, select: 1 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/command-palette.tsx`,
    max: { button: 1, input: 1 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/practice-timer.tsx`,
    max: { button: 1 },
    reason: STUDIO_WEB,
  },
  {
    file: `${FRONTEND}/studio/sidebar.tsx`,
    max: { button: 6 },
    reason: STUDIO_WEB,
  },
];

export function rawPrimitiveCounts(raw: RawSite[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const site of raw) {
    if (!isSwappedSurface(site.file)) continue;
    const tag: RawTag = site.checkable ? "checkable" : site.tag;
    const key = `${site.file}\u0000${tag}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const entryFor = (file: string, allow: readonly AllowEntry[]) =>
  allow
    .filter(
      (e) =>
        e.file === file || (e.file.endsWith("/") && file.startsWith(e.file)),
    )
    .sort((x, y) => y.file.length - x.file.length)[0];

export interface RawVerdict {
  /** Raw elements with no allow-list entry, or above its max. */
  unlisted: string[];
  /** Allow-list numbers above what exists (lower them). */
  stale: string[];
  /** Allow-list entries with no real reason. */
  unreasoned: string[];
}

export function judgeRaw(
  counts: Map<string, number>,
  allow: readonly AllowEntry[],
): RawVerdict {
  const verdict: RawVerdict = { unlisted: [], stale: [], unreasoned: [] };
  const per = new Map<AllowEntry, Partial<Record<RawTag, number>>>();
  for (const [key, count] of counts) {
    const [file, tag] = key.split("\u0000") as [string, RawTag];
    const entry = entryFor(file, allow);
    if (!entry) {
      verdict.unlisted.push(
        `${file}: ${count} raw <${tag}>, no allow-list entry`,
      );
      continue;
    }
    const sums = per.get(entry) ?? {};
    sums[tag] = (sums[tag] ?? 0) + count;
    per.set(entry, sums);
  }
  for (const entry of allow) {
    const sums = per.get(entry) ?? {};
    for (const tag of new Set([
      ...Object.keys(entry.max),
      ...Object.keys(sums),
    ]) as Set<RawTag>) {
      const have = sums[tag] ?? 0;
      const max = entry.max[tag] ?? 0;
      if (have > max)
        verdict.unlisted.push(
          `${entry.file} <${tag}>: ${have} raw, allow-list says ${max}`,
        );
      else if (have < max)
        verdict.stale.push(
          `${entry.file} <${tag}>: allows ${max}, has ${have}: lower it`,
        );
    }
    if (entry.reason.trim().length < 20) verdict.unreasoned.push(entry.file);
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// CSS: selectors and variables

export const cssFiles = (): string[] => walk(FRONTEND, /\.css$/);

export interface Selector {
  file: string;
  line: number;
  name: string;
}

const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/** Every class named in a rule prelude (not in declarations or url()s). */
export function classSelectors(path: string): Selector[] {
  const css = stripComments(readFileSync(join(repoRoot, path), "utf8"));
  const found: Selector[] = [];
  const preludes = /([^{};]+)\{/g;
  for (let m = preludes.exec(css); m; m = preludes.exec(css)) {
    const prelude = m[1]!;
    if (prelude.trimStart().startsWith("@")) continue;
    const scrubbed = prelude
      .replace(/\[[^\]]*\]/g, (s) => " ".repeat(s.length))
      .replace(/"[^"]*"/g, (s) => " ".repeat(s.length));
    const start = m.index + m[0].indexOf(prelude);
    const classes = /(?<![\w)\]-])\.([A-Za-z_][\w-]*)/g;
    for (let c = classes.exec(scrubbed); c; c = classes.exec(scrubbed)) {
      const offset = start + c.index;
      found.push({
        file: path,
        line: css.slice(0, offset).split("\n").length,
        name: c[1]!,
      });
    }
  }
  return found;
}

export interface CssVariableUse {
  file: string;
  line: number;
  name: string;
  kind: "define" | "read";
}

export function cssVariables(path: string): CssVariableUse[] {
  const css = stripComments(readFileSync(join(repoRoot, path), "utf8"));
  const uses: CssVariableUse[] = [];
  const re = /(--[A-Za-z][\w-]*)(\s*:)?/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const rest = css.slice(m.index + m[0].length);
    const define = m[2] !== undefined && !/^\s*[,)]/.test(rest);
    uses.push({
      file: path,
      line: css.slice(0, m.index).split("\n").length,
      name: m[1]!,
      kind: define ? "define" : "read",
    });
  }
  return uses;
}

export interface CssReport {
  retired: Selector[];
  unreferenced: Selector[];
  retiredVariables: CssVariableUse[];
}

/**
 * Class selectors that no shipped code names. `referenced` holds every class
 * token of every non-test string; dynamic prefixes (a template piece that ends
 * in `-`, like `pn-chip-${tone}`) keep the whole family alive.
 */
export function cssReport(scan: Scan, extraReferences: Set<string>): CssReport {
  const referenced = new Set(extraReferences);
  const prefixes = new Set<string>();
  for (const site of scan.strings) {
    if (isTest(site.file)) continue;
    for (const token of tokensOf(site.text)) referenced.add(token);
    if (site.open) {
      const last = site.text.match(/[A-Za-z_][\w-]*$/)?.[0];
      if (last?.endsWith("-")) prefixes.add(last);
    }
  }
  const selectors = cssFiles().flatMap(classSelectors);
  const retired = selectors.filter((s) => retiredFamilyIn(s.name));
  const unreferenced = selectors.filter(
    (s) =>
      !retiredFamilyIn(s.name) &&
      !referenced.has(s.name) &&
      ![...prefixes].some((prefix) => s.name.startsWith(prefix)),
  );
  const retiredVars = (retiredUi.cssVariables as readonly string[]).map((v) =>
    v.endsWith("*") ? v.slice(0, -1) : v,
  );
  const retiredVariables = cssFiles()
    .flatMap(cssVariables)
    .filter((use) =>
      (retiredUi.cssVariables as readonly string[]).some((v, i) =>
        v.endsWith("*") ? use.name.startsWith(retiredVars[i]!) : use.name === v,
      ),
    );
  return { retired, unreferenced, retiredVariables };
}

// ---------------------------------------------------------------------------
// The count report

export interface Counts {
  button: number;
  input: number;
  checkable: number;
  select: number;
  textarea: number;
  dialog: number;
  table: number;
  legacyImports: number;
  legacySelectors: number;
  legacyStrings: number;
}

export function countReport(scan: Scan, css: CssReport): Counts {
  const surface = scan.raw.filter((s) => isSwappedSurface(s.file));
  const n = (tag: Primitive) =>
    surface.filter((s) => s.tag === tag && !s.checkable).length;
  return {
    button: n("button"),
    input: n("input"),
    checkable: surface.filter((s) => s.checkable).length,
    select: n("select"),
    textarea: n("textarea"),
    dialog: n("dialog"),
    table: n("table"),
    legacyImports: scan.hits.filter(
      (h) => h.kind === "import" || h.kind === "component",
    ).length,
    legacySelectors: css.retired.length + css.retiredVariables.length,
    legacyStrings: scan.hits.filter((h) => h.kind === "string").length,
  };
}

export const formatCounts = (c: Counts): string =>
  `Raw <button>: ${c.button}, <input>: ${c.input} (+${c.checkable} checkbox/radio), <select>: ${c.select}, <textarea>: ${c.textarea}, <dialog>: ${c.dialog}, <table>: ${c.table}, legacy imports: ${c.legacyImports}, legacy selectors: ${c.legacySelectors}, legacy strings: ${c.legacyStrings}`;
