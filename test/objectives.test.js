// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const TMI = require('../src/tmi.js');
const O = require('../src/objectives.js');
const L = require('../src/x-linter.js');

const OBJ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'objectives.json'), 'utf8'));
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'x-algorithm-rules.json'), 'utf8'));

// ---------- TMI ----------

test('TMI: each category is detected with its severity', () => {
  const cases = {
    contact: ['Email me at pat@example.com', 'block'], address: ['Meet at 1234 Pine Street tomorrow', 'block'],
    legal: ['Prepping for the custody hearing', 'high'], confidential: ['The recruiter said they have no DevRel team', 'high'],
    job: ['Third interview this week', 'warn'], money: ["I can't afford the rent is due", 'warn'],
    housing: ['Sleeping in my tesla again', 'warn'], health: ['My therapist said rest', 'warn'],
    family: ['My ex wants the house', 'warn'], heat: ["I'm so done with this company", 'warn'],
  };
  for (const [id, [text, sev]] of Object.entries(cases)) {
    const hit = TMI.detect(text).find((h) => h.id === id);
    assert.ok(hit, `${id} not detected in "${text}"`);
    assert.strictEqual(hit.sev, sev, id);
  }
  assert.strictEqual(TMI.detect('Shipped a repo with evals today.').length, 0);
  for (const tech of ['We used an LLM judge for evals', 'LLM-as-a-judge is noisy', 'Developer discovery is our first mile', 'Hearing from users helped', 'Filing a bug against the SDK', 'flaky judge scores dropped']) {
    assert.ok(!TMI.detect(tech).some((h) => h.id === 'legal'), `false positive: ${tech}`);
  }
  assert.ok(TMI.detect('The judge ruled on it').some((h) => h.id === 'legal'));
  const caseNo = TMI.detect('Filed under 26-3-01404-31 today');
  assert.ok(caseNo.some((h) => h.id === 'legal'), 'court case numbers count as legal');
});

test('TMI: private terms block, are masked in display, and never reach the grader', () => {
  const terms = ['Project Falcon', 'Acme'];
  const hits = TMI.detect('Working on Project Falcon with acme folks', terms);
  const p = hits.find((h) => h.id === 'private');
  assert.ok(p && p.sev === 'block' && p.masked);
  assert.deepStrictEqual(TMI.evidence(p), ['hidden', 'hidden']);
  const masked = TMI.mask('Working on Project Falcon with Acme. Mail pat@example.com', terms);
  assert.ok(!/Falcon|Acme|pat@example/.test(masked), masked);
  assert.strictEqual((masked.match(/\[PRIVATE\]/g) || []).length, 3);
});

test('TMI: kept answers are tied to the exact words; new matches ask again', () => {
  const hits = TMI.detect('Third interview this week');
  const kept = new Set([TMI.keyOf(hits[0])]);
  assert.strictEqual(TMI.openQuestions(hits, kept).length, 0);
  const more = TMI.detect('Third interview this week, and the recruiters keep calling');
  assert.strictEqual(TMI.openQuestions(more, kept).length, 1, 'new words reopen the question');
  const block = TMI.detect('call me 555-123-4567');
  assert.strictEqual(TMI.openQuestions(block, new Set([TMI.keyOf(block[0])])).length, 1, 'block items are always open');
});

test('TMI: grader backstop merges at warn level, never for masked spans', () => {
  const merged = TMI.mergeGrader([], [{ category: 'housing', span: 'third night in the car', question: 'Share where you live?' }, { category: 'other', span: '[PRIVATE] project', question: 'x' }]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].sev, 'warn');
  assert.strictEqual(TMI.removeMatches('third night in the car again', merged[0]), 'again');
});

// ---------- Objectives ----------

test('objectives: shipped file validates; bad docs are caught', () => {
  assert.deepStrictEqual(O.validateObjectives(OBJ), []);
  const bad = JSON.parse(JSON.stringify(OBJ));
  bad.objectives[0].primary_platform = 'myspace';
  bad.objectives[1].id = bad.objectives[0].id;
  delete bad.objectives[2].proof_that_counts;
  const e = O.validateObjectives(bad).join('\n');
  assert.match(e, /primary_platform/);
  assert.match(e, /duplicated/);
  assert.match(e, /proof_that_counts/);
  assert.deepStrictEqual(O.validateObjectives({}), ['objectives must be a non-empty array']);
});

