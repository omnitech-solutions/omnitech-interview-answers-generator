// SYNTHETIC engineering-manager interview set (E-A3). Invented and anonymised
// (placeholders only; no real employer, contact detail or amount). One phase
// per leadership theme, each a question the interviewer asks; some carry a
// part-two follow-up. Every phase ends on a candidate answer so the next
// question never coalesces into the previous interviewer utterance, and every
// answer is a long candidate turn that opens or revises nothing.
import type { ReplayFixtureSet } from "./replay-fixtures-hazards.js";
import {
  candidate,
  createScript,
  interviewer,
} from "./session-replay-fixtures.js";

const mgr = createScript("mgr");

export const MANAGER_FIXTURE: ReplayFixtureSet = {
  phases: [
    mgr.phase("mentoring and growing junior developers", [
      interviewer("How do you mentor and grow junior developers on your team?"),
      candidate(
        "I pair with each of them every week at the start, agree one small stretch goal per cycle, review their pull requests with comments that explain the reasoning rather than just the fix, and then step back so they own a whole change end to end before I raise the scope again.",
      ),
      interviewer(
        "Part two, how do you decide when someone is ready for more scope?",
      ),
      candidate(
        "I look for a few changes in a row that needed no rework, for questions that have moved from how to do it toward which option is better, and for them spotting risks in a design before anyone points them out, and I check that view with their peers before agreeing it with them.",
      ),
    ]),
    mgr.phase("code review practice", [
      interviewer(
        "What does good code review practice look like on your team?",
      ),
      candidate(
        "Small pull requests, a clear description of the intent, a reviewer assigned within the day, and comments sorted into must fix and nice to have. We automate style and checks in the pipeline so humans spend their attention on design, correctness and what could go wrong in production.",
      ),
    ]),
    mgr.phase("technical direction and trade-offs", [
      interviewer(
        "Tell me about a technical direction you set and the trade-offs you weighed.",
      ),
      candidate(
        "We had to choose between keeping the order service on a document database or moving it to PostgreSQL. I wrote a short options paper covering consistency, query needs, migration cost and the team's skills, reviewed it with the engineers, and we chose PostgreSQL with a staged cutover to keep rollback cheap.",
      ),
      interviewer("Follow up, how did you bring the team along?"),
      candidate(
        "I presented the options paper in a design review, invited objections in writing first so quieter people were heard, ran a small proof of concept with two volunteers, and shared the results openly, which turned most of the doubt into concrete questions we could actually answer.",
      ),
    ]),
    mgr.phase("security and scalability ownership", [
      interviewer(
        "Who owns security and scalability concerns on your team, and how do you make sure they do not get neglected?",
      ),
      candidate(
        "Every service has a named owner who is accountable for both, and we keep a short checklist in the definition of done covering dependency audits, access reviews, load expectations and the failure modes we have agreed to tolerate. Anything that falls outside the checklist goes into the architecture review rather than relying on someone remembering it.",
      ),
    ]),
    mgr.phase("working with product managers and other team leads", [
      interviewer(
        "How do you work with product managers and other team leads when priorities clash?",
      ),
      candidate(
        "I bring the trade-offs to the table in terms they care about, such as delivery dates, risk and customer impact, propose two or three options with their costs, and agree who makes the final call before the discussion starts, so that it ends in a decision instead of a standoff.",
      ),
    ]),
    mgr.phase("hiring and performance", [
      interviewer(
        "Walk me through how you handle hiring decisions and underperformance.",
      ),
      candidate(
        "For hiring I use a structured loop with the same questions for every candidate and written feedback before we compare notes. For underperformance I describe the gap with specific examples early, agree a short plan with clear checkpoints, offer support, and follow it up, so there are no surprises later.",
      ),
    ]),
    mgr.phase("conflict", [
      interviewer("Describe a conflict on your team and how you resolved it."),
      candidate(
        "Two engineers disagreed about how to structure a shared library, and the argument had become personal. I met each of them separately, restated the technical goals they shared, then brought them together to write down criteria first, test both approaches against those criteria, and accept the result of that comparison.",
      ),
    ]),
    mgr.phase("delivery under pressure", [
      interviewer("Tell me about delivering under a tight deadline."),
      candidate(
        "A release date was fixed by a customer commitment, so I cut the scope to the smallest useful slice, put the risky part first, held a short daily check on the plan, and protected the team from extra requests, which meant we shipped on the day with the lesser features following the next cycle.",
      ),
      interviewer(
        "Part two of that, how did you protect quality while moving fast?",
      ),
      candidate(
        "We kept the automated checks and the review requirement exactly as they were, added a feature flag so the release could be switched off quickly, and agreed in advance what would trigger a rollback, so speed never meant skipping the safety net.",
      ),
    ]),
    mgr.phase("a document-database to PostgreSQL migration decision", [
      interviewer(
        "Tell me about the decision to migrate from a document database to PostgreSQL.",
      ),
      candidate(
        "Reporting queries had become slow and awkward because the data was highly relational, so we moved the order service to PostgreSQL, ran both stores side by side during a staged cutover, compared results daily, and after the move the order query p95 latency was 40 percent lower.",
      ),
      interviewer(
        "Part two of that, how did you measure whether the migration worked?",
      ),
      candidate(
        "We agreed the measures before starting, query latency at the ninety fifth percentile, error rate and the number of manual data fixes, recorded a baseline, compared against it during dual running, and only retired the old store once all three stayed at or better than the baseline for two weeks.",
      ),
    ]),
  ],
  expect: {
    description:
      "nine leadership questions open nine tasks; the four part-two follow-ups raise their task to revision 2",
    opensTasks: 9,
    revisions: [2, 1, 2, 1, 1, 1, 1, 2, 2],
    deferredTopics: 0,
    inertEventIds: [],
  },
};
