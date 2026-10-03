# products/interview/src/backend/live-session/withheld.ts

_Source: `products/interview/src/backend/live-session/withheld.ts` (header-comment fallback)_

What a withheld draft leaves behind for the browser (plan #2 D2, ADR-0011
rule:no-promotion): a CONTENT-FREE record of how many claims verification
rejected and which violation CODES applied. Never a claim, quote, path
string, key name or id the model controlled (rule:id-only-traces).

[STRATEGY] session_actions.result is only legal on a succeeded action (the
"session_actions_result_check" constraint, and the stream contract says the
same), so the summary rides on the suppression reason, which the database
already requires for a suppressed action and which the stream mapper
(toStoredAction) splits back into reason + result.withheld. No migration.
