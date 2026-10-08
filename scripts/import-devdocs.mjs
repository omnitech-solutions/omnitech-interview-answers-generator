// Loads official documentation from DevDocs (devdocs.io) into the Knowledge
// library of THIS machine, as published official references.
//
//   node scripts/import-devdocs.mjs                 every documentation set below
//   node scripts/import-devdocs.mjs nextjs node     only the named sets
//   node scripts/import-devdocs.mjs --list          what would be imported
//   node scripts/import-devdocs.mjs --remove nextjs take a set out again
//
// [DOMAIN] The documentation is data, not source: it is downloaded to
// .dev-local/devdocs (a cache) and written to the library's data file
// (apps/web/.data/library.json, or INTERVIEW_DATA_DIR), never committed. Each
// page keeps its publisher, version and address, and the licence of each
// project still applies to its text. One write holds every page, and the file's
// revision moves once, so the running app rebuilds its search index once.
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = join(root, ".dev-local", "devdocs");
const dataDirectory =
  process.env.INTERVIEW_DATA_DIR ?? join(root, "apps", "web", ".data");
const libraryPath = join(dataDirectory, "library.json");

// The sets worth having for a full-stack TypeScript interview. `collection` is
// the library's collection and first tag (the Knowledge filters read it).
export const DOCUMENTATION = [
  { slug: "nextjs", collection: "nextjs", publisher: "Next.js" },
  { slug: "react", collection: "react", publisher: "React" },
  { slug: "node", collection: "nodejs", publisher: "Node.js" },
  { slug: "typescript", collection: "typescript", publisher: "TypeScript" },
  { slug: "express", collection: "express", publisher: "Express" },
  { slug: "postgresql~18", collection: "postgresql", publisher: "PostgreSQL" },
  { slug: "mongoose", collection: "mongodb", publisher: "Mongoose" },
  { slug: "jest", collection: "jest", publisher: "Jest" },
  { slug: "mocha", collection: "mocha", publisher: "Mocha" },
  { slug: "cypress", collection: "cypress", publisher: "Cypress" },
  { slug: "playwright", collection: "playwright", publisher: "Playwright" },
  { slug: "webpack~5", collection: "webpack", publisher: "webpack" },
  { slug: "babel~7", collection: "babel", publisher: "Babel" },
  { slug: "docker", collection: "docker", publisher: "Docker" },
  { slug: "kubernetes", collection: "kubernetes", publisher: "Kubernetes" },
];

const MIN_BODY_CHARS = 200;
const SUMMARY_CHARS = 200;

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rarr: "→",
  larr: "←",
  copy: "©",
};
export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name] ?? whole);
}

const stripTags = (html) => html.replace(/<[^>]+>/g, "");
const inline = (html) =>
  decodeEntities(
    stripTags(
      html
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
          const text = decodeEntities(stripTags(code)).trim();
          return text ? `\`${text.replaceAll("`", "'")}\`` : "";
        })
        .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
        .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*"),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();

