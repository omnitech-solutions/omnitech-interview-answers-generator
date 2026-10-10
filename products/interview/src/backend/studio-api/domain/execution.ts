const MAX_CODE_CHARS = 200_000;
const MAX_STDIN_CHARS = 64_000;

// [GUARD] The execution routes cap what reaches the runner or the bundler.
export function exceedsExecutionBounds(input: {
  code: string;
  usageCode?: string;
  testCode?: string;
  stdin?: string;
}): boolean {
  return (
    input.code.length > MAX_CODE_CHARS ||
    (input.usageCode?.length ?? 0) > MAX_CODE_CHARS ||
    (input.testCode?.length ?? 0) > MAX_CODE_CHARS ||
    (input.stdin?.length ?? 0) > MAX_STDIN_CHARS
  );
}

export function previewComponentName(value: unknown): string {
  return typeof value === "string" && /^[A-Z][A-Za-z0-9_]*$/.test(value)
    ? value
    : "App";
}
