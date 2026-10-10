// A library item as the sections the search index stores: pure text shaping,
// no index and no file. One section per Markdown heading, so a hit can link
// to the heading it was found under.
import type { LibraryItem } from "@omnitech/interview-contracts";
import GithubSlugger from "github-slugger";

// Joins a heading path into the one string field the index stores.
const HEADING_PATH_SEPARATOR = "\u001f";

export interface LibrarySection {
  itemId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  heading: string;
  headingPath: string;
  anchor: string;
  contentType: LibraryItem["contentType"];
  collection: string;
  tags: string[];
  tagsText: string;
  official: boolean;
  primary: boolean;
  publisher: string;
  canonicalUrl: string;
}

export interface LibrarySectionDraft {
  anchor: string;
  body: string;
  headingPath: string[];
}

export function extractLibrarySections(
  markdown: string,
): LibrarySectionDraft[] {
  const slugger = new GithubSlugger();
  const headings: string[] = [];
  const sections: LibrarySectionDraft[] = [];
  let current: LibrarySectionDraft = {
    anchor: "",
    headingPath: [],
    body: "",
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      current.body += `${line}\n`;
      continue;
    }
    if (current.body.trim() || current.headingPath.length > 0) {
      sections.push({ ...current, body: current.body.trim() });
    }
    const level = match[1]?.length ?? 1;
    const heading = plainText(match[2] ?? "");
    headings.splice(level - 1);
    headings[level - 1] = heading;
    current = {
      anchor: slugger.slug(heading),
      headingPath: headings.filter(Boolean),
      body: "",
    };
  }
  if (current.body.trim() || current.headingPath.length > 0) {
    sections.push({ ...current, body: current.body.trim() });
  }
  return sections.length > 0
    ? sections
    : [{ anchor: "", headingPath: [], body: markdown.trim() }];
}

export function toSearchSections(item: LibraryItem): LibrarySection[] {
  return extractLibrarySections(item.body).map((section, index) => ({
    itemId: item.id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    body: plainText(section.body),
    heading: section.headingPath.at(-1) ?? item.title,
    headingPath: section.headingPath.join(HEADING_PATH_SEPARATOR),
    anchor: section.anchor,
    contentType: item.contentType,
    collection: item.collection,
    tags: item.tags,
    tagsText: item.tags.join(" "),
    official: item.source?.official ?? false,
    primary: index === 0,
    publisher: item.source?.publisher ?? "",
    canonicalUrl: item.source?.canonicalUrl ?? "",
  }));
}

export const headingPathOf = (section: LibrarySection): string[] =>
  section.headingPath
    .split(HEADING_PATH_SEPARATOR)
    .filter((value) => value.length > 0);

export function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " code example ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_~>#-]/g, " ")
    .trim();
}