test('objectives: names, platform ordering', () => {
  assert.strictEqual(O.nameOf(OBJ.objectives.find((o) => o.id === 'agents-change-devrel')), 'How agents change DevRel');
  assert.strictEqual(O.forPlatform(OBJ, 'x')[0].id, 'agent-builder');
  assert.strictEqual(O.forPlatform(OBJ, 'linkedin')[0].id, 'ecosystem-leader');
});

test('trust parser: buckets come from the score; a kill is 0', () => {
  const p = (o) => O.parseObjectivesResponse({ score: 6, bucket: 'middle', why: 'true but trite', kill: null, objective_id: 'agent-builder', ...o }, OBJ);
  assert.deepStrictEqual([p({}).score, p({}).bucket, p({}).why], [6, 'middle', 'true but trite']);
  assert.strictEqual(p({ score: 9, bucket: 'low' }).bucket, 'sweet', 'the bucket follows the score, not the label');
  const k = p({ score: 7, bucket: 'kill', kill: { category: 'politics or culture war', span: 'the woke mob' } });
  assert.deepStrictEqual([k.score, k.bucket, k.kill.category, k.kill.span], [0, 'kill', 'politics or culture war', 'the woke mob']);
  assert.strictEqual(p({ objective_id: 'made-up' }).objective_id, null);
  assert.deepStrictEqual(p({ steps: [{ type: 'attach_proof', title: 't', points: 3 }, { type: 'bogus' }] }).steps.map((x) => x.type), ['attach_proof']);
  assert.strictEqual(O.headline(p({})), 'Middle · 6.0 · true but trite');
});

test('bucket boundaries: 3.9 is Low, 4.0 is Middle, 7.9 is Middle, 8.0 is Sweet', () => {
  assert.deepStrictEqual([0, 0.1, 3.9, 4, 7.9, 8, 10].map(O.bucketOf), ['kill', 'low', 'low', 'middle', 'middle', 'sweet', 'sweet']);
});

// ---------- Gate ----------

const result = (o) => O.parseObjectivesResponse({ score: 9, bucket: 'sweet', why: 'a specific learning', kill: null, objective_id: 'agent-builder', lawyer: { stance: 'ship', confidence: 'high' }, ...o }, OBJ);
const gate = (o) => O.objectiveGate({ text: 'draft', status: 'done', hash: 'h', result: result({}), tmiOpen: [], placeholders: [], threshold: 8, ...o });

test('gate: passes at 8 or above with nothing open', () => {
  assert.deepStrictEqual([gate({}).locked, gate({}).label], [false, '9.0 / 10']);
});

test('gate: 8.0 unlocks ("needs 8+"); 7.9 does not', () => {
  assert.deepStrictEqual([gate({ result: result({ score: 8 }) }).locked, gate({ result: result({ score: 8 }) }).label], [false, '8.0 / 10']);
  assert.deepStrictEqual([gate({ result: result({ score: 7.9 }) }).locked, gate({ result: result({ score: 7.9 }) }).label], [true, '7.9 / 10, needs 8+']);
  const P = require('../src/panel.js');
  assert.strictEqual(P.ready({ score: 8, gate: 8, flags: [], objectiveId: 'agent-builder', hold: false }), true, 'the panel agrees: Ready at 8.0');
  assert.strictEqual(P.ready({ score: 7.9, gate: 8, flags: [], objectiveId: 'agent-builder', hold: false }), false);
});

test('gate: one fixture per kill category scores 0 and locks Post', () => {
  for (const category of O.KILL_CATEGORIES) {
    const r = result({ score: 6, bucket: 'kill', kill: { category, span: 'x' } });
    assert.strictEqual(r.score, 0, category);
    const g = gate({ result: r });
    assert.deepStrictEqual([g.locked, g.label, g.overridable], [true, `Kill: ${category}`, true], category);
  }
});

