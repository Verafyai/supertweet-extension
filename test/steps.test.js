// Edit rules for the score panel (src/steps.js): one line at a time, line breaks byte-identical,
// hook kept, no placeholders in a draft, per-line diffs, never lower the score.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/steps.js');
const P = require('../src/panel.js');

const DRAFT = `X makes no sense to me

I know there are a bunch of algorithm rules and best practices, but I don't want to have to apply them manually

so I built a real-time linter that cross checks it all

then assigns a grade across multiple dimensions

biggest surprise so far: I am bad at this`;

const otherLinesSame = (a, b, changed) => {
  const A = a.split('\n'), B = b.split('\n');
  return A.length === B.length && A.every((l, i) => (i === changed ? true : l === B[i]));
};

test('line edit: only that line changes; every other line and line break is byte-identical', () => {
  const r = S.applyLineEdit(DRAFT, 'then assigns a grade across multiple dimensions', 'then grades it on proof, audience and only-me');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.index, 6);
  assert.ok(otherLinesSame(DRAFT, r.text, 6));
  assert.strictEqual(r.text.split('\n').length, DRAFT.split('\n').length);
});

test('span edit inside a line keeps the rest of the line and every line break', () => {
  const r = S.applyLineEdit(DRAFT, 'I am bad at this', "I'm bad at this (5.1/10 average)");
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.text.split('\n')[8], "biggest surprise so far: I'm bad at this (5.1/10 average)");
  assert.ok(otherLinesSame(DRAFT, r.text, 8));
});

test('blank lines, trailing spaces and CRLF-free text survive untouched', () => {
  const d = 'one  \n\n\n  two\nthree';
  const r = S.applyLineEdit(d, 'three', 'three, with a number: 4');
  assert.strictEqual(r.text, 'one  \n\n\n  two\nthree, with a number: 4');
});

test('no placeholders ever go into a draft', () => {
  for (const bad of ['[LINK TO REPO]', 'see [YOUR NUMBER]', 'average {answer}', '[N] drafts']) {
    assert.match(S.applyLineEdit(DRAFT, 'then assigns a grade across multiple dimensions', bad).error, /placeholder/);
  }
  assert.strictEqual(S.fillFact('average {answer}/10', '[N]'), null);
  assert.strictEqual(S.fillFact('average {answer}/10', '5.1'), 'average 5.1/10');
  assert.strictEqual(S.fillFact('no slot here', '5.1'), null);
});

test('an edit never merges or splits lines', () => {
  assert.match(S.applyLineEdit(DRAFT, 'then assigns a grade across multiple dimensions', 'a\nb').error, /one line/);
  assert.match(S.applyLineEdit(DRAFT, 'so I built a real-time linter that cross checks it all\n\nthen', 'x').error, /one line/);
});

test('the hook is sharpened, never replaced', () => {
  assert.match(S.applyLineEdit(DRAFT, 'X makes no sense to me', 'Here is my new linter').error, /hook/);
  assert.ok(!S.applyLineEdit(DRAFT, 'X makes no sense to me', 'X still makes no sense to me').error);
});


test('a suggestion is shown only when its verified score is higher', () => {
  assert.strictEqual(S.worthShowing(5, 6), true);
  assert.strictEqual(S.worthShowing(5, 5), false);
  assert.strictEqual(S.worthShowing(5, 4.5), false);
  assert.strictEqual(S.worthShowing(5, undefined), false);
});

test('per-line diff: old line above, new line below, only changed lines', () => {
  const r = S.applyLineEdit(DRAFT, 'then assigns a grade across multiple dimensions', 'then grades it on three things');
  assert.deepStrictEqual(S.lineDiff(DRAFT, r.text), [{ index: 6, old: 'then assigns a grade across multiple dimensions', new: 'then grades it on three things' }]);
});

test('panel: Apply result goes through the same one-line rule, and the char count matches X', () => {
  const st = { draft: DRAFT };
  const next = P.stepResult(st, { type: 'ask_fact', lineBefore: 'biggest surprise so far: I am bad at this', lineAfter: "biggest surprise so far: I'm bad at this. My drafts average {answer}/10." }, '5.1');
  assert.ok(otherLinesSame(DRAFT, next, 8));
  assert.strictEqual(P.xLen(DRAFT), 283);
  assert.strictEqual(P.xLen('see https://example.com/a/very/long/path/that/goes/on'), 4 + 23);
});

test('blocker labels follow the reference order', () => {
  const base = { flags: [], objectiveId: 'agent-builder', steps: [], score: 5, gate: 8 };
  assert.strictEqual(P.blocker({ ...base, flags: [{ id: 'job' }, { id: 'money' }] }), 'Answer 2 privacy questions');
  assert.strictEqual(P.blocker({ ...base, objectiveId: null }), "Doesn't serve an objective");
  assert.strictEqual(P.blocker({ ...base, steps: [{ type: 'attach_proof' }] }), 'Add proof to post');
  assert.strictEqual(P.blocker(base), '5.0 / 10, needs 8+');
});

test('objective labels match the reference', () => {
  const doc = require('../config/objectives.json');
  assert.deepStrictEqual(doc.objectives.map(P.labelOf), ['Ecosystem leader who measures', 'Hands-on agent builder', 'How agents change DevRel']);
});

const ONE_LINE = 'testing out a real-time X draft linter. it grades every draft out of 10 against a set of algorithm, quality, audience and objective criteria. it also scans past tweets. the biggest surprise from this so far is that I am bad at this.';




