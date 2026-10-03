---
name: explain
description: Explain an interview topic with concise talking points and open it in Concept Lab
---

# Explain workflow

Treat the supplied arguments as the topic. Activate the
`interview-concept-explainer` skill and follow it completely. This explicit
explain route always targets Concept Lab even when the topic contains "answer",
"build", "design", or "implement". Classify the question before writing so the
example and level of detail fit a mechanism, comparison, practical API, DSA,
system-design, or experience question. Preserve the question's scope: never
turn one simple prompt into invented subquestions or an exhaustive guide. For
a subsequent prompt in the current Concept Lab session, append the new answer;
never use a replace/set operation while an answer already exists. The
Codex-selected UI path delegates generation and appending to the terminal
gateway and must not inspect repository files. Every answer must include one
valid syntax-highlighted code example with decision-only labeled comments that
follow the coding-answer comment contract.
