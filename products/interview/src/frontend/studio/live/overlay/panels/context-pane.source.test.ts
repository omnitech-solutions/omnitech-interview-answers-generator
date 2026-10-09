import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The pane is drawn from the UI library's parts alone: no style of its own and
// no layout element of its own. A part that is missing is added to the library.
describe("context-pane.tsx, as written", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "context-pane.tsx"),
    "utf8",
  );

  it("has no inline style and no style table", () => {
    expect(source).not.toMatch(/\bstyle\s*=/);
    expect(source).not.toMatch(/\bSTYLE\b/);
    expect(source).not.toMatch(/CSSProperties/);
    // No colour of its own either: a hex or an rgb() value.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it.each(["div", "span", "p", "section"])(
    "draws no <%s> of its own",
    (tag) => {
      expect(source).not.toMatch(new RegExp(`<${tag}(?=[\\s>/])`));
    },
  );

  it("imports its parts from the UI library and no stylesheet", () => {
    expect(source).toMatch(/from "@oc-tech\/omni-ui-components"/);
    expect(source).not.toMatch(/\.css"/);
    expect(source).not.toMatch(/className\s*=/);
  });
});
