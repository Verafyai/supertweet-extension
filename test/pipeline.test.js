// The grading pipeline (server/pipeline.mjs) on the mock model from test/env.mjs: medians,
// stability, cached scores, step rules (app data, 1.0 floor, 2 max, pairwise and tone checks),
// Tune for X guards, and the X review's specific fixes. Plus the sync alert classification.
const test = require('node:test');
const assert = require('node:assert');
const O = require('../src/objectives.js');
const XL = require('../src/x-linter.js');
const doc = require('../config/objectives.json');
const rules = require('../config/x-algorithm-rules.json');

const load = async () => {
  const env = await import('./env.mjs');
  const { createPipeline } = await import('../server/pipeline.mjs');
  return { env, p: createPipeline({ model: env.mockModel }) };
};
const score = (raw) => O.parseObjectivesResponse(raw, doc).score;

test('grades three times and gates on the median; the same draft always gets the same score (cached)', async () => {
  const { env, p } = await load();
  const before = env.modelCalls.filter((c) => c.mode === 'score').length;
  const a = await p.gradeDraft({ platform: 'x', post_text: env.GRADE_DRAFT, objectives: doc, gate: 8 });
  assert.strictEqual(env.modelCalls.filter((c) => c.mode === 'score').length - before, 3, 'three score runs');
  assert.deepStrictEqual(a.runs, [6, 6, 6]);
  const b = await p.gradeDraft({ platform: 'x', post_text: env.GRADE_DRAFT, objectives: doc, gate: 8 });
  assert.strictEqual(score(b), score(a));
  assert.strictEqual(env.modelCalls.filter((c) => c.mode === 'score').length - before, 3, 'the second grade comes from the cache');
});

test('grades more than 1.0 apart: "Unstable score", shown, never locks you out on score', async () => {
  const { p } = await load();
  const g = await p.gradeDraft({ platform: 'x', post_text: 'Our agent eval harness UNSTABLE', objectives: doc, gate: 8 });
  assert.ok(g.spread > 1 && g.unstable, JSON.stringify(g.runs));
  const r = O.parseObjectivesResponse(g, doc);
  assert.strictEqual(r.score, 6, 'the median of 4, 6, 8');
  const d = O.objectiveGate({ text: 'x', status: 'done', hash: 'h', result: r, tmiOpen: [], placeholders: [], threshold: 8 });
  assert.deepStrictEqual([d.locked, d.label], [false, 'Unstable score']);
  // ...but flags still lock
  assert.strictEqual(O.objectiveGate({ text: 'x', status: 'done', hash: 'h', result: r, tmiOpen: [], placeholders: [], safetyKill: 'Kill: politics', threshold: 8 }).locked, true);
});

test('no ask_fact for a number the app can compute: filled in from app stats, or dropped', async () => {
  const { env, p } = await load();
  const withStats = await p.gradeDraft({ platform: 'x', post_text: env.GRADE_DRAFT, objectives: doc, gate: 8, app_stats: { drafts_scored: 41, average_score: 5.1 } });
  assert.ok(!withStats.steps.some((s) => s.type === 'ask_fact'), 'no question for app data');
  const filled = withStats.steps.find((s) => s.prefilled);
  assert.strictEqual(filled.line_after, "Biggest surprise: I'm bad at this. My 41 drafts average 5.1/10.");
  const noStats = await p.gradeDraft({ platform: 'x', post_text: `${env.GRADE_DRAFT} `, objectives: doc, gate: 8, app_stats: {} });
  assert.ok(!noStats.steps.some((s) => s.type === 'ask_fact' || s.prefilled), 'not asked even when the app has no number yet');
});

test('steps: at most 2, none under 1.0, tone-flattening and longer-only edits dropped', async () => {
  const { env, p } = await load();
  const g = await p.gradeDraft({ platform: 'x', post_text: env.GRADE_DRAFT, objectives: doc, gate: 8, app_stats: { drafts_scored: 41 } });
  assert.ok(g.steps.length <= 2);
  assert.ok(g.steps.every((s) => s.points >= 1));
  assert.ok(!g.steps.some((s) => /Tighten the punchline|Comma|Add context/.test(s.title)), JSON.stringify(g.steps.map((s) => s.title)));
});

test('a rejected step (thumbs-down) is never suggested again', async () => {
  const { env, p } = await load();
  const avoid = [{ kind: 'rejected_step', type: 'attach_proof', title: 'Show the thing', line_before: null, line_after: null }];
  const g = await p.gradeDraft({ platform: 'x', post_text: `${env.GRADE_DRAFT}  `, objectives: doc, gate: 8, app_stats: { drafts_scored: 41 }, avoid });
  assert.ok(!g.steps.some((s) => s.title === 'Show the thing'));
});

test('a screenshot already backs the claim: no fact questions', async () => {
  const { env, p } = await load();
  const g = await p.gradeDraft({ platform: 'x', post_text: env.USER_DRAFT, objectives: doc, gate: 8, attachments: ['image'] });
  assert.ok(!g.steps.some((s) => s.type === 'ask_fact'));
});

