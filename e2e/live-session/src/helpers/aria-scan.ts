// Finds every interactive element a person (or a screen reader) can reach on a
// page, from Playwright's accessibility snapshot: role and accessible name.
// The claims inventory is checked against this list, so a control cannot ship
// without someone writing down what it claims to do.
import type { Page } from "@playwright/test";

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "radio",
  "checkbox",
  "switch",
  "textbox",
  "combobox",
  "searchbox",
  "slider",
  "spinbutton",
  "option",
]);

export type FoundControl = { role: string; name: string; disabled: boolean };

// One snapshot line: `- button "Name" [pressed] [disabled]:` or, when the name
// holds a colon, the whole entry quoted: `- 'button "Name: x"'`.
const LINE =
  /^\s*- (?:'(?<single>[a-z]+) "(?<sname>(?:[^"\\]|\\.|'')*)"(?<sattrs>[^']*)'|(?<role>[a-z]+)(?: "(?<name>(?:[^"\\]|\\.)*)")?(?<attrs>(?: \[[^\]]+\])*))/;

export function parseControls(snapshot: string): FoundControl[] {
  const found: FoundControl[] = [];
  for (const line of snapshot.split("\n")) {
    const match = LINE.exec(line);
    const groups = match?.groups;
    if (!groups) continue;
    const role = groups["single"] ?? groups["role"];
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;
    const raw = groups["sname"] ?? groups["name"] ?? "";
    const attrs = groups["sattrs"] ?? groups["attrs"] ?? "";
    found.push({
      role,
      name: raw.replaceAll('\\"', '"').replaceAll("''", "'"),
      disabled: /\[disabled\]/.test(attrs),
    });
  }
  return found;
}

export async function scanControls(page: Page): Promise<FoundControl[]> {
  return parseControls(await page.locator("body").ariaSnapshot());
}
