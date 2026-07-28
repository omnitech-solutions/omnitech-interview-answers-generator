---
description: Explain an interview topic with concise talking points and open it in Concept Lab
targets: ["*"]
---

# Explain workflow

Treat the supplied arguments as the topic. Activate the
`interview-concept-explainer` skill and follow it completely. This explicit
explain route always targets Concept Lab even when the topic contains "answer",
"build", "design", or "implement". Follow the skill's simple-question or
multi-part output shape exactly; do not add a numbered discussion path to a
simple question. For a subsequent prompt in the current Concept Lab session,
invoke the CLI with `--append` so the new briefing is added as a collapsed
follow-up instead of replacing the session.
