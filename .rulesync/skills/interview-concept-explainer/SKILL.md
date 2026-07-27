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
4. Write as a guided answer path for live delivery, not reference
   documentation. The candidate must be able to see where to start and what to
   discuss next. Default to no more than 650 spoken words for a broad prompt.
5. Organize the Markdown in this order:
   - `# Short title`
   - `## Start here`: begin with “I’d start by…” and provide a natural
     30–45-second opening the candidate can say verbatim.
   - `## Answer plan`: 3–5 numbered steps that order the discussion.
   - `## Work through the questions`: group related questions into at most five
     short sections. Format every prompt as
     `### Question N: Short question` so Concept Lab renders it in blue. Put
     the spoken response immediately below in a blockquote beginning
     `> **Answer:**`; Concept Lab renders these answer callouts in green. Use
     1–3 spoken sentences, then optional `**Remember:**` bullets for recall
     cues.
   - `## If they probe`: at most three deeper trade-offs or pitfalls.
   - `## Likely follow-ups`: at most three short questions.
6. Avoid repeating the same fact across sections. Do not add a state-ownership
   table, testing checklist, exhaustive API design, or implementation tutorial
   unless the user explicitly requests that depth. Prefer one idea per bullet
   and sentences that can be said aloud without editing.
   Never communicate question/answer color through inline HTML or hard-coded
   color names; the heading and blockquote convention owns presentation and
   remains accessible without color.
7. Include one Mermaid diagram only when sequence, lifecycle, data flow, or
   architecture is materially easier to understand visually. Keep it to 8
   nodes or fewer when practical. The diagram does not count toward the spoken
   word budget and must reinforce rather than duplicate the prose.
8. Update Concept Lab through `interview-answers explain --topic "<topic>"`.
   When Concept Lab already contains a briefing and the user asks a subsequent
   question in the same session, add `--append`; appended entries render
   collapsed and preserve the existing briefing. Omit `--append` only when the
   user asks to replace the session or start a new topic. Add `--save` only when
   the user asks to persist the briefing.
9. Confirm with `interview-answers playground show`; `view` must be
   `concept-lab` and `explanation` must match the requested topic.

Use related skills only when they materially improve accuracy:

- Use `openai-docs` for current OpenAI product or API behaviour.
- Use `browser:control-in-app-browser` to verify the rendered result when the
  app is running and visual verification is requested.
If provider generation fails but the Playground CLI is reachable, prepare the
Markdown yourself, create a temporary JSON patch containing
`{"view":"concept-lab","explanation":{"title":"...","topic":"...","markdown":"..."}}`,
apply it with `interview-answers playground set --file <temporary-json>`, verify
it with `interview-answers playground show`, and delete the temporary file. For
a fallback follow-up, write the Markdown to a temporary file and use
`interview-answers playground append-explanation` instead. Report the exact
error only when both update paths fail.
