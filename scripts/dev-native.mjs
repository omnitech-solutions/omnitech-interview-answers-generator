// The native half of `pnpm dev`: keeps the Mac app built from the Swift
// sources as they are now (scripts/native-app.mjs has the rules).
//
//   node scripts/dev-native.mjs           one pass; exit 1 only if a build failed
//   node scripts/dev-native.mjs --watch   one pass, then again whenever a Swift
//                                         source changes; never exits on a failure
//
// It prints short lines prefixed "[native]"; the compiler's own output goes to
// .dev-local/native-app/build.log. It never stops or starts the app.
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nativeApp,
  realEffects,
  runOnce,
  skipReason,
  stopBuilds,
} from "./native-app.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const say = (line) => console.log(`[native] ${line}`);
const effects = realEffects(root, say);
const watching =
  process.argv.includes("--watch") &&
  !skipReason(process.env, process.platform);

// One pass at a time; a change that arrives during a pass runs one more.
let busy = false;
let again = false;
let waitingForQuit = false;
async function pass({ quiet = false } = {}) {
  if (busy) {
    again = true;
    return undefined;
  }
  busy = true;
  let outcome = "failed";
  try {
    const started = Date.now();
    const result = await runOnce(effects);
    outcome = result.outcome;
    // A watcher that found nothing to do has nothing to say.
    if (!(quiet && outcome === "current"))
      for (const line of result.lines)
        say(
          outcome === "current"
            ? `${line} (${Date.now() - started} ms)`
            : line,
        );
  } catch (error) {
    // A defect here is this task's problem, never the dev server's.
    const reason = error instanceof Error ? error.message : String(error);
    say(`gave up: ${reason}; rerun: ${nativeApp.rerun}`);
  }
  waitingForQuit = outcome === "restart-needed";
  busy = false;
  if (again) {
    again = false;
    return pass({ quiet: true });
  }
  return outcome;
}

if (watching) {
  const stop = () => {
    stopBuilds();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // Swift sources saved during the session, the first build included: wait
  // for the writes to settle, then look again.
  let settle;
  const changed = (_event, file) => {
    // The compiler's output lives in the watched folders; it is not a change.
    if (file && nativeApp.unwatched.test(file)) return;
    clearTimeout(settle);
    settle = setTimeout(() => pass({ quiet: true }), 1000);
  };
  try {
    for (const folder of nativeApp.watch)
      watch(join(root, folder), { recursive: true }, changed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    say(`not watching for changes (${reason}); rerun: ${nativeApp.rerun}`);
  }

  const launcher = process.ppid;
  setInterval(() => {
    // The launcher is gone (killed without a signal reaching here): stop too.
    if (process.ppid !== launcher) stop();
    // A build is waiting for the app to quit: install it once it has.
    if (waitingForQuit && !busy && !effects.appRunning()) pass({ quiet: true });
  }, 3000);
}

const outcome = await pass();
if (!watching) process.exit(outcome === "failed" ? 1 : 0);
