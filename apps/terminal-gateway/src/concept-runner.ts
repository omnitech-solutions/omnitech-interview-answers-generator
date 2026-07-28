import { spawnSync } from "node:child_process";

const command = process.argv[2];
if (!command) process.exit(2);

process.stdout.write(`\r\n› ${command}\r\n\r\n`);
const codex = spawnSync("codex", ["exec", command], {
  env: {
    ...process.env,
    INTERVIEW_CONCEPT_PROVIDER: "codex",
  },
  stdio: "inherit",
});
if (codex.error) {
  console.error(codex.error.message);
} else if (codex.status !== 0) {
  console.error(`Codex exited with status ${codex.status ?? "unknown"}.`);
}

const shell = process.env["SHELL"] || "/bin/zsh";
process.stdout.write(
  "\r\nCodex session finished. The terminal remains available.\r\n\r\n",
);
spawnSync(shell, ["-i"], { stdio: "inherit" });