test('gate: reasons in priority order, one at a time', () => {
  const contact = TMI.detect('mail pat@example.com');
  const job = TMI.detect('final round tomorrow');
  assert.strictEqual(gate({ text: '' }).label, 'Write something');
  assert.strictEqual(gate({ tmiOpen: contact.concat(job), placeholders: ['[YOUR NUMBER]'] }).label, 'Remove the contact info');
  assert.strictEqual(gate({ safetyKill: 'Cut the engagement bait' }).label, 'Cut the engagement bait');
  assert.strictEqual(gate({ placeholders: ['[YOUR NUMBER]'], tmiOpen: job }).label, 'Replace the placeholder');
  assert.strictEqual(gate({ tmiOpen: job.concat(TMI.detect('my kids')) }).label, 'Answer 2 privacy questions');
  assert.strictEqual(gate({ status: 'grading' }).label, 'Grading…');
  assert.strictEqual(gate({ status: 'error' }).label, 'Grader offline');
  assert.strictEqual(gate({ result: result({ score: 4 }) }).label, '4.0 / 10, needs 8+');
  assert.strictEqual(gate({ kill: { category: 'personal or veiled attack', span: 'idiots' } }).label, 'Kill: personal or veiled attack', 'the on-device kill check');
  assert.strictEqual(gate({ result: result({ lawyer: { stance: 'kill', confidence: 'high', take: 'defamation risk' } }) }).label, 'Lawyer: risky to post');
  assert.strictEqual(gate({ result: result({ lawyer: { stance: 'kill', confidence: 'medium' } }) }).locked, false, 'only a high-confidence lawyer kill locks');
});

test('gate: typed reason unlocks a low score, a kill, the lawyer and offline; never TMI blocks, bait or placeholders', () => {
  const ov = { hash: 'h', reason: 'Context the grader misses here' };
  for (const o of [{ result: result({ score: 3 }) }, { result: result({ bucket: 'kill', kill: { category: 'drugs or sex', span: 'x' } }) }, { result: result({ lawyer: { stance: 'kill', confidence: 'high' } }) }, { status: 'error' }]) {
    const g = gate({ ...o, override: ov });
    assert.strictEqual(g.locked, false, JSON.stringify(o));
    assert.strictEqual(g.kind, 'overridden');
  }
  assert.strictEqual(gate({ result: result({ score: 3 }), override: { hash: 'other', reason: ov.reason } }).locked, true, 'a reason covers one exact draft');
  assert.strictEqual(gate({ result: result({ score: 3 }), override: { hash: 'h', reason: 'short' } }).locked, true, 'reason needs 8+ characters');
  assert.strictEqual(gate({ tmiOpen: TMI.detect('call 555-123-4567'), override: ov }).locked, true);
  assert.strictEqual(gate({ safetyKill: 'Cut the engagement bait', override: ov }).locked, true);
  assert.strictEqual(gate({ placeholders: ['[LINK]'], override: ov }).locked, true);
});

// ---------- X algorithm fit (info line) and filter ----------

const ctx = { media: 'none', minutesSinceLastPost: 600, followers: 5000, recent: [] };
const fitOf = (t, c = ctx) => L.fit(L.lint(t, c, RULES), t, RULES);

test('fit formula matches the spec fixtures', () => {
  const strong = 'We ran 40 agent evals against our docs. First-attempt success went from 31% to 78% after we added llms.txt. What would you measure first?';
  assert.ok(fitOf(strong) > 8, String(fitOf(strong)));
  assert.strictEqual(fitOf(''), 0);
  assert.ok(fitOf('Follow for more agent tips! RT if you agree') <= 1, 'bait caps fit at 1.0');
  const hype = 'This new agent framework is a game changer';
  assert.ok(fitOf(hype) < 5, String(fitOf(hype)));
  assert.strictEqual(L.band(8.1), 'pass'); assert.strictEqual(L.band(5), 'warn'); assert.strictEqual(L.band(4.9), 'fail');
  // Weights come from action_weights: a synced change moves the fit.
  const w = L.fitWeights(RULES).hit;
  assert.ok(Math.abs(w.shareable - Math.sqrt(27)) < 1e-9 && Math.abs(w.reply - Math.sqrt(20)) < 1e-9 && w.dwell === 1);
  const bumped = JSON.parse(JSON.stringify(RULES)); bumped.action_weights.ReplyWeight = 50;
  assert.ok(L.fitWeights(bumped).hit.reply > w.reply);
});

