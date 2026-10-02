---
name: interview-concept-explainer
description: Prepare concise, spoken-friendly interview briefings and place them in Concept Lab. Use for /explain and plain-language requests to explain full-stack, React, web, backend, DSA, system-design, behavioural, or candidate-experience topics without producing a coding solution.
---

# Interview concept explainer

Treat the supplied arguments as the exact topic or interview question.

## Workflow

1. Classify each supplied question:
   - **Mechanism:** how or why something works.
   - **Comparison/trade-off:** differences, selection criteria, or costs.
   - **Practical API:** framework, browser, protocol, or backend behavior.
   - **DSA pattern:** recognition, invariant, and complexity—not a full coding
     solution.
   - **System design/troubleshooting:** flow, failure boundary, and mitigation.
   - **Experience/behavioural:** evidence-backed mini-STAR.
2. Preserve scope. One supplied question becomes one Question section. Split
   only when the user explicitly supplies distinct questions. Never invent
   subquestions to make a simple prompt look comprehensive.
3. Put the answer a senior interviewer wants to hear first. Prefer a precise
   distinction over extra coverage. Target 30–60 spoken seconds for a simple
   question and 60–90 seconds only for a genuinely multi-part question.
4. When calibrating a batch of questions or assessment coverage, read
   [references/assessment-question-matrix.md](references/assessment-question-matrix.md).
   It is an evaluation matrix, not content that must be repeated in an answer.
5. For candidate examples, use only an explicitly supplied or imported profile.
   Use `interview-answers briefing profiles` to inspect available profiles, then
   request a profile choice if ambiguous. Never read an implicit Desktop or
   cross-checkout path, and never invent a company, system, technology, outcome,
   or metric. Mark evidence gaps clearly.

For personal background, recruiter, leadership, motivation, or behavioural
questions, use a non-technical briefing. Give a concise spoken answer, an
evidence-backed mini-STAR where useful, and exactly three practical talking
points. Do not force a code example. Keep proposal, review, apply, and save as
separate steps through the public briefing CLI. Do not use mock interview mode.

## Output contract

For non-technical personal, recruiter, or behavioural briefings, use the
`BriefingDraft` contract through the briefing CLI. Its answers remain concise
spoken Markdown with exactly three talking points, evidence references, and
explicit gaps. The Concept Lab code-example shape below applies only to
technical concept explanations.

Use exactly this outer Markdown shape:

```markdown
# Short title
## Questions
### Question #1: Concise question
- **Answer:** ...
- **Mechanics:** ...
- **Distinction:** ...

#### Example
```language
// PROBLEM: ...
// STRATEGY: ...
// COMPLEXITY: ...
// [DOMAIN] Concise decision-focused comment when non-trivial.
...
```

#### Talking points
- ...
- ...
- ...
```

- Every supplied question is one Collapse, including a single question.
- Use **2–4 answer bullets** with domain-specific labels. `Answer`,
  `Mechanics`, and `Distinction` are defaults, not mandatory filler.
- Keep answer bullets to **70 words total** for a simple question and **110
  words total** for a multi-part question.
- Always include exactly **3 short Talking points**: details the candidate can
  say if probed, not new essay sections.
- For technical concepts, include exactly **one valid, syntax-highlighted fenced code example**.
  Use the requested language, React/TypeScript for frontend concepts, and
  TypeScript when the language is otherwise ambiguous.
- Bold only the key domain terms, decisions, invariants, and complexity. Put
  API names, identifiers, values, and complexity notation in inline code.
- Do not add an answer plan, `Key point`, invented questions, generic coaching,
  links, or prose that repeats the bullets.

## Code example contract

- Use one focused **7–14 line** example that proves or grounds the answer; omit
  imports and scaffolding unless required for validity.
- Begin every example with the language-appropriate `PROBLEM`, `STRATEGY`, and
  `COMPLEXITY` comment header. Use `N/A` only when runtime complexity genuinely
  does not apply.
- Add concise decision-only comments to non-trivial choices using
  `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, or `[SAFETY]`. Never put
  example inputs, outputs, or I/O traces in source comments.
- For a DSA or coding-solution question, keep the exact required entry point
  above helpers.
- For comparison, web/backend, system-design, or behavioural questions, use a
  small typed configuration, contract, decision function, or evidence object
  instead of replacing code with prose. The snippet must remain technically
  valid and directly relevant; never invent candidate evidence.
- Every non-obvious decision in the snippet needs a labeled comment. Do not
  label or narrate trivial assignments, loop increments, setters, or JSX.

## Domain calibration

- **React:** distinguish render triggers from work that runs during or after a
  render. State that state updates, parent renders, and consumed context can
  schedule rendering; refs, `useMemo`, `useCallback`, and `useEffect` do not
  independently do so. Distinguish render, reconciliation, and DOM commit.
  Mention `Object.is` and shallow per-prop comparison only when equality or
  memoization is relevant; React does not generally deep-compare.
- **Web:** distinguish browser behavior from HTTP behavior and client caches
  from shared caches. State the security boundary for CORS, cookies, storage,
  and authentication.
- **Backend:** lead with the contract, source of truth, consistency boundary,
  and failure/retry behavior. Name idempotency, transactions, queues, or caches
  only when relevant.
- **DSA:** lead with the pattern-recognition clue and invariant. State
  assumptions before complexity, including whether sorting is already given.
- **Communication:** make assumptions and trade-offs speakable. Working,
  testable code comes before optional optimization.

For the regression question “How does React decide when to re-render a
component?”, the answer must remain compact while covering:

- triggers: state update, parent render, consumed context;
- non-triggers: ref mutation and hooks that only memoize or run effects;
- render versus DOM commit;
- equality: `Object.is`/shallow comparison, not general deep comparison;
- one small commented example with representative hooks;
- exactly three talking points.

Never call a React state setter unconditionally during render.

## Concept Lab update

When explicitly invoked, always finish in Concept Lab. Words such as “answer,”
“build,” “design,” and “implement” remain part of the topic; do not switch to
the coding Playground.

When `INTERVIEW_CONCEPT_PROVIDER=codex`, do not call provider-backed
`interview-answers explain`, which would recurse into another generator. Do not
inspect application source or search for update commands. The Concept Lab
terminal gateway owns fast Codex generation and always posts the result to the
append endpoint, so existing answers are preserved. If this skill is invoked
outside that gateway, inspect the current summary once and append whenever an
explanation already exists; use `set --quiet` only for an empty Concept Lab.

For other providers, use:

```bash
interview-answers explain --topic "<topic>"
```

If provider generation fails but the Playground CLI is reachable, prepare the
Markdown locally. Append when Concept Lab already has an answer; use
`interview-answers playground set --quiet` only when it is empty or the user
explicitly asks to replace it. Add `--save` only when asked.

Confirm with `interview-answers playground show --summary`; `view` must be
`concept-lab` and `explanation` must match the requested topic. Report the
exact error only when both update paths fail.

Use related skills only when they materially improve accuracy:

- `openai-docs` for current OpenAI product or API behavior.
- `browser:control-in-app-browser` when visual verification is requested.
