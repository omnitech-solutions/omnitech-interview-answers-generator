#!/bin/sh
# write-questions.sh APP WORKDIR
#
# Writes the held-out questions of one application again, the way they were
# written: a folder OUTSIDE the repository is given the application's sources
# and its records (never the recipe, the ranker or any other code), and the
# Codex CLI (a different model family from the one the pack is judged with)
# follows generation-prompt.txt there. The result is WORKDIR/questions.json;
# it is checked with `pnpm pack:eval --check --questions FILE` and merged into
# questions.json by hand, with the set's version bumped.
set -eu
APP=$1
WORK=$2/$APP
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../../.." && pwd)
FIXTURE=$HERE/../$APP
rm -rf "$WORK"
mkdir -p "$WORK"
for file in matrix.json employer-brief.json posting.txt posting-edited.txt preferences.txt stages.json planted.json; do
  cp "$FIXTURE/$file" "$WORK/"
done
if [ -d "$FIXTURE/call" ]; then
  mkdir -p "$WORK/call"
  cp "$FIXTURE/call/transcript.txt" "$WORK/call/"
fi
(cd "$ROOT" && pnpm pack:eval --catalogue "$APP" 2>/dev/null | grep '^{' >"$WORK/records.jsonl")
sed "s/<APP>/$APP/g" "$HERE/generation-prompt.txt" >"$WORK/PROMPT.txt"
cd "$WORK"
codex exec --skip-git-repo-check --sandbox workspace-write -C "$WORK" \
  "Read PROMPT.txt in this folder and do exactly what it says. Write questions.json here. Verify it with a script as the prompt requires before you finish." \
  >"$WORK/codex.log" 2>&1 </dev/null
echo "codex exit $?" >>"$WORK/codex.log"
