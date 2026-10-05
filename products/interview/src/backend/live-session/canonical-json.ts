// JSON with object keys in sorted order at every depth, so two values compare
// equal whatever order their keys were written in. (The matrix hash in
// context-snapshot.ts has its own fixed byte format and must not use this.)
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, node: unknown) =>
    node !== null && typeof node === "object" && !Array.isArray(node)
      ? Object.fromEntries(
          Object.entries(node as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : node,
  );
