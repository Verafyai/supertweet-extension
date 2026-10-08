#!/usr/bin/env bash
# Runs every suite. The end-to-end suites need Google Chrome at the default path.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
run() { echo "== $1"; shift; if ! "$@"; then fail=1; echo "!! failed"; fi; }
run "rubric" node test/scorer.test.js
run "unit" node --test test/*.test.js
run "server" bash -c "cd server && node --test"
for f in test/*.e2e.mjs; do run "$f" bash -c "node $f | grep -E '^(FAIL|page exceptions)' -A2; exit \${PIPESTATUS[0]}"; done
[ $fail = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
