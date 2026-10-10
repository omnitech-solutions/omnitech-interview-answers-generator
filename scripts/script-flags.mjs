import { parseArgs } from "node:util";

// Flags are declared at the call site; Node owns validation and tokenisation.
/**
 * @template {import("node:util").ParseArgsOptionsConfig} T
 * @param {T} options
 * @param {string[]} [args]
 * @param {boolean} [allowPositionals]
 * @returns {ReturnType<typeof parseArgs<{ options: T; strict: true; allowPositionals: true; tokens: true }>> & { args: string[] }}
 */
export function parseScriptArgs(
  options,
  args = process.argv.slice(2),
  allowPositionals = false,
) {
  // pnpm may forward a leading separator to a flags-only script.
  const passed = !allowPositionals && args[0] === "--" ? args.slice(1) : args;
  try {
    return {
      ...parseArgs({
        args: passed,
        options,
        strict: true,
        allowPositionals,
        tokens: true,
      }),
      args: passed,
    };
  } catch (error) {
    throw new Error(`Invalid arguments: ${error.message}`, { cause: error });
  }
}

// What a script calls: a mistyped flag is the caller's mistake, so it is said
// in one line with no stack, and the script ends with status 2.
/** @type {typeof parseScriptArgs} */
export function scriptArgs(options, args, allowPositionals) {
  try {
    return parseScriptArgs(options, args, allowPositionals);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
