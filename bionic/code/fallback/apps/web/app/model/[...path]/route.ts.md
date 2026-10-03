# apps/web/app/model/[...path]/route.ts

_Source: `apps/web/app/model/[...path]/route.ts` (header-comment fallback)_

The on-device (WebGPU) model's packed files, streamed with HTTP Range so a
2 GB download can resume. Served only when ON_DEVICE_MODEL_DIR is set,
which `pnpm dev` does when a packed model is present; the browser checks
every file against the pinned manifest digest, never trusting this route.
