// Stops everything the development launchers started: `pnpm dev` (web app,
// terminal gateway, agent worker) and `pnpm assistant:dev` (assistant API,
// frontend and its disposable PostgreSQL). Launchers are asked to stop first so
// they shut their children down cleanly; anything still holding one of this
// project's ports afterwards is stopped too, but only if it belongs to this
// repository. Other programs on those ports are reported and left alone.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PORTS = { web: 3000, "terminal gateway": 3001, "assistant frontend": 5175, "assistant API": 8791 };

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readState(file) {
  try {
    return JSON.parse(await readFile(resolve(root, file), "utf8"));
  } catch {
    return undefined;
  }
}

/** SIGTERM, wait, then SIGKILL. Returns whether the process was running. */
async function stop(pid, label, graceMs = 15_000) {
  if (!Number.isInteger(pid) || pid === process.pid || !alive(pid)) return false;
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  if (alive(pid)) {
    process.kill(pid, "SIGKILL");
    console.log(`stopped ${label} (pid ${pid}) after SIGKILL`);
  } else console.log(`stopped ${label} (pid ${pid})`);
  return true;
}

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const listeners = (port) =>
  run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split("\n").filter(Boolean).map(Number);
const belongsHere = (pid) => {
  const command = run("ps", ["-o", "command=", "-p", String(pid)]);
  const cwd = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  return command.includes(root) || cwd.split("\n").some((line) => line.startsWith(`n${root}`));
};

let stopped = 0;
const count = (did) => {
  if (did) stopped += 1;
};

// 1. Launchers first: they stop their own children.
const dev = await readState(".dev-local/state.json");
count(await stop(dev?.launcherPid, "dev launcher"));
const assistant = await readState(".assistant-local/state.json");
count(await stop(assistant?.launcherPid, "assistant launcher"));

// 2. Anything the assistant launcher recorded that outlived it.
for (const [label, pid] of [
  ["assistant API", assistant?.apiPid],
  ["assistant frontend", assistant?.frontendPid],
  ["assistant PostgreSQL", assistant?.postgresPid],
]) {
  if (pid && alive(pid) && belongsHere(pid)) count(await stop(pid, label));
}

// 3. Whatever from this repo still holds one of the project's ports.
for (const [label, port] of Object.entries(PORTS)) {
  for (const pid of listeners(port)) {
    if (belongsHere(pid)) count(await stop(pid, `${label} on :${port}`));
    else
      console.log(
        `port ${port} (${label}) is held by pid ${pid}, which is not from this repository; left running`,
      );
  }
}

console.log(stopped ? `done: ${stopped} process(es) stopped` : "nothing was running");
