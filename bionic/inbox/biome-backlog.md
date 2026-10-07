# Biome lint backlog (U47b)

Measured 2026-10-06 on branch `chore/biome-hooks` with `pnpm exec biome lint .` (Biome 2.5.5, 1,294 files). `pnpm lint` exits 0: every rule below that still has findings is set to `warn` in `biome.json`. Later units promote a rule to `error` once its count reaches 0.

Before U47b: 0 errors, 0 warnings (preset `none`, three architecture rules). With the new preset and no triage: 160 errors, 125 warnings, 956 infos. After: **0 errors, 387 warnings, 0 infos**.

Decisions applied: `style/noNonNullAssertion` off (426 hits, mostly tests); `complexity/useLiteralKeys` off (939 infos: it fights `noPropertyAccessFromIndexSignature`-style bracket access on `process.env` and records); `noExplicitAny`, `noArrayIndexKey`, `useYield`, `noEmptyPattern` and the a11y rules are `warn` in `**/*.test.{ts,tsx}` and `e2e/**` by override. Already errors with 0 findings: `useYield` (non-test code), `noUnsafeOptionalChaining`, `noControlCharactersInRegex`, `performance/noAccumulatingSpread`, the four architecture rules.

| Rule | Count | Notes |
| --- | ---: | --- |
| suspicious/noUndeclaredEnvVars | 114 | 29 in `apps/web/src/platform/ai.ts`; declare vars in `turbo.json` `globalEnv`/task `env`, or add the rule's `allowedEnvVars` option |
| suspicious/noExplicitAny | 52 | mostly tests |
| a11y/useSemanticElements | 37 | real UI work |
| suspicious/noArrayIndexKey | 28 | |
| suspicious/noAssignInExpressions | 18 | |
| a11y/useAriaPropsSupportedByRole | 17 | |
| complexity/useOptionalChain | 16 | safe fix available |
| correctness/useYield | 14 | test fakes: empty or side-effect-only async generators in `apps/agent-worker/src/index.test.ts` (10), `hardening/egress.test.ts` (2), `processor-locality.test.ts` (2) |
| style/useTemplate | 13 | safe fix available |
| correctness/noUnusedFunctionParameters | 9 | needs a hand `_` prefix (unsafe fix) |
| complexity/noCommaOperator | 9 | |
| a11y/useFocusableInteractive | 7 | |
| suspicious/noExportsInTest | 7 | |
| a11y/noStaticElementInteractions | 6 | |
| correctness/noEmptyPattern | 4 | |
| correctness/noUnusedVariables | 4 | unsafe fix |
| suspicious/noConfusingVoidType | 3 | |
| suspicious/useIterableCallbackReturn | 3 | |
| suspicious/noTemplateCurlyInString | 3 | |
| suspicious/noShadowRestrictedNames | 2 | |
| suspicious/noImplicitAnyLet | 2 | |
| complexity/noUselessEscapeInRegex | 2 | |
| complexity/noUselessFragments | 2 | |
| a11y/useKeyWithClickEvents | 2 | |
| a11y/noNoninteractiveTabindex | 2 | |
| correctness/noEmptyCharacterClassInRegex | 2 | `scripts/*.test.ts` |
| a11y/useAriaPropsForRole, noAriaHiddenOnFocusable, noRedundantRoles, noNoninteractiveElementToInteractiveRole, useMediaCaption | 1 each | |
| suspicious/noUselessEscapeInString, complexity/useRegexLiterals, style/useConst, complexity/noBannedTypes | 1 each | |

Suggested order: mechanical (`useOptionalChain`, `useTemplate`, `useConst`, `noUselessEscape*`), then `noUndeclaredEnvVars` (config), then the unused-parameter and `any` sweeps, then the a11y group per component.
