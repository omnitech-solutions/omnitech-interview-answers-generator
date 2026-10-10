import type { parseArgs, ParseArgsOptionsConfig } from "node:util";

export function parseScriptArgs<T extends ParseArgsOptionsConfig>(
  options: T,
  args?: string[],
  allowPositionals?: boolean,
): ReturnType<
  typeof parseArgs<{
    options: T;
    strict: true;
    allowPositionals: true;
    tokens: true;
  }>
> & { args: string[] };

export const scriptArgs: typeof parseScriptArgs;
