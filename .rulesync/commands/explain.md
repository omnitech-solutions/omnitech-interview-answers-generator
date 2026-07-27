---
description: Explain an interview topic with concise talking points and open it in Concept Lab
targets: ["*"]
---

# Explain workflow

Treat the supplied arguments as the topic. Activate the
`interview-concept-explainer` skill and follow it completely. This explicit
explain route always targets Concept Lab even when the topic contains "answer",
"build", "design", or "implement". Lead with a verbatim starting answer, then
provide a numbered discussion path and grouped spoken answers. For a subsequent
prompt in the current Concept Lab session, invoke the CLI with `--append` so the
new briefing is added as a collapsed follow-up instead of replacing the session.
