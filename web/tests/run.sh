#!/usr/bin/env bash
# rdoc browser test runner.
#
#   bash web/tests/run.sh              # every *-test.js suite
#   bash web/tests/run.sh ime paste    # just ime-test.js and paste-test.js
#
# Prereqs: demo server on $RDOC_URL (default http://localhost:8741, run
# `python -m http.server 8741` from web/) and the browse binary. Suites
# are injected from /tmp (browse eval only reads there), then the runner
# sleeps instead of polling — heavy synchronous wasm work must not be
# interrupted with CDP queries (see README).
#
# Env overrides: RDOC_URL, RDOC_TEST_SLEEP (default 16s), BROWSE_BIN.
# Exit code: 0 all green, 1 failures, 2 setup problem.
set -u

BASE="${RDOC_URL:-http://localhost:8741}"
SLEEP="${RDOC_TEST_SLEEP:-16}"
B="${BROWSE_BIN:-$HOME/.claude/skills/gstack/browse/dist/browse}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! curl -sf -o /dev/null "$BASE/index.html"; then
  echo "ERROR: no server at $BASE — run 'python -m http.server 8741' from web/" >&2
  exit 2
fi
if [ ! -x "$B" ]; then
  echo "ERROR: browse binary not found at $B (set BROWSE_BIN)" >&2
  exit 2
fi

suites=()
if [ "$#" -gt 0 ]; then
  for a in "$@"; do
    n="${a%.js}"; n="${n%-test}"
    f="$DIR/$n-test.js"
    if [ ! -f "$f" ]; then echo "ERROR: unknown suite '$a' ($f)" >&2; exit 2; fi
    suites+=("$f")
  done
else
  for f in "$DIR"/*-test.js; do suites+=("$f"); done
fi

ts=$(date +%s)
pass=0; fail=0; failed=()
for t in "${suites[@]}"; do
  n=$(basename "$t")
  cp "$t" /tmp/"$n"
  "$B" goto "$BASE/index.html?v=run-$ts-$n" >/dev/null 2>&1
  "$B" eval /tmp/"$n" >/dev/null 2>&1
  sleep "$SLEEP"
  r=$("$B" js 'window.__benchResult' 2>/dev/null)
  if [ -z "$r" ] || [ "$r" = "null" ] || [ "$r" = "undefined" ]; then
    sleep 8  # one grace period for slow suites; still no polling
    r=$("$B" js 'window.__benchResult' 2>/dev/null)
  fi
  if echo "$r" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "PASS $n"; pass=$((pass+1))
  else
    echo "FAIL $n :: ${r:-no result}"; fail=$((fail+1)); failed+=("$n")
  fi
done

echo "TOTAL: $pass PASS, $fail FAIL"
if [ "$fail" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
