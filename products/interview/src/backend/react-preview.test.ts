import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleReactPreview,
  PreviewCompileError,
  PreviewImportRefusedError,
} from "./react-preview.js";

const SECRET = "HOST-FILE-SECRET-4f9c";

function hostFile(name: string, contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "preview-host-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("bundleReactPreview", () => {
  it("bundles a component that uses React", async () => {
    const javascript = await bundleReactPreview(
      "import { useState } from 'react';\nfunction App() { const [n] = useState(1); return <main>{n}</main>; }",
      "App",
    );
    expect(javascript).toContain("createRoot");
  });

  it.each([
    [
      "an absolute path",
      (path: string) => `import data from ${JSON.stringify(path)};`,
    ],
    [
      "a file: URL",
      (path: string) => `import data from ${JSON.stringify(`file://${path}`)};`,
    ],
    [
      "a relative path",
      (path: string) =>
        `import data from ${JSON.stringify(`../../../../../../../../..${path}`)};`,
    ],
    [
      "a dynamic import",
      (path: string) => `const data = import(${JSON.stringify(path)});`,
    ],
    [
      "a require call",
      (path: string) => `const data = require(${JSON.stringify(path)});`,
    ],
  ])("never inlines a host file imported by %s", async (_name, importer) => {
    const path = hostFile("secret.json", JSON.stringify({ SECRET }));
    const attempt = bundleReactPreview(
      `${importer(path)}\nfunction App() { return <main>{String(data)}</main>; }`,
      "App",
    );
    await expect(attempt).rejects.toThrow(PreviewImportRefusedError);
    await attempt.catch((error: unknown) => {
      expect(String((error as Error).message)).not.toContain(SECRET);
      expect(String((error as Error).message)).not.toContain(path);
    });
  });

  it("refuses a package outside the preview allowlist", async () => {
    await expect(
      bundleReactPreview(
        "import { build } from 'esbuild';\nfunction App() { return <main>{String(build)}</main>; }",
        "App",
      ),
    ).rejects.toThrow(PreviewImportRefusedError);
  });

  it("reports a syntax error with a fixed message that quotes no code", async () => {
    const error = await bundleReactPreview(
      "function App( { return 'my-private-snippet'; }",
      "App",
    ).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(PreviewCompileError);
    expect((error as Error).message).not.toContain("my-private-snippet");
  });
});
