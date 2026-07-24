import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type CodexCompatOptions = {
  readonly projectRoot: string;
  readonly check?: boolean;
};

export type CodexCompatResult = {
  readonly commands: readonly string[];
  readonly skills: readonly string[];
  readonly changed: boolean;
};

const MANAGED_DIRECTORIES = ["commands", "context", "rules", "skills"] as const;

export function findRulesyncProjectRoot(startDirectory: string): string {
  let current = path.resolve(startDirectory);

  while (true) {
    if (existsSync(path.join(current, ".rulesync"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not find a .rulesync directory from: ${startDirectory}`,
      );
    }
    current = parent;
  }
}

export function generateCodexCompat({
  projectRoot,
  check = false,
}: CodexCompatOptions): CodexCompatResult {
  const rulesyncRoot = path.join(projectRoot, ".rulesync");
  const codexRoot = path.join(projectRoot, ".codex");

  assertDirectory(rulesyncRoot);

  const commands = markdownNames(path.join(rulesyncRoot, "commands"));
  const sourceSkills = directoryNames(path.join(rulesyncRoot, "skills"));
  const routeSkills = commands.map(
    (command) => `codex-interview-route-${command}`,
  );
  const skills = [...sourceSkills, ...routeSkills].toSorted();
  const expected = buildExpectedFiles(rulesyncRoot, commands, skills);
  const changed = hasChanges(codexRoot, expected);

  if (check) {
    if (changed) {
      throw new Error(
        "Generated .codex output is stale. Run `pnpm rulesync:generate`.",
      );
    }

    return { commands, skills, changed: false };
  }

  mkdirSync(codexRoot, { recursive: true });
  for (const directory of MANAGED_DIRECTORIES) {
    rmSync(path.join(codexRoot, directory), { recursive: true, force: true });
  }

  copyDirectory(
    path.join(rulesyncRoot, "commands"),
    path.join(codexRoot, "commands"),
  );
  copyDirectory(
    path.join(rulesyncRoot, "rules"),
    path.join(codexRoot, "rules"),
  );
  copyDirectory(
    path.join(rulesyncRoot, "rules"),
    path.join(codexRoot, "context"),
  );
  copyDirectory(
    path.join(rulesyncRoot, "skills"),
    path.join(codexRoot, "skills"),
  );

  for (const command of commands) {
    const destination = path.join(
      codexRoot,
      "skills",
      `codex-interview-route-${command}`,
      "SKILL.md",
    );
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, renderRouteSkill(command));
  }

  writeFileSync(
    path.join(codexRoot, "config.toml"),
    renderConfig(commands, skills),
  );
  writeFileSync(
    path.join(codexRoot, "generated.json"),
    `${JSON.stringify({ commands, skills }, null, 2)}\n`,
  );

  return { commands, skills, changed };
}

function buildExpectedFiles(
  rulesyncRoot: string,
  commands: readonly string[],
  skills: readonly string[],
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();

  collectFiles(path.join(rulesyncRoot, "commands"), "commands", files);
  collectFiles(path.join(rulesyncRoot, "rules"), "rules", files);
  collectFiles(path.join(rulesyncRoot, "rules"), "context", files);
  collectFiles(path.join(rulesyncRoot, "skills"), "skills", files);

  for (const command of commands) {
    files.set(
      path.join("skills", `codex-interview-route-${command}`, "SKILL.md"),
      renderRouteSkill(command),
    );
  }

  files.set("config.toml", renderConfig(commands, skills));
  files.set(
    "generated.json",
    `${JSON.stringify({ commands, skills }, null, 2)}\n`,
  );

  return files;
}

function hasChanges(
  codexRoot: string,
  expected: ReadonlyMap<string, string>,
): boolean {
  if (!existsSync(codexRoot)) {
    return true;
  }

  const actual = new Map<string, string>();
  for (const directory of MANAGED_DIRECTORIES) {
    collectFiles(path.join(codexRoot, directory), directory, actual);
  }
  for (const file of ["config.toml", "generated.json"]) {
    const filePath = path.join(codexRoot, file);
    if (existsSync(filePath)) {
      actual.set(file, readFileSync(filePath, "utf8"));
    }
  }

  if (actual.size !== expected.size) {
    return true;
  }

  return [...expected].some(([file, content]) => actual.get(file) !== content);
}

function collectFiles(
  directory: string,
  relativeRoot: string,
  output: Map<string, string>,
): void {
  if (!existsSync(directory)) {
    return;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    const relative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      collectFiles(source, relative, output);
    } else if (entry.isFile()) {
      output.set(relative, readFileSync(source, "utf8"));
    }
  }
}

function copyDirectory(source: string, destination: string): void {
  if (!existsSync(source)) {
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function markdownNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3))
    .toSorted();
}

function directoryNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function assertDirectory(directory: string): void {
  if (!existsSync(directory)) {
    throw new Error(`Rulesync source directory not found: ${directory}`);
  }
}

function renderRouteSkill(command: string): string {
  return `---
name: codex-interview-route-${command}
description: Route the ${command} interview workflow in Codex. Use when the user invokes /${command} or makes an unambiguous request matching that command.
---

# ${title(command)} route

1. Read \`.codex/commands/${command}.md\` completely.
2. Follow that workflow exactly, including its skill and CLI requirements.
3. If the generated command is unavailable, read
   \`.rulesync/commands/${command}.md\` as the source fallback.
4. Preserve explicit language, persistence, panel, and verification choices.
`;
}

function renderConfig(
  commands: readonly string[],
  skills: readonly string[],
): string {
  const routes = commands
    .map((command) => `  - /${command} -> codex-interview-route-${command}`)
    .join("\n");
  const registry = skills
    .map(
      (skill) => `[[skills.config]]
path = ".codex/skills/${skill}/SKILL.md"
enabled = true
`,
    )
    .join("\n");

  return `#:schema https://developers.openai.com/codex/config-schema.json

# Generated from .rulesync by @omnitech/interview-rulesync-codex.
# Edit the canonical .rulesync sources, then run pnpm rulesync:generate.
developer_instructions = """
Interview workflow routing:
- Classify coding questions and Playground requests before acting.
- Activate codex-interview-routing for explicit slash commands and matching
  plain-language requests.
${routes}
- Use interview-question-router to choose PHP, React, TypeScript, or Ruby.
- Use interview-playground-controller for app updates and keep the
  interview-answers playground CLI as the control boundary.
- Do not force interview routing for unrelated repository work.
"""

${registry}`;
}

function title(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