// [STRATEGY] DevDocs pages are clean, flat HTML (headings, paragraphs, lists,
// code, tables), so a small ordered set of replacements is enough. Code blocks
// are lifted out first and put back last, so nothing rewrites their contents.
export function htmlToMarkdown(html) {
  const blocks = [];
  const hold = (text) => `\u0000${blocks.push(text) - 1}\u0000`;
  let text = html
    .replace(/<(script|style|svg|nav|button|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (_, attributes, code) => {
      const language =
        /data-language="([^"]+)"/.exec(attributes)?.[1] ??
        /class="[^"]*language-([a-z0-9]+)/.exec(attributes)?.[1] ??
        "";
      const body = decodeEntities(
        stripTags(code.replace(/<br\s*\/?>/gi, "\n")),
      ).replace(/\s+$/, "");
      return hold(`\n\n\`\`\`${language}\n${body}\n\`\`\`\n\n`);
    })
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => {
      const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(
        ([, row]) =>
          [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
            ([, cell]) => inline(cell).replaceAll("|", "\\|"),
          ),
      );
      const filled = rows.filter((row) => row.length > 0);
      if (filled.length === 0) return "";
      const width = Math.max(...filled.map((row) => row.length));
      const line = (row) =>
        `| ${Array.from({ length: width }, (_, at) => row[at] ?? "").join(" | ")} |`;
      const [head, ...rest] = filled;
      return hold(
        `\n\n${[line(head), line(Array(width).fill("---")), ...rest.map(line)].join("\n")}\n\n`,
      );
    })
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, heading) => {
      const title = inline(heading);
      return title ? `\n\n${"#".repeat(Number(level))} ${title}\n\n` : "";
    })
    .replace(/<li[^>]*>([\s\S]*?)(?=<li[^>]*>|<\/[uo]l>)/gi, (_, item) => {
      const line = inline(item.replace(/<\/li>/gi, ""));
      return line ? `\n- ${line}` : "";
    })
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, quote) => {
      const line = inline(quote);
      return line ? `\n\n> ${line}\n\n` : "";
    })
    .replace(/<d[td][^>]*>([\s\S]*?)<\/d[td]>/gi, (_, term) => {
      const line = inline(term);
      return line ? `\n\n${line}\n\n` : "";
    })
    .replace(/<(p|div|section|article|header|footer|figure)[^>]*>/gi, "\n\n")
    .replace(/<\/(p|div|section|article|header|footer|figure)>/gi, "\n\n");
  text = text
    .split(/\n{2,}/)
    .map((part) =>
      /^\s*(#{1,6} |- |> |\u0000)/.test(part) || part.includes("\n- ")
        ? decodeEntities(stripTags(part)).replace(/[ \t]+/g, " ")
        : inline(part),
    )
    .join("\n\n");
  return text
    .replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const slugOf = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/, "");

