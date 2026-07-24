import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findRulesyncProjectRoot, generateCodexCompat } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generateCodexCompat", () => {
  it("mirrors Rulesync sources and creates command route skills", async () => {
    const root = await project();

    const result = generateCodexCompat({ projectRoot: root });

    expect(result.commands).toEqual(["answer", "playground-show"]);
    expect(result.skills).toContain("codex-interview-route-answer");
    expect(
      readFileSync(
        path.join(root, ".codex/skills/codex-interview-route-answer/SKILL.md"),
        "utf8",
      ),
    ).toContain("Read `.codex/commands/answer.md` completely.");
    expect(
      readFileSync(path.join(root, ".codex/commands/answer.md"), "utf8"),
    ).toBe("# Answer\n");
    expect(
      readFileSync(path.join(root, ".codex/config.toml"), "utf8"),
    ).toContain("/answer -> codex-interview-route-answer");
  });

  it("passes check mode only while generated output matches", async () => {
    const root = await project();
    generateCodexCompat({ projectRoot: root });

    expect(() =>
      generateCodexCompat({ projectRoot: root, check: true }),
    ).not.toThrow();

    writeFileSync(
      path.join(root, ".rulesync/commands/answer.md"),
      "# Changed\n",
    );

    expect(() =>
      generateCodexCompat({ projectRoot: root, check: true }),
    ).toThrow("Generated .codex output is stale");
  });

  it("removes stale managed output on regeneration", async () => {
    const root = await project();
    generateCodexCompat({ projectRoot: root });
    writeFile(path.join(root, ".codex/skills/stale/SKILL.md"), "# Stale\n");

    generateCodexCompat({ projectRoot: root });

    expect(() =>
      readFileSync(path.join(root, ".codex/skills/stale/SKILL.md"), "utf8"),
    ).toThrow();
  });

  it("fails clearly when the canonical source is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-compat-missing-"));
    temporaryDirectories.push(root);

    expect(() => generateCodexCompat({ projectRoot: root })).toThrow(
      "Rulesync source directory not found",
    );
  });
});

describe("findRulesyncProjectRoot", () => {
  it("walks up from a workspace package", async () => {
    const root = await project();
    const nested = path.join(root, "packages/generator");
    mkdirSync(nested, { recursive: true });

    expect(findRulesyncProjectRoot(nested)).toBe(root);
  });

  it("fails when no ancestor contains Rulesync sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-root-missing-"));
    temporaryDirectories.push(root);

    expect(() => findRulesyncProjectRoot(root)).toThrow(
      "Could not find a .rulesync directory",
    );
  });
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-compat-"));
  temporaryDirectories.push(root);

  writeFile(path.join(root, ".rulesync/commands/answer.md"), "# Answer\n");
  writeFile(
    path.join(root, ".rulesync/commands/playground-show.md"),
    "# Show\n",
  );
  writeFile(path.join(root, ".rulesync/rules/base.md"), "# Base\n");
  writeFile(
    path.join(root, ".rulesync/skills/interview-question-router/SKILL.md"),
    "# Router\n",
  );

  return root;
}

function writeFile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
