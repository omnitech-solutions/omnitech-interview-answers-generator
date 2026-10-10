import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  BEHAVIOUR_FLAGS,
  type BehaviourFlagEnvironment,
  type BehaviourFlagKey,
  type BehaviourFlagState,
  type BehaviourFlagValue,
  behaviourFlag,
  behaviourFlagValue,
  resolveBehaviourFlags,
  type StoredBehaviourFlags,
} from "@omnitech/interview-contracts";

// [DOMAIN] What Settings stored for the behaviour flags (the registry is
// BEHAVIOUR_FLAGS in the contracts). The flags are this machine's, as their
// environment variables are, so like the coach's plan they are kept in one
// small file in the data directory, beside it: no table, and nothing per
// tenant. The environment still wins over what is here (see the registry).
//
// [SAFETY] The file holds flag names and values from closed lists only: never
// content, never a secret. A value outside a flag's list is not kept.
export function createBehaviourFlagStore(
  filePath: string,
  env: BehaviourFlagEnvironment = process.env,
) {
  let held: StoredBehaviourFlags | null = null;
  const read = (): StoredBehaviourFlags => {
    if (held !== null) return held;
    held = {};
    try {
      const kept = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (kept && typeof kept === "object")
        for (const flag of BEHAVIOUR_FLAGS) {
          const value = (kept as Record<string, unknown>)[flag.env];
          if ((flag.values as readonly unknown[]).includes(value))
            held[flag.env] = value as string;
        }
    } catch {
      // No file yet, or one that cannot be read: nothing is stored.
    }
    return held;
  };
  return {
    /** Every flag as it is in force in this process, and why. */
    list: (): BehaviourFlagState[] => resolveBehaviourFlags(env, read()),
    /** One flag's value in force: read where the flag is used. */
    value: <K extends BehaviourFlagKey>(key: K): BehaviourFlagValue<K> =>
      behaviourFlagValue(env, key, read()),
    /**
     * Stores one flag. `invalid`: no such flag or value. `environment`: the
     * host set it, so Settings may not change it. Nothing is stored for either.
     */
    set(key: string, value: string): "stored" | "invalid" | "environment" {
      const flag = behaviourFlag(key);
      if (!flag || !(flag.values as readonly string[]).includes(value))
        return "invalid";
      const state = resolveBehaviourFlags(env, read()).find(
        (each) => each.key === flag.env,
      );
      if (state?.source === "environment") return "environment";
      held = { ...read(), [flag.env]: value };
      try {
        // Written beside the file and moved over it, so a reader never sees half.
        mkdirSync(dirname(filePath), { recursive: true });
        const draft = `${filePath}.${randomUUID()}.tmp`;
        writeFileSync(draft, JSON.stringify(held));
        renameSync(draft, filePath);
      } catch {
        // Held for this process; the next change tries the file again.
      }
      return "stored";
    },
  };
}

export type BehaviourFlagStore = ReturnType<typeof createBehaviourFlagStore>;

export const behaviourFlags = createBehaviourFlagStore(
  join(
    process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data"),
    "behaviour-flags.json",
  ),
);