test('ready as written: nothing clears the bar and proof is there -> no steps at all', async () => {
  const { env, p } = await load();
  const g = await p.gradeDraft({ platform: 'x', post_text: env.HALF_DRAFT, objectives: doc, gate: 8, attachments: ['image'] });
  assert.ok(score(g) < 8);
  assert.deepStrictEqual(g.steps, []);
});

test('Tune for X: never lowers the objective score, never adds numbers, stays within 280', async () => {
  const { env, p } = await load();
  const D = "X always felt like a black box, so I built a Chrome extension that QAs my tweets.\n\nBiggest surprise: I'm bad at this. My drafts average 5.1/10. TUNEHURT";
  const t = await p.tune({ platform: 'x', post_text: D, objectives: doc, gate: 8, rules, checks: [{ id: 'reply' }, { id: 'shareable' }] });
  assert.strictEqual(t.status, 'ok');
  assert.ok(t.objective_after >= t.objective_before, `${t.objective_before} -> ${t.objective_after}`);
  assert.ok(!/47%/.test(t.text), 'the invented "47%" edit was dropped');
  for (const n of XL.numbersIn(t.text)) assert.ok(XL.numbersIn(D).includes(n), `new number ${n}`);
  assert.ok(XL.xlen(t.text) <= 280);
  assert.ok(/average 5\.1\/10/.test(t.text), 'the edit that removed the number (lowering the score) was dropped');
  assert.strictEqual(t.text.split('\n').length, D.split('\n').length, 'line breaks kept');
});

test('Tune for X on a draft at the limit: an edit that would pass 280 is dropped', async () => {
  const { p } = await load();
  const long = `Built an eval harness for my agents. ${'x'.repeat(240)}`;
  const t = await p.tune({ platform: 'x', post_text: long, objectives: doc, gate: 8, rules, checks: [{ id: 'reply' }] });
  assert.ok(t.status === 'none' || XL.xlen(t.text) <= 280);
});

test('X review: every check quotes the draft or names what is missing, with a rewritten line; generic or inventing fixes dropped', async () => {
  const { env, p } = await load();
  const a = await p.analyzeForX({ post_text: env.GRADE_DRAFT, objectives: doc, checks: [{ id: 'reply' }, { id: 'shareable' }, { id: 'follow' }] });
  assert.deepStrictEqual(a.checks.map((c) => c.id), ['reply'], 'the generic "follow" and the 47% "shareable" fixes were dropped');
  const c = a.checks[0];
  assert.ok(c.missing && c.fix_line_before && c.fix_line_after);
  assert.ok(env.GRADE_DRAFT.includes(c.fix_line_before));
});

test('a draft about building a tool is on-topic for the agent-builder objective', async () => {
  const { env } = await load();
  const R = XL.lint(env.GRADE_DRAFT, {}, rules);
  assert.strictEqual(R.find((r) => r.id === 'not-interested').s, 'pass', 'the keyword check');
  assert.strictEqual(env.mockAlgo({ post_text: env.GRADE_DRAFT, checks: [] }).verdicts.on_topic, 'pass', 'the model verdict');
  const merged = XL.mergeVerdicts(XL.lint('Thinking about stuff today.', {}, rules), { on_topic: 'pass' });
  assert.strictEqual(merged.find((r) => r.id === 'not-interested').s, 'pass', 'the model verdict overrides the keyword heuristic');
});

test('Details rows: only fails and warnings, at most 3, ranked by weight; no generic fix text', () => {
  const D = 'Thinking about evals.';
  const R = XL.mergeVerdicts(XL.lint(D, { minutesSinceLastPost: 40, now: Date.parse('2026-10-04T12:30:00') }, rules), { shareable: 'fail', reply: 'fail', quote: 'warn', follow: 'fail', on_topic: 'pass' });
  const analysis = { checks: [
    { id: 'reply', span: null, missing: 'An ending to reply to.', fix_line_before: D, fix_line_after: 'Thinking about evals. Which do you trust?' },
    { id: 'quote', span: 'Thinking about evals.', missing: null, fix_line_before: D, fix_line_after: 'Evals are the product.' },
  ] };
  const { rows, passes } = XL.checkRows(R, D, analysis, rules);
  assert.ok(rows.length <= 3);
  assert.ok(rows.every((r) => r.before != null || r.queueAt), 'every row has a specific fix or a time to queue for');
  const generic = (rules.rules || []).map((r) => r.fix).concat(XL.lint(D, {}, rules).map((r) => r.fix)).filter((f) => f && !/^Your last post/.test(f));
  for (const r of rows) for (const g of generic) assert.ok(![r.missing, r.after, r.quote].includes(g), `generic fix shown: ${g}`);
  assert.ok(passes >= 1);
  assert.match(rows.find((r) => r.id === 'spacing').missing, /^Your last post was 40 minutes ago\. Posting after \d{1,2}:\d{2} [AP]M avoids the author diversity penalty\.$/);
});

