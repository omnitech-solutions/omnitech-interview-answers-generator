// Copies the text-recognition engine's own files into apps/web/public/ocr, so
// the page loads the worker, the WebAssembly core and the English data from our
// own origin (D31: no CDN, no remote asset). Run before `next dev` and
// `next build`; the output is generated and ignored by git.
//
//   /ocr/worker.min.js   tesseract.js worker
//   /ocr/core/           the LSTM-only cores (the browser picks by SIMD support)
//   /ocr/lang/           eng.traineddata.gz (4.0.0_best_int)
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The engine is a dependency of the interview product, which owns the page code.
const fromProduct = createRequire(
  new URL("../../../products/interview/package.json", import.meta.url),
);
const tesseract = dirname(fromProduct.resolve("tesseract.js/package.json"));
const core = dirname(
  createRequire(join(tesseract, "package.json")).resolve(
    "tesseract.js-core/package.json",
  ),
);
const language = dirname(
  fromProduct.resolve("@tesseract.js-data/eng/package.json"),
);

// fileURLToPath decodes the URL: a checkout path with a space stays a space
// instead of becoming a literal "%20" directory.
const target = fileURLToPath(new URL("../public/ocr/", import.meta.url));
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "core"), { recursive: true });
mkdirSync(join(target, "lang"), { recursive: true });

copyFileSync(join(tesseract, "dist/worker.min.js"), join(target, "worker.min.js"));
for (const name of [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
])
  copyFileSync(join(core, name), join(target, "core", name));
copyFileSync(
  join(language, "4.0.0_best_int/eng.traineddata.gz"),
  join(target, "lang/eng.traineddata.gz"),
);
