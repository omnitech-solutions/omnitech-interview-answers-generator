import { findRulesyncProjectRoot, generateCodexCompat } from "./index.js";

const check = process.argv.includes("--check");

try {
  const result = generateCodexCompat({
    projectRoot: findRulesyncProjectRoot(process.cwd()),
    check,
  });
  const action = check ? "verified" : "generated";
  console.log(
    `.codex ${action}: ${result.commands.length} commands, ${result.skills.length} skills`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
