// The pre-push gate: `pnpm verify`, remembered per commit.
//
// git opens the connection to the remote BEFORE it runs the pre-push hook. The
// full verify takes about eight minutes; GitHub closes the idle connection
// well before that, and the push then dies with SIGPIPE after a green gate.
// So the gate is run once per HEAD and stamped: a hook that finds a fresh
// stamp for the exact commit it is about to push, on a clean tree, lets the
// push go at once; anything else runs the whole verify (and stamps on green).
//
//   node scripts/verify-gate.mjs        # run verify for HEAD, stamp on green
//   git push                            # the hook finds the stamp and pushes
//
// The gate is never skipped: a stamp exists only because this script ran the
// full verify on that commit. The stamps live in .dev-local (ignored by git).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STAMP_TTL_MS = 30 * 60 * 1000;
const root = process.cwd();
const stampDir = join(root, ".dev-local", "verify-stamps");

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
// Only tracked changes matter: an uncommitted edit means the stamp proves
// nothing about what would be pushed.
const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
const stamp = join(stampDir, head);

if (!dirty && existsSync(stamp)) {
  const at = Number(readFileSync(stamp, "utf8"));
  const age = Date.now() - at;
  if (Number.isFinite(at) && age >= 0 && age < STAMP_TTL_MS) {
    console.log(
      `verify-gate: ${head.slice(0, 7)} verified ${Math.round(age / 1000)}s ago; pushing without re-running.`,
    );
    process.exit(0);
  }
}

console.log(`verify-gate: running pnpm verify for ${head.slice(0, 7)}…`);
const run = spawnSync("pnpm", ["verify"], { cwd: root, stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
if (!dirty) {
  mkdirSync(stampDir, { recursive: true });
  writeFileSync(stamp, String(Date.now()));
  console.log(`verify-gate: green; stamped ${head.slice(0, 7)}.`);
} else {
  console.log("verify-gate: green, but the tree has uncommitted changes; not stamped.");
}
