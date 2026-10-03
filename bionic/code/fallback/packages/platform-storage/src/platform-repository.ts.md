# packages/platform-storage/src/platform-repository.ts

_Source: `packages/platform-storage/src/platform-repository.ts` (header-comment fallback)_

[SAFETY] Memberships are tenant-owned rows under forced row-level
security: the person and the slug's tenant are found first, then the
membership is read inside that tenant.
