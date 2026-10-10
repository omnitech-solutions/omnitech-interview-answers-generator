Technical panel for a principal engineer role at a health-scheduling company: four people, ninety minutes, half on systems I have built and half a design exercise on waitlist backfill.
panel: Ciaran (engineering manager, hiring manager: migrations, leadership, runs the panel), Niamh (staff engineer, Integrations: record systems, messages that arrive twice), Seun (principal site reliability engineer: tries to break the design, asks what I page on), Petra (product manager, waitlist and reminders: fairness, what a receptionist sees)
They are judging: reasoning about failure modes, booking correctness under concurrency, integration judgement, leading without line management, honesty about gaps.
Stories to land: keys on the booking write path plus a database constraint at Lanternfield Health; the 212-clinic migration in nine waves at Wrenfield Clinics, and the weekend cutover at Wrenfield Dental Group that taught it; the result router at Quillmere Labs.
In the design: say the two invariants first (one open offer per slot; an expired offer never confirms), then draw. The database decides; the hold is a hint.
When pushed, give the figure and where it came from; if a figure was wrong, correct it out loud.
Gaps to admit plainly: OR-Tools, Ruby, Temporal, more than one identity provider.
Questions to ask them: what a bad on-call week looks like; who owns the contract between Scheduling Core and Integrations; what the last principal left unfinished.
