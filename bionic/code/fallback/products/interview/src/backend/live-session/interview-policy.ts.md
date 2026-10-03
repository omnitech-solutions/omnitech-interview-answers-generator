# products/interview/src/backend/live-session/interview-policy.ts

_Source: `products/interview/src/backend/live-session/interview-policy.ts` (header-comment fallback)_

The Interview side of the session: a DETERMINISTIC policy for task identity.
It implements the neutral core's TaskPolicy port and carries the assist
stage. It decides only WHETHER an utterance opens, revises or defers a task;
what the question is (its category) is classified by the assist stage's one
structured call and read from its validated field, never guessed here
(rule:structured-field-decisions). Rules, in order:
1. filler, backchannel and the candidate's own speech never open or
revise a task;
2. "circle back", "put a pin" defer a topic;
3. with an open task, "part two" / "now handle" / "what about" revise it;
4. a question opens ONE task (a compound question is one utterance);
5. a long task-less utterance is a monologue and is ignored.
Candidate-side speech (the microphone source) never opens, revises or defers.
These are approximations: source labels are not verified identities, so this
only reduces noise and the policy otherwise reads text. It returns only opaque handles
(rule:id-only-traces); no utterance text rides in a decision. Every synthetic
replay set (session-replay-fixtures.test.ts) is run through it.
