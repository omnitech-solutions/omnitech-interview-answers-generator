// Joins class names, skipping anything falsy. The whole of what `cn` did in the
// reference library: plain CSS needs no tailwind-merge.
export function join(
  ...parts: ReadonlyArray<string | false | null | undefined>
) {
  return parts.filter(Boolean).join(" ");
}