test('fit updates within 50ms per keystroke', () => {
  const text = 'We shipped an MCP server for our docs and measured first-attempt success across 40 runs. '.repeat(3);
  const recent = Array.from({ length: 20 }, (_, i) => `Recent post number ${i} about agents and evals and docs`);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) fitOf(text.slice(0, 50 + i), { ...ctx, recent });
  const perKey = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  assert.ok(perKey < 50, `${perKey.toFixed(2)}ms per keystroke`);
});

test('deterministic filter strips bait, hype, extra hashtags and emoji', () => {
  const r = L.cleanup('Follow for more! This is a game changer 🚀🔥 #ai #agents #devrel', RULES);
  assert.ok(!/follow for|game changer|🚀|#agents/i.test(r.out), r.out);
  assert.ok(r.changes.some((c) => c.rule === 'report') && r.changes.some((c) => c.rule === 'not-interested'));
});

test('rewrites never add numbers or facts that were not in the draft', () => {
  const fixtures = [
    // [original with no numbers, a model rewrite that tried to invent some]
    ['We added llms.txt to our docs and agents got further on the first try. What do you measure?',
      'We added llms.txt to our docs and first-attempt success jumped 47% across 120 runs in 2 weeks. See https://github.com/acme/repo #agents 🚀 What do you measure?'],
    ['Our onboarding broke for agents until we fixed the quickstart.',
      'Our onboarding broke for 3 out of 5 agents until @devrelguy fixed the quickstart in 10 minutes.'],
  ];
  for (const [orig, model] of fixtures) {
    const g = L.guardRewrite(orig, model);
    assert.deepStrictEqual(L.numbersIn(g.out), [], `numbers survived: ${g.out}`);
    assert.ok(!/github\.com|@devrelguy|#agents|🚀/.test(g.out), g.out);
    assert.ok(g.added.length >= 3);
    assert.ok(L.placeholders(g.out).includes('[YOUR NUMBER]'));
  }
  // Numbers that were in the draft stay.
  const kept = L.guardRewrite('Cut p99 from 340ms to 12ms.', 'p99 went from 340ms to 12ms. What would you try next?');
  assert.strictEqual(kept.out, 'p99 went from 340ms to 12ms. What would you try next?');
  assert.deepStrictEqual(kept.added, []);
});

test('placeholders are found and diffs render', () => {
  assert.deepStrictEqual(L.placeholders('Ran [YOUR NUMBER] evals, repo: [LINK TO REPO]. [YOUR NUMBER]'), ['[YOUR NUMBER]', '[LINK TO REPO]']);
  const d = L.wordDiff('we shipped it fast', 'we shipped it today');
  assert.deepStrictEqual(d.filter((x) => x.op !== 'same').map((x) => `${x.op}:${x.text}`), ['del:fast', 'add:today']);
});

test('param.rs parser and weight diff', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'param.rs'), 'utf8');
  const p = L.parseParams(src);
  assert.strictEqual(p.ShareViaCopyLinkWeight, 20);
  assert.strictEqual(p.ReportWeight, -234);
  assert.strictEqual(p.ColdStartImpressionThreshold, 1000);
  assert.strictEqual(Object.keys(p).length, Object.keys(RULES.action_weights).length + Object.keys(RULES.distribution_params).length);
  const changed = { ...p, ReplyWeight: 7, BrandNewWeight: 3 };
  delete changed.DwellWeight;
  const d = L.diffParams(p, changed);
  assert.deepStrictEqual(d.changed, [{ name: 'ReplyWeight', from: 5, to: 7 }]);
  assert.deepStrictEqual(d.added, [{ name: 'BrandNewWeight', value: 3 }]);
  assert.deepStrictEqual(d.removed, [{ name: 'DwellWeight', value: 0 }]);
});