// One library item from one documentation page, or null when the page has no
// real content (a redirect stub, an index of links).
export function itemOf(documentation, release, entry, html) {
  const markdown = htmlToMarkdown(html);
  if (markdown.length < MIN_BODY_CHARS) return null;
  const title = decodeEntities(entry.name).replaceAll("`", "").trim();
  const body = /^# /.test(markdown) ? markdown : `# ${title}\n\n${markdown}`;
  const firstParagraph = body
    .split(/\n{2,}/)
    .find((part) => !/^(#|- |>|```|\|)/.test(part) && part.length > 40);
  const summary = (
    firstParagraph ?? `${documentation.publisher} documentation: ${title}.`
  )
    .replace(/[`*]/g, "")
    .slice(0, SUMMARY_CHARS)
    .trim();
  const section = slugOf(entry.type ?? "");
  const slug = slugOf(`${documentation.collection}-docs-${entry.path}`);
  if (!slug) return null;
  return {
    slug,
    title: `${documentation.publisher}: ${title}`,
    summary: summary || `${documentation.publisher} documentation: ${title}.`,
    body,
    contentType: "official-reference",
    collection: documentation.collection,
    tags: [
      ...new Set(
        [documentation.collection, "official-docs", section].filter(Boolean),
      ),
    ],
    source: {
      publisher: documentation.publisher,
      canonicalUrl: `https://devdocs.io/${documentation.slug}/${entry.path}`,
      official: true,
      ...(release ? { version: String(release) } : {}),
      lastVerifiedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

async function download(slug, file) {
  const cached = join(cacheDirectory, slug.replaceAll("~", "-"), file);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const response = await fetch(`https://documents.devdocs.io/${slug}/${file}`, {
    headers: { "user-agent": "omnitech-interview-studio/devdocs-import" },
  });
  if (!response.ok)
    throw new Error(`${slug}/${file}: DevDocs answered ${response.status}`);
  const text = await response.text();
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, text);
  return JSON.parse(text);
}

async function pagesOf(documentation) {
  const catalogue = await (
    await fetch("https://devdocs.io/docs.json", {
      headers: { "user-agent": "omnitech-interview-studio/devdocs-import" },
    })
  ).json();
  const release = catalogue.find(
    (each) => each.slug === documentation.slug,
  )?.release;
  const [index, pages] = await Promise.all([
    download(documentation.slug, "index.json"),
    download(documentation.slug, "db.json"),
  ]);
  // The index lists every heading; a page is taken once, under the name of
  // its first entry without an anchor (or its first entry).
  const byPath = new Map();
  for (const entry of index.entries) {
    const [path, anchor] = entry.path.split("#");
    if (!byPath.has(path) || !anchor) {
      if (!byPath.has(path) || !byPath.get(path).whole)
        byPath.set(path, { ...entry, path, whole: !anchor });
    }
  }
  const items = [];
  for (const entry of byPath.values()) {
    const html = pages[entry.path];
    if (typeof html !== "string") continue;
    const item = itemOf(documentation, release, entry, html);
    if (item) items.push(item);
  }
  // Two pages may shorten to the same slug: the later one takes a suffix.
  const seen = new Map();
  for (const item of items) {
    const count = seen.get(item.slug) ?? 0;
    seen.set(item.slug, count + 1);
    if (count > 0) item.slug = `${item.slug.slice(0, 90)}-${count + 1}`;
  }
  return items;
}

function readLibrary() {
  if (!existsSync(libraryPath)) return { revision: 0, items: [] };
  return JSON.parse(readFileSync(libraryPath, "utf8"));
}
function writeLibrary(file) {
  mkdirSync(dataDirectory, { recursive: true });
  // The file as it was is kept beside it once per day, so an import can be
  // undone by copying it back.
  const backup = `${libraryPath}.before-devdocs-${new Date().toISOString().slice(0, 10)}`;
  if (existsSync(libraryPath) && !existsSync(backup))
    copyFileSync(libraryPath, backup);
  const temporary = `${libraryPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  renameSync(temporary, libraryPath);
}
const importedFrom = (stored, documentation) =>
  stored.item.source?.canonicalUrl?.startsWith(
    `https://devdocs.io/${documentation.slug}/`,
  ) ?? false;

async function main() {
  const flags = process.argv.slice(2).filter((each) => each.startsWith("--"));
  const names = process.argv.slice(2).filter((each) => !each.startsWith("--"));
  const chosen = names.length
    ? DOCUMENTATION.filter(
        (each) => names.includes(each.slug) || names.includes(each.collection),
      )
    : DOCUMENTATION;
  if (chosen.length === 0) {
    console.error(
      `No documentation set matches. Known: ${DOCUMENTATION.map((each) => each.slug).join(", ")}`,
    );
    process.exit(1);
  }
  const file = readLibrary();
  if (flags.includes("--remove")) {
    const before = file.items.length;
    file.items = file.items.filter(
      (stored) => !chosen.some((each) => importedFrom(stored, each)),
    );
    writeLibrary({ revision: file.revision + 1, items: file.items });
    console.log(`Removed ${before - file.items.length} pages.`);
    return;
  }
  let added = 0;
  let updated = 0;
  for (const documentation of chosen) {
    const items = await pagesOf(documentation);
    if (flags.includes("--list")) {
      console.log(`${documentation.slug}: ${items.length} pages`);
      continue;
    }
    const bySlug = new Map(file.items.map((stored) => [stored.item.slug, stored]));
    const now = new Date().toISOString();
    for (const input of items) {
      const stored = bySlug.get(input.slug);
      // A slug that belongs to something else (a seeded or hand-written
      // article) is never overwritten.
      if (stored && !importedFrom(stored, documentation)) continue;
      const item = {
        ...input,
        id: stored?.item.id ?? randomUUID(),
        status: "published",
        createdAt: stored?.item.createdAt ?? now,
        updatedAt: now,
        publishedAt: stored?.item.publishedAt ?? now,
        revision: (stored?.item.revision ?? 0) + 1,
      };
      if (stored) {
        stored.item = item;
        stored.published = item;
        updated += 1;
      } else {
        file.items.push({ item, published: item });
        added += 1;
      }
    }
    console.log(`${documentation.slug}: ${items.length} pages`);
  }
  if (flags.includes("--list")) return;
  writeLibrary({ revision: file.revision + 1, items: file.items });
  console.log(
    `Library: ${added} added, ${updated} refreshed, ${file.items.length} items in ${libraryPath}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
