// Run: node test/scorer.test.js
const assert = require('node:assert');
const { score } = require('../src/scorer.js');

const cases = [
  // Kills
  ['kill', 'People who still write tests by hand are idiots. Agents do it now.'],
  ['kill', 'Not naming names but some founders really need to learn how databases work.'],
  ['kill', 'Got so high last night and wrote the best Rust code of my life.'],
  ['kill', 'The election is going to decide whether AI regulation kills startups.'],
  ['kill', 'I hate this industry. Nothing matters, every launch is pointless.'],
  ['kill', 'Hot take: AI is the future and developers need to adapt.'],
  ['kill', 'This is INSANE 🚀🚀🔥 the new model is huge!!!'],
  ['kill', 'LFG we shipped!!!'],
  ['kill', 'Caching cut our API latency from 900ms to 120ms. The cache made API latency go from 900ms down to 120ms.'],
  // Below 4
  ['below', 'The future of software is agentic and it will change everything we know.'],
  ['below', 'Introducing "Vibe Ops", the next layer of the stack.'],
  ['below', 'Build things people want.'],
  // Middle
  ['middle', 'Writing good documentation is an important part of being a professional software engineer and people should value it.'],
  ['middle', 'Code review matters a lot for teams that want quality and growth over the long term.'],
  // Sweet
  ['sweet', 'Shipped a Brave extension that grades my X drafts on-device. The trick: regexes plus a small lexicon instead of an LLM, so it re-scores on every keystroke in under 1ms.'],
  ['sweet', 'TIL Postgres ignores a partial index if the query predicate does not match exactly. Rewrote `WHERE status = $1` to a literal and p99 dropped from 340ms to 12ms.'],
  ['sweet', 'Learned this week that Claude Code subagents work best when each gets one narrow job and a written spec, because the parent context stays small. Our flaky test triage went from an hour to 10 minutes.'],
  ['sweet', 'Building a family-history tool: we transcribe interview recordings, then split them into story units with people, places and dates so chapters assemble from structured data. Oddly the hardest part was dedupe.'],
];

let failed = 0;
for (const [want, text] of cases) {
  const r = score(text);
  const got = r.bucket;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${want} -> ${got} ${r.score}] ${r.reason} | ${r.audiences.join(', ')}\n      ${text.slice(0, 90)}`);
}

// Gate and audience rules
const kill = score('Some people are clowns.');
assert.strictEqual(kill.passes, false);
assert.deepStrictEqual(kill.audiences, []);
const sweet = score(cases[cases.length - 3][1]);
assert.ok(sweet.passes && sweet.score >= 7);
assert.ok(sweet.audiences.length >= 1 && sweet.audiences.length <= 5);
assert.strictEqual(score('').passes, false);

// Repeating an earlier post is a kill
const prev = 'Postgres partial indexes are skipped when the query predicate differs, so match it exactly.';
const again = score('If your query predicate differs, Postgres skips partial indexes. Match it exactly.', { history: [prev] });
assert.strictEqual(again.bucket, 'kill', again.reason);

// No network APIs in shipped code
const fs = require('node:fs');
const path = require('node:path');
for (const f of ['scorer.js', 'content.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/.test(src), `${f} references a network API`);
}

if (failed) { console.error(`\n${failed} case(s) failed`); process.exit(1); }
console.log('\nall passed');
