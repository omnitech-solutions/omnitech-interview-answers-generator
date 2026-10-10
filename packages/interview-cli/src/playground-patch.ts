// The decisions of `playground set`, as pure functions: where the patch comes
// from, which controls the named options set, and what the answer options
// ask for. No file is read here; the command reads what these name.
import type { PlaygroundAnswerLanguage } from "@omnitech/interview-playground-control";

export interface PlaygroundSetOptions {
  file?: string;
  question?: string;
  language?: string;
  notes?: string;
  panel?: string;
  view?: string;
  title?: string;
  guideFile?: string;
  codeFile?: string;
  usageCodeFile?: string;
  testCodeFile?: string;
  clearAnswer?: boolean;
  quiet?: boolean;
}

const CONTROL_OPTIONS = [
  "question",
  "language",
  "notes",
  "panel",
  "view",
] as const satisfies ReadonlyArray<keyof PlaygroundSetOptions>;

const ANSWER_OPTIONS = [
  "title",
  "guideFile",
  "codeFile",
  "usageCodeFile",
  "testCodeFile",
] as const satisfies ReadonlyArray<keyof PlaygroundSetOptions>;

const hasAnswerOptions = (options: PlaygroundSetOptions): boolean =>
  ANSWER_OPTIONS.some((name) => options[name] !== undefined);

// A JSON patch (from --file, or piped when no option names a control) wins
// over the named options.
export function readsJsonPatch(
  options: PlaygroundSetOptions,
  stdinIsTTY: boolean,
): boolean {
  const hasNamedOptions =
    CONTROL_OPTIONS.some((name) => options[name] !== undefined) ||
    hasAnswerOptions(options) ||
    (options.clearAnswer !== undefined && options.clearAnswer !== false);
  return Boolean(options.file) || (!hasNamedOptions && !stdinIsTTY);
}

// The controls the named options set, before validation by the patch parser.
export const controlsFrom = (
  options: PlaygroundSetOptions,
): Record<string, string> =>
  Object.fromEntries(
    CONTROL_OPTIONS.flatMap((name) => {
      const value = options[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

export type AnswerIntent =
  | { kind: "keep" }
  | { kind: "clear" }
  | {
      kind: "replace";
      title: string;
      language: PlaygroundAnswerLanguage;
      guideFile: string;
      codeFile: string;
      usageCodeFile?: string;
      testCodeFile?: string;
    };

// [GUARD] An answer is cleared or replaced whole, never both and never in
// part: a replacement names its title, guide, code and a real language.
export function answerIntent(options: PlaygroundSetOptions): AnswerIntent {
  const replaces = hasAnswerOptions(options);
  if (options.clearAnswer && replaces)
    throw new Error(
      "--clear-answer cannot be combined with answer field options.",
    );
  if (!replaces)
    return options.clearAnswer ? { kind: "clear" } : { kind: "keep" };
  if (
    !options.title ||
    !options.guideFile ||
    !options.codeFile ||
    !options.language ||
    options.language === "auto"
  )
    throw new Error(
      "An answer requires --title, --guide-file, --code-file, and a non-auto --language.",
    );
  return {
    kind: "replace",
    title: options.title,
    language: options.language as PlaygroundAnswerLanguage,
    guideFile: options.guideFile,
    codeFile: options.codeFile,
    ...(options.usageCodeFile ? { usageCodeFile: options.usageCodeFile } : {}),
    ...(options.testCodeFile ? { testCodeFile: options.testCodeFile } : {}),
  };
}
