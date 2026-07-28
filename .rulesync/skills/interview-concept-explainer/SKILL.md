---
name: interview-concept-explainer
description: Prepare concise, spoken-friendly interview briefings and place them in Concept Lab. Use for /explain and plain-language requests to explain full-stack, React, web, backend, DSA, system-design, behavioural, or candidate-experience topics without producing a coding solution.
---

# Interview concept explainer

Treat the supplied arguments as the topic or interview question.

1. Identify whether the topic is conceptual, system-design, behavioural, or
   candidate-experience based.
2. For candidate examples, inspect
   `/Users/desoleary/dev/omnitech-solutions/docx-generator-studio/server/data/profiles/my-experience-matrix.json`.
   Treat it as authoritative: never invent a company, system, technology,
   outcome, or metric.
3. When this skill is explicitly invoked, always finish in Concept Lab. Treat
   words such as "answer", "build", "design", and "implement" as part of the
   topic; do not switch to the coding-answer Playground. Use
   `interview-question-router` only when this skill was not explicitly invoked
   and the user clearly requests a runnable coding solution in Playground.
4. Act as a senior technical interviewer, interview coach, and personal
   cheatsheet writer. Put the answer an interviewer wants to hear first. Make
   it technically precise, concise, point-form, easy to scan, and usable
   without rewriting.
5. Every supplied question must be its own Collapse section, including a
   single-question prompt. Organize the Markdown exactly as:
   - `# Short title`
   - `## Questions`
   - `### Question #1: Concise question`
   - Exactly three answer bullets labelled `**Direct answer:**`,
     `**How it works:**`, and `**Interviewer distinction:**`, totaling no more
     than 90 spoken words per question.
   - `#### Code example`: for programming, framework, and API questions, one
     valid fenced block with the correct language, 6–12 lines, and only 2–4
     representative behaviors. Prefer a small snippet over scaffolding. Never
     call a React state setter unconditionally during render. Comment every
     demonstrated behavior with what triggers, does not trigger, or merely
     runs after work.
   - For non-code questions, use `#### Example` with 2–3 bullets instead.
   - `#### Talking points`: always include exactly 3 short bullets for likely
     interviewer probes.
   Repeat the Question section only for distinct questions supplied by the
   user. Concept Lab renders each Question section as one Collapse with a blue
   header; its answer, example, and talking points remain together inside.
6. Do not add `Key point`, an answer plan, invented questions, generic advice,
   or prose that repeats the bullets. Put inline API names in backticks and
   declare the language on every code block.
7. Choose details by asking, "Would a senior interviewer expect this
   distinction?" For React rendering questions, distinguish state, parent
   rendering, context, refs, effects, memoization, reconciliation, and DOM
   commits when relevant. Choose only the 2–4 most illustrative React APIs for
   the code block and cover remaining distinctions in Talking points. Put state
   setters inside an event handler or effect and state that refs, memo hooks,
   and effect hooks do not independently schedule rendering. State that
   React uses identity/value checks such as
   `Object.is` and shallow per-prop comparison where applicable; it does not
   generally perform deep comparison. Avoid repetition and exhaustive guides.
   Never communicate question/answer color through inline HTML or hard-coded
   color names; the heading and blockquote convention owns presentation and
   remains accessible without color.
8. Include one Mermaid diagram only when sequence, lifecycle, data flow, or
   architecture is materially easier to understand visually. Keep it to 8
   nodes or fewer when practical. The diagram does not count toward the spoken
   word budget and must reinforce rather than duplicate the prose.
9. When `INTERVIEW_CONCEPT_PROVIDER=codex`, Codex itself is the selected
   generator. Prepare the final Markdown directly and update Concept Lab through
   `interview-answers playground set --quiet` using JSON on stdin. Do not invoke the
   provider-backed `interview-answers explain` command, which would recursively
   call another configured provider. Keep this to one update command and one
   verification command; do not create or print a temporary patch file.
   Otherwise, update Concept Lab through
   `interview-answers explain --topic "<topic>"`.
   When Concept Lab already contains a briefing and the user asks a subsequent
   question in the same session, add `--append`; appended entries render
   collapsed and preserve the existing briefing. Omit `--append` only when the
   user asks to replace the session or start a new topic. Add `--save` only when
   the user asks to persist the briefing.
10. Confirm with `interview-answers playground show --summary`; `view` must be
   `concept-lab` and `explanation` must match the requested topic.

Use related skills only when they materially improve accuracy:

- Use `openai-docs` for current OpenAI product or API behaviour.
- Use `browser:control-in-app-browser` to verify the rendered result when the
  app is running and visual verification is requested.
If non-Codex provider generation fails but the Playground CLI is reachable,
prepare the Markdown yourself and pass a JSON patch on stdin containing
`{"view":"concept-lab","explanation":{"title":"...","topic":"...","markdown":"..."}}`,
apply it with `interview-answers playground set --quiet`, and verify it with
`interview-answers playground show --summary`. For a fallback follow-up, write the
Markdown to a temporary file and use
`interview-answers playground append-explanation` instead. Report the exact
error only when both update paths fail.
