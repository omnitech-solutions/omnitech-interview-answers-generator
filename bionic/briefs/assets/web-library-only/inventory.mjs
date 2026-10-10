#!/usr/bin/env node
// Counts every use of something that is NOT a part of @oc-tech/omni-ui-components in the web app
// and the product frontends, grouped by page. Read-only. Run from the repository root:
//
//   node bionic/briefs/assets/web-library-only/inventory.mjs            # Markdown tables
//   node bionic/briefs/assets/web-library-only/inventory.mjs --json     # the same numbers as JSON
//
// It reads git-tracked files only (so no dist, node_modules or build output) and skips tests,
// stories, fixtures under testing/ and generated files. The counts are textual (a regular
// expression over the source with comments removed), so treat them as a measure, not a parse:
// a lowercase JSX tag is counted when it follows a non-identifier character and is a known HTML or
// SVG element name.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LIBRARY = "@oc-tech/omni-ui-components";

// Page groups, first match wins. `surface` says who sees it.
const GROUPS = [
  ["web shell: sign-in, signed-out, settings, error, frame", "web", /^apps\/web\/(app\/|src\/platform\/platform-shell\.tsx)/],
  ["native overlay (Mac app panels; also /live/overlay)", "native", /^products\/interview\/src\/frontend\/studio\/live\/overlay\//],
  ["interview brief form and pack review", "both", /^products\/interview\/src\/frontend\/studio\/interview-brief\//],
  ["Home", "web", /^products\/interview\/src\/frontend\/studio\/home\//],
  ["Workspace", "web", /^products\/interview\/src\/frontend\/studio\/workspace\//],
  ["Briefings", "web", /^products\/interview\/src\/frontend\/studio\/briefings\//],
  ["Documents", "web", /^products\/interview\/src\/frontend\/studio\/documents\//],
  ["Knowledge", "web", /^products\/interview\/src\/frontend\/(library\.tsx|markdown-content\.tsx|shiki-highlighter\.ts|studio\/(knowledge|library)\.css)/],
  ["Rehearsal", "web", /^products\/interview\/src\/frontend\/studio\/rehearsal\//],
  ["Live session (setup, session, ended) and shared live parts", "both", /^products\/interview\/src\/frontend\/studio\/live\//],
  ["native sign-in", "native", /^products\/interview\/src\/frontend\/native-sign-in-route\.tsx/],
  ["Studio shell: sidebar, palette, account, dialogs, tokens", "web", /^products\/interview\/src\/frontend\//],
  ["Presentation product (7 routes)", "web", /^products\/presentation\/src\/frontend\//],
];

const SKIP = /(\.test\.|\.stories\.|\/testing\/|icons\.generated\.ts$|fake-api\.ts$|\.d\.ts$)/;
const HTML = new Set(
  "a article aside b blockquote br button canvas caption code col dd details dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i iframe img input kbd label legend li main mark menu nav ol optgroup option output p pre progress section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul video audio source svg path g circle rect line polyline polygon defs ellipse text".split(
    " ",
  ),
);
const LAYOUT = new Set("div span section article aside header footer main nav".split(" "));
const TEXT = new Set("p h1 h2 h3 h4 h5 h6 b strong em i small code pre kbd blockquote time mark u sub sup br hr".split(" "));
const FORM = new Set("form input select textarea label fieldset legend option optgroup output".split(" "));
const TABLE = new Set("table thead tbody tfoot tr td th caption col".split(" "));
const LIST = new Set("ul ol li dl dt dd menu".split(" "));
const CONTROL = new Set("button a details summary dialog".split(" "));

const files = execFileSync("git", ["ls-files", "apps/web/app", "apps/web/src/platform/platform-shell.tsx", "products/interview/src/frontend", "products/presentation/src/frontend"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(tsx|ts|css)$/.test(file) && !SKIP.test(file));

const blank = () => ({
  files: 0, tsx: 0, tsxLines: 0, css: 0, cssLines: 0, cssRules: 0, cssImports: 0,
  layout: 0, text: 0, form: 0, table: 0, list: 0, control: 0, media: 0,
  className: 0, style: 0, rawForms: 0, rawTables: 0, dynamicForms: 0, libraryTables: 0,
  libraryFiles: 0, parts: {}, tags: {}, other: {},
});
const groups = new Map(GROUPS.map(([name, surface]) => [name, { name, surface, ...blank() }]));
const bump = (bag, key, by = 1) => {
  bag[key] = (bag[key] ?? 0) + by;
};
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

for (const file of files) {
  const group = groups.get(GROUPS.find(([, , pattern]) => pattern.test(file))?.[0]);
  if (!group) continue;
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n").length;
  group.files += 1;
  if (file.endsWith(".css")) {
    group.css += 1;
    group.cssLines += lines;
    group.cssRules += (strip(raw).match(/\{/g) ?? []).length;
    continue;
  }
  const source = strip(raw);
  group.cssImports += (source.match(/import\s+["'][^"']+\.css["']/g) ?? []).length;
  for (const match of source.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    const [, typeOnly, names, from] = match;
    if (from === LIBRARY || from.startsWith(`${LIBRARY}/`)) {
      for (const name of names.replace(/[{}]/g, "").split(",")) {
        const clean = name.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
        if (!clean || typeOnly || clean.startsWith("type ") || !/^[A-Z][a-z]/.test(clean)) continue;
        bump(group.parts, clean);
      }
    } else if (!from.startsWith(".") && !from.startsWith("@/") && !/^(react|react-dom|next)(\/|$)|^node:|^@omnitech\//.test(from) && file.endsWith(".tsx")) {
      bump(group.other, from);
    }
  }
  if (new RegExp(`from\\s+["']${LIBRARY}`).test(source)) group.libraryFiles += 1;
  if (!file.endsWith(".tsx")) continue;
  group.tsx += 1;
  group.tsxLines += lines;
  for (const [, tag] of source.matchAll(/(?<![A-Za-z0-9_$.])<([a-z][a-z0-9]*)(?=[\s/>])/g)) {
    if (!HTML.has(tag)) continue;
    bump(group.tags, tag);
    if (LAYOUT.has(tag)) group.layout += 1;
    else if (TEXT.has(tag)) group.text += 1;
    else if (FORM.has(tag)) group.form += 1;
    else if (TABLE.has(tag)) group.table += 1;
    else if (LIST.has(tag)) group.list += 1;
    else if (CONTROL.has(tag)) group.control += 1;
    else group.media += 1;
  }
  group.className += (source.match(/\bclassName\s*[=:]/g) ?? []).length;
  group.style += (source.match(/\bstyle\s*=\s*\{/g) ?? []).length;
  group.rawForms += (source.match(/(?<![A-Za-z0-9_$.])<form[\s>]/g) ?? []).length;
  group.rawTables += (source.match(/(?<![A-Za-z0-9_$.])<table[\s>]/g) ?? []).length;
  group.dynamicForms += (source.match(/<DynamicForm[\s>]/g) ?? []).length;
  group.libraryTables += (source.match(/<(Table|DataTable)[\s>]/g) ?? []).length;
}

const rows = [...groups.values()];
const total = rows.reduce((sum, row) => {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "number") sum[key] = (sum[key] ?? 0) + value;
    else if (key === "parts" || key === "tags" || key === "other") for (const [k, v] of Object.entries(value)) bump(sum[key], k, v);
  }
  return sum;
}, { name: "TOTAL", surface: "", ...blank() });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ groups: rows, total }, null, 2));
} else {
  const top = (bag, n = 99) => Object.entries(bag).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log("| Page group | Surface | TSX files / lines | CSS files / lines / rules | Layout elements | Text elements | Raw form elements | Raw table elements | List elements | Raw button, link, details | svg, img, other | className | inline style | Files importing the library |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of [...rows, total])
    console.log(`| ${row.name} | ${row.surface} | ${row.tsx} / ${row.tsxLines} | ${row.css} / ${row.cssLines} / ${row.cssRules} | ${row.layout} | ${row.text} | ${row.form} | ${row.table} | ${row.list} | ${row.control} | ${row.media} | ${row.className} | ${row.style} | ${row.libraryFiles} of ${row.tsx} |`);
  console.log("\n| Page group | <form> | <table> | <DynamicForm> | library Table | Library parts imported (import sites) | Other UI packages imported |");
  console.log("|---|---|---|---|---|---|---|");
  for (const row of [...rows, total])
    console.log(`| ${row.name} | ${row.rawForms} | ${row.rawTables} | ${row.dynamicForms} | ${row.libraryTables} | ${top(row.parts) || "none"} | ${top(row.other) || "none"} |`);
  console.log(`\nRaw elements by tag, all groups: ${top(total.tags)}`);
}
