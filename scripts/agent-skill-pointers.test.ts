import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repoRoot } from "./guard-support";

// Root AGENTS.md routes agents to these project skills. A Crux update that
// rewrites AGENTS.md, or a deleted or renamed skill, breaks the route silently.
const pointed = ["technology-references", "bionic-regeneration"];

it.each(pointed)("AGENTS.md names skill %s and the skill exists", (name) => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  expect(agents).toContain(name);
  const skill = join(repoRoot, ".agents/skills", name, "SKILL.md");
  expect(existsSync(skill), `${skill} is missing`).toBe(true);
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(skill, "utf8"));
  expect(frontmatter?.[1]).toMatch(new RegExp(`^name: ${name}$`, "m"));
});