test('one-line drafts: edits after the first sentence are allowed; the hook sentence is kept', () => {
  assert.ok(!S.applyLineEdit(ONE_LINE, 'it also scans past tweets.', 'it also scans my last 300 tweets.').error);
  assert.match(S.applyLineEdit(ONE_LINE, 'testing out a real-time X draft linter.', 'Here is something else.').error, /hook/);
});

test('disabled Post label comes from the top step', () => {
  const base = { flags: [], objectiveId: 'agent-builder', score: 4, gate: 8 };
  assert.strictEqual(P.blocker({ ...base, steps: [{ type: 'attach_proof' }, { type: 'ask_fact' }] }), 'Add proof to post');
  assert.strictEqual(P.blocker({ ...base, steps: [{ type: 'ask_fact' }, { type: 'line_edit' }] }), 'Add your number to post');
  assert.strictEqual(P.blocker({ ...base, steps: [{ type: 'line_edit' }] }), 'Apply the edit to post');
  assert.strictEqual(P.blocker({ ...base, steps: [{ type: 'attach_proof', done: true }, { type: 'line_edit' }] }), 'Apply the edit to post');
});

// ---------- Grader upgrade: fewer, better steps ----------

test('normalizeSteps: drops invalid steps, steps under 1.0, and keeps at most 2 ranked by points', () => {
  const steps = S.normalizeSteps([
    { type: 'line_edit', points: 2, line_before: 'so I built a real-time linter that cross checks it all', line_after: 'so I built it: [LINK TO REPO]' },
    { type: 'ask_fact', points: 1, question: 'Your average?', example: 'e.g. 5.1', line_before: 'biggest surprise so far: I am bad at this', line_after: "biggest surprise so far: I'm bad at this. My drafts average {answer}/10." },
    { type: 'attach_proof', points: 3, title: 'Show the thing', action_label: 'Attach screenshot' },
    { type: 'line_edit', points: 5, line_before: 'not in the draft', line_after: 'x' },
    { type: 'line_edit', points: 0.5, line_before: 'then assigns a grade across multiple dimensions', line_after: 'then grades it' },
  ], DRAFT);
  assert.deepStrictEqual(steps.map((s) => [s.type, s.points]), [['attach_proof', 3], ['ask_fact', 1]]);
});

test('no step under 1.0 is ever shown', () => {
  assert.deepStrictEqual(S.normalizeSteps([{ type: 'attach_proof', points: 0.9, title: 't' }], DRAFT), []);
});

test('prefer cuts: an edit that makes the post longer is dropped unless it adds proof', () => {
  const longer = { type: 'line_edit', points: 2, line_before: 'then assigns a grade across multiple dimensions', line_after: 'then assigns a grade across multiple dimensions, which honestly is the fun part' };
  const shorter = { type: 'line_edit', points: 2, line_before: 'then assigns a grade across multiple dimensions', line_after: 'then grades it on three things' };
  assert.deepStrictEqual(S.normalizeSteps([longer], DRAFT), []);
  assert.strictEqual(S.normalizeSteps([shorter], DRAFT).length, 1);
  assert.strictEqual(S.normalizeSteps([{ ...longer, adds_proof: true }], DRAFT).length, 1);
});


test('no ask_fact for a number the app can compute: it becomes a filled-in edit, or is dropped', () => {
  const ask = { type: 'ask_fact', points: 1, title: 'Put a number on it', why: '', question: 'Your average score so far', example: 'e.g. 5.1', line_before: 'biggest surprise so far: I am bad at this', line_after: "biggest surprise so far: I'm bad at this. My drafts average {answer}/10." };
  const filled = S.fillFromStats(ask, DRAFT, { average_score: 5.13, drafts_scored: 41 });
  assert.strictEqual(filled.type, 'line_edit');
  assert.strictEqual(filled.line_after, "biggest surprise so far: I'm bad at this. My drafts average 5.1/10.");
  assert.ok(filled.prefilled && /From your Supertweet data/.test(filled.why));
  assert.strictEqual(S.fillFromStats(ask, DRAFT, {}), null, 'no data yet: never asked');
  for (const q of ['How many drafts has it flagged so far?', 'How many posts passed the gate?', 'Which checks fail most?']) assert.ok(S.statFor(q), q);
  assert.strictEqual(S.fillFromStats({ ...ask, question: 'How long did the build take?' }, DRAFT, { average_score: 5 }), undefined, 'not an app number: left as an optional question');
});

test('app stats come from the app\'s own log; the latest grade per draft counts', () => {
  const st = S.appStats({ grades: [{ hash: 'a', score: 4, failed: ['Invites replies'] }, { hash: 'a', score: 6, failed: ['Invites replies'] }, { hash: 'b', score: 5, failed: ['Invites replies', 'Worth sending to someone'] }], posted: 3 });
  assert.deepStrictEqual(st, { drafts_scored: 2, average_score: 5.5, most_failed_checks: ['Invites replies', 'Worth sending to someone'], posts_through_gate: 3 });
});

test('avoid list: the last 10 rejected steps and overrides, oldest first', () => {
  const rej = Array.from({ length: 8 }, (_, i) => ({ ts: `2026-10-0${i % 9}T00:00:0${i}Z`, type: 'line_edit', title: `t${i}`, line_before: 'a', line_after: `b${i}` }));
  const ovr = Array.from({ length: 5 }, (_, i) => ({ ts: `2026-10-09T00:00:0${i}Z`, kind: 'score', reason: `because ${i}` }));
  const a = S.avoidList(rej, ovr);
  assert.strictEqual(a.length, 10);
  assert.strictEqual(a[a.length - 1].reason, 'because 4');
  assert.ok(S.sameStep({ type: 'line_edit', title: 't7', line_before: 'a', line_after: 'b7' }, a.find((x) => x.title === 't7')));
});