test('algorithm sync: only action weights and distribution params alert, only on change, in plain words', () => {
  const d = { changed: [{ name: 'ReplyWeight', from: 5, to: 6 }, { name: 'AuthorDiversityDecay', from: 0.5, to: 0.4 }, { name: 'MaxResultsRetrieval', from: 800, to: 1000 }, { name: 'KafkaTopicPartitions', from: 8, to: 16 }, { name: 'ShadowTrafficSampleRate', from: 0.1, to: 0.2 }],
    added: [{ name: 'NewThingWeight', value: 3 }], removed: [{ name: 'OldRetrievalLimit', value: 2 }] };
  const { alerts, devlog } = XL.syncAlerts(d);
  assert.deepStrictEqual(alerts, ['Replies now weigh 6 (was 5).', 'Author diversity decay is now 0.4 (was 0.5).']);
  assert.ok(devlog.some((x) => /MaxResultsRetrieval/.test(x)) && devlog.some((x) => /Kafka/.test(x)) && devlog.some((x) => /Shadow/.test(x)));
  assert.ok(devlog.some((x) => /new NewThingWeight/.test(x)), 'new params go to the dev log, not the panel');
  for (const k of ['MaxResultsRetrieval', 'KafkaTopicPartitions', 'ShadowTrafficSampleRate', 'RetrievalSampling']) assert.strictEqual(XL.classifyParam(k), 'ignore', k);
});

test('cleanup keeps every line break', () => {
  const D = 'Follow for more! Our evals are a game changer 🚀🔥\n\nline two #a #b #c\n\n\nend';
  const out = XL.cleanup(D, rules).out;
  assert.deepStrictEqual(out.split('\n'), ['Our evals are a', '', 'line two #a', '', '', 'end']);
});

// ---------- The Details critique ----------

test('critique: every quote is an exact span from the post; made-up quotes are dropped', async () => {
  const { env, p } = await load();
  for (const t of [env.GRADE_DRAFT, env.USER_DRAFT, 'Built an eval harness for my agents. This is huge, the future of testing.\n\nIt runs on every PR.']) {
    const c = await p.critique({ post_text: t, objectives: doc });
    const quotes = [...c.works, ...c.costs].map((x) => x.quote);
    assert.ok(quotes.length >= 1, 'at least one exact span');
    for (const q of quotes) assert.ok(t.includes(q), `not in the post: ${q}`);
    assert.ok(c.works.length >= 1 && c.works.length <= 2 && c.costs.length <= 3);
    assert.ok(c.pushback && !/add more detail/i.test(c.pushback));
    for (const k of ['shows_building', 'specific', 'useful', 'voice']) assert.ok(c.breakdown[k] >= 0 && c.breakdown[k] <= 10, k);
  }
});

test('critique: a rewrite never contains a number or claim absent from the post or your data', async () => {
  const { env, p } = await load();
  const t = 'Built an eval harness INVENT for my agents.\n\nIt runs on every PR.';
  const c = await p.critique({ post_text: t, objectives: doc });
  assert.strictEqual(c.rewrite, null, 'the invented "47%" rewrite is withheld');
  assert.ok(c.needs.some((n) => /isn't in your post or your data/.test(n)), 'and it says so plainly');
  const ok = await p.critique({ post_text: env.GRADE_DRAFT, objectives: doc, app_stats: { drafts_scored: 4, average_score: 5.1 } });
  assert.ok(ok.rewrite && XL.xlen(ok.rewrite) <= 280);
  for (const n of XL.numbersIn(ok.rewrite)) assert.ok(XL.numbersIn(env.GRADE_DRAFT).includes(n) || ['4', '5.1'].includes(n), `new number ${n}`);
  assert.strictEqual(ok.rewrite.split('\n').filter((l) => l.trim()).length, env.GRADE_DRAFT.split('\n').filter((l) => l.trim()).length, 'line breaks kept');
});

test('reach versus trust: one line when a lower-trust post outreached a Sweet one', () => {
  const C = require('../src/critique.js');
  const notes = C.reachVsTrust([
    { id: 'a', score: 9, metrics: { views: 1200, likes: 14 }, date: '2026-03-03' },
    { id: 'b', score: 0, metrics: { views: 8400, likes: 40 } },
    { id: 'c', score: 5, metrics: { views: 300 } },
    { id: 'd', score: 9.5, metrics: { views: 2100 } },
  ]);
  assert.match(notes.b, /^Reach beat trust here: this 0\.0 post got 8\.4K views, more than your 9\.5 post \(2\.1K\)\.$/);
  assert.ok(!notes.c && !notes.a && !notes.d);
  assert.strictEqual(C.reachLine({ views: 1234, likes: 1, replies: 3, reposts: null }), '1.2K views · 1 like · 3 replies');
});
