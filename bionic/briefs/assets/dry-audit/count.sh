#!/bin/bash
# DRY audit counts (BRIEF-dry-opportunities-and-abstractions). Read-only: greps tracked source.
# Run from the repository root: bash bionic/briefs/assets/dry-audit/count.sh
# Counts are approximate by design (regular expressions over text); the brief names what was confirmed by reading.
set -u
SRC=$(git ls-files apps products packages scripts e2e | grep -E '\.(ts|tsx|mjs)$' | grep -v '\.test\.')
TESTS=$(git ls-files apps products packages scripts e2e | grep -E '\.test\.(ts|tsx)$')
B=$(echo "$SRC" | grep -E 'backend|apps/web|apps/agent-worker|presentation/src/(application|repositories|domain)|packages/')
FE=$(echo "$SRC" | grep -E 'frontend')
cnt(){ echo "$2" | xargs grep -cE "$1" 2>/dev/null | awk -F: -v l="$3" '$NF>0{f++;n+=$NF}END{printf "%-46s %5d in %4d files\n", l, n+0, f+0}'; }
top(){ echo "$2" | xargs grep -cE "$1" 2>/dev/null | grep -v ':0$' | sort -t: -k2 -nr | head -"${3:-6}" | sed 's/^/    /'; }
echo "commit $(git rev-parse --short HEAD) $(date +%F)"
echo "== transport"
R='\.(get|post|put|patch|delete)\($|\.(get|post|put|patch|delete)\("'
cnt "$R" "$B" "route registrations"; top "$R" "$B" 14
cnt 'safeParse\(' "$B" "safeParse("; top 'safeParse\(' "$B" 8
cnt '\.json\(.*, ?(400|401|403|404|409|413|415|422|429|500|502|503)\)' "$B" "inline error status responses"
cnt 'c\.req\.json\(|request\.json\(|req\.json\(' "$B" "raw body json reads"
cnt 'text/event-stream' "$B" "SSE responses"
cnt '[Ii]dempotency' "$B" "idempotency mentions"
echo "== results and errors"
cnt 'ok: false' "$B" "ok:false results"
cnt 'class \w+ extends \w*Error' "$SRC" "Error subclasses"
cnt 'catch \((error|err|e|cause)\) \{' "$B" "catch blocks (backend)"
cnt 'console\.(log|warn|error|info)' "$B" "console.* (backend+packages)"
echo "== repositories"
cnt 'withTenant\(' "$B" "withTenant("; cnt 'tenantTransaction\(' "$B" "tenantTransaction("
cnt 'onConflictDo' "$B" "upserts"
cnt 'eq\(\w+\.tenantId' "$B" "hand tenantId predicates"
cnt '^(export )?(async )?function (to|map|from)[A-Z]\w*\((row|record|r)\b' "$B" "row mappers"
cnt '(for update|skip locked|\.for\("update")' "$B" "row locks"
echo "== env"
cnt 'process\.env[.\[]' "$SRC" "process.env reads"; top 'process\.env[.\[]' "$SRC" 20
cnt 'process\.env\.\w+ (\?\?|\|\|) ' "$SRC" "env reads with inline default"
cnt 'Number\(process\.env|parseInt\(process\.env|process\.env\.\w+ === "(1|true)"' "$SRC" "hand-parsed env"
echo "== workers and scripts"
cnt 'process\.on\(' "$SRC" "process.on("; top 'process\.on\(' "$SRC" 12
cnt 'process\.argv' "$SRC" "process.argv"; top 'process\.argv' "$SRC" 20
cnt 'parseArgs' "$SRC" "parseArgs"
cnt 'setInterval\(' "$SRC" "setInterval("
echo "== frontend"
cnt '\bfetch\(' "$FE" "bare fetch("; top '\bfetch\(' "$FE" 6
cnt 'studioFetch(Until)?\(' "$FE" "studioFetch("
cnt '\.ok\)' "$FE" "response.ok checks"
cnt 'await \w+\.json\(\)' "$FE" "response.json()"
cnt 'new AbortController' "$FE" "AbortController"
cnt 'useState<string \| null>\(null\)|useState<string>\(""\)|useState\(""\)' "$FE" "string/error useState"
cnt 'set(Error|Loading|Busy|Saving|Pending)\(' "$FE" "error/loading setters"
cnt 'toLocale(Date|Time)?String|Intl\.' "$FE" "inline date/number formatting"
cnt 'localStorage|sessionStorage' "$FE" "web storage"
cnt 'navigator\.clipboard' "$FE" "clipboard"
cnt 'window\.confirm|confirm\(' "$FE" "confirm("
cnt '<DynamicForm' "$FE" "DynamicForm"
cnt '<(input|select|textarea)\b' "$FE" "raw inputs"
echo "== tests"
cnt 'vi\.mock\(' "$TESTS" "vi.mock("
cnt 'vi\.useFakeTimers' "$TESTS" "fake timers"
cnt 'new Request\(' "$TESTS" "hand-built Request"
cnt 'app\.request\(|\.request\("' "$TESTS" "app.request("
cnt '^(async )?function (make|build|create|fake|stub|seed)[A-Z]\w*\(' "$TESTS" "local builders in tests"
echo "  builders defined in 3+ test files:"
echo "$TESTS" | xargs grep -hoE '^(async )?function (make|build|create|fake|stub|seed|json|post|get|request|setup|render)[A-Za-z]*\(' 2>/dev/null | sed -E 's/^(async )?function //' | sort | uniq -c | sort -nr | awk '$1>=3' | head -40 | sed 's/^/    /'
