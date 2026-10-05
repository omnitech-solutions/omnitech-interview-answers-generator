import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

// The preview bundles the caller's code, so the caller must not be able to
// make the bundler read the host: only these bare packages resolve from the
// entry, everything else (relative, absolute, file:, other packages) is refused.
const PREVIEW_PACKAGES: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
]);

const ENTRY = "preview-entry.tsx";

// Where react and react-dom are installed for this server: beside this module
// first (the product declares them, so this is stable whatever directory the
// server or a test was started from), else the working directory (a bundled
// server whose own location is not a source tree, such as the web app).
function previewPackageDir(): string {
  const candidates: string[] = [];
  if (import.meta.url.startsWith("file:"))
    candidates.push(dirname(fileURLToPath(import.meta.url)));
  candidates.push(process.cwd());
  for (const dir of candidates) {
    try {
      createRequire(join(dir, "resolve.js")).resolve("react-dom/package.json");
      return dir;
    } catch {
      // not installed from here: try the next place
    }
  }
  return process.cwd();
}

export class PreviewImportRefusedError extends Error {
  constructor() {
    super("The preview may import only react and react-dom.");
    this.name = "PreviewImportRefusedError";
  }
}

export class PreviewCompileError extends Error {
  constructor() {
    super("The preview code could not be compiled.");
    this.name = "PreviewCompileError";
  }
}

// [SAFETY] Imports made by the entry go through the allowlist. Files inside an
// allowlisted package resolve normally (react's own internal requires).
function allowlistedImports(packageDir: string, onRefused: () => void): Plugin {
  return {
    name: "preview-import-allowlist",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData || !args.importer.endsWith(ENTRY)) return;
        if (!PREVIEW_PACKAGES.has(args.path)) {
          onRefused();
          return {
            errors: [{ text: new PreviewImportRefusedError().message }],
          };
        }
        return pluginBuild.resolve(args.path, {
          kind: args.kind,
          resolveDir: packageDir,
          // Marks the nested resolve so this hook does not see it again.
          pluginData: true,
        });
      });
    },
  };
}

export async function bundleReactPreview(
  code: string,
  componentName: string,
): Promise<string> {
  // The entry is virtual: its resolveDir is an empty directory, so nothing on
  // the host sits beside it to be reached.
  let refused = false;
  const emptyDir = await mkdtemp(join(tmpdir(), "react-preview-"));
  try {
    const result = await build({
      bundle: true,
      format: "iife",
      jsx: "automatic",
      platform: "browser",
      write: false,
      logLevel: "silent",
      plugins: [
        allowlistedImports(previewPackageDir(), () => {
          refused = true;
        }),
      ],
      stdin: {
        contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            ${code}
            const Candidate = typeof ${componentName} !== 'undefined' ? ${componentName} : null;
            if (!Candidate) {
              throw new Error('Export or declare a preview component.');
            }
            createRoot(document.getElementById('root')).render(React.createElement(Candidate));
          `,
        loader: "tsx",
        sourcefile: ENTRY,
        resolveDir: emptyDir,
      },
    });
    return result.outputFiles[0]?.text ?? "";
  } catch {
    // The bundler's text quotes the caller's code and the host's paths.
    throw refused ? new PreviewImportRefusedError() : new PreviewCompileError();
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
}
