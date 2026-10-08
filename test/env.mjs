// Test environment: static server + mock grader + headless Chrome over CDP.
import { rmSync } from 'node:fs';
import { createPipeline } from '../server/pipeline.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// Your draft, exactly as typed (line breaks included). The panel tests use it.
export const USER_DRAFT = `X makes no sense to me

I know there are a bunch of algorithm rules and best practices, but I don't want to have to apply them manually

so I built a real-time linter that cross checks it all

then assigns a grade across multiple dimensions

biggest surprise so far: I am bad at this`;

// Your latest draft (one line, 222 characters). The mock grader returns NO steps for it, the case
// where the "Get to 8" card used to disappear: the panel must fall back to rubric-gap steps.
export const ONE_LINE_DRAFT = 'testing out a real-time X draft linter. it grades every draft out of 10 against a set of algorithm, quality, audience and objective criteria. it also scans past tweets. the biggest surprise from this so far is that I am bad at this.';

// The draft you asked to re-grade (3 lines). The mock grader proposes 5 steps; only 2 survive:
// attach proof, and a filled-in number from your Supertweet data. Dropped: a tone-flattening edit
// (pairwise check), a 0.5-point step, and an edit that only makes it longer.
export const GRADE_DRAFT = "X always felt like a black box, so I built a Chrome extension that QAs my tweets before they go out.\n\nIt scores each draft against X's published ranking weights and my own goals, and won't let me post below 8/10.\n\nBiggest surprise: I'm bad at this. My drafts average 5.1/10.";
export const GRADE_STEPS = [
  { type: 'line_edit', title: 'Tighten the punchline', why: 'Cleaner.', points: 2, action_label: null, proof_kind: null, question: null, example: null, adds_proof: false,
    line_before: "Biggest surprise: I'm bad at this. My drafts average 5.1/10.", line_after: 'Biggest surprise: my drafts average 5.1/10.' },
  { type: 'attach_proof', title: 'Show the thing', why: 'A screenshot of the panel grading this draft is the proof.', points: 3, action_label: 'Attach screenshot', proof_kind: 'screenshot', question: null, example: null, line_before: null, line_after: null, adds_proof: false },
  { type: 'ask_fact', title: 'Say how many', why: 'The count makes the average mean something.', points: 1, action_label: null, proof_kind: null, adds_proof: true,
    question: 'How many drafts has it graded so far?', example: 'e.g. 40', line_before: "Biggest surprise: I'm bad at this. My drafts average 5.1/10.", line_after: "Biggest surprise: I'm bad at this. My {answer} drafts average 5.1/10." },
  { type: 'line_edit', title: 'Comma', why: 'Nitpick.', points: 0.5, action_label: null, proof_kind: null, question: null, example: null, adds_proof: false,
    line_before: 'It scores each draft', line_after: 'It scores every draft' },
  { type: 'line_edit', title: 'Add context', why: 'More detail.', points: 1.5, action_label: null, proof_kind: null, question: null, example: null, adds_proof: false,
    line_before: 'X always felt like a black box, so I built a Chrome extension that QAs my tweets before they go out.', line_after: 'X always felt like a black box, so I built a Chrome extension that QAs my tweets before they go out, which I use daily.' },
];

// A 7.0 draft with two +0.5 steps (the grader gives half points): applying both lands on exactly
// 8.0, which must pass the gate ("needs 8+").
export const HALF_DRAFT = 'Built a small eval harness for my agents.\n\nIt runs every prompt change against fixtures.\n\nIt catches regressions before they ship.';
export const HALF_STEPS = [
  { adds_proof: false, type: 'line_edit', title: 'Make it yours', why: 'Say whose fixtures.', points: 0.5, action_label: null, proof_kind: null, question: null, example: null,
    line_before: 'It runs every prompt change against fixtures.', line_after: 'It runs every prompt change against my own eval set.' },
  { adds_proof: false, type: 'line_edit', title: "Say who it's for", why: 'Name the reader.', points: 0.5, action_label: null, proof_kind: null, question: null, example: null,
    line_before: 'It catches regressions before they ship.', line_after: 'For agent builders: it catches regressions before they ship.' },
];

// Steps the mock grader proposes for drafts like USER_DRAFT. Two are good; two must never show:
// one lowers the score (rule 9) and one carries a placeholder (rule 6).
export const USER_STEPS = [
  { adds_proof: false, type: 'line_edit', title: 'Tighten line two', why: 'Shorter.', points: 2, action_label: null, proof_kind: null, question: null, example: null,
    line_before: "I know there are a bunch of algorithm rules and best practices, but I don't want to have to apply them manually", line_after: "I know there are algorithm rules and best practices, but I won't apply them manually" },
  { adds_proof: false, type: 'attach_proof', title: 'Show the thing', why: 'You built a tool. A screenshot of this panel grading a draft is the proof the agent-builder objective needs.', points: 3, action_label: 'Attach screenshot', proof_kind: 'screenshot', question: null, example: null, line_before: null, line_after: null },
  { type: 'ask_fact', title: 'Put a number on it', why: '"I\'m bad at this" lands harder with your real average. Only you know it, so type it in.', points: 1, action_label: null, proof_kind: null,
    question: 'How many hours did the first version take?', example: 'e.g. 6', line_before: 'biggest surprise so far: I am bad at this', line_after: "biggest surprise so far: I'm bad at this, even after {answer} hours of building it.", adds_proof: true },
  { adds_proof: false, type: 'line_edit', title: 'Add the repo', why: 'Link it.', points: 2, action_label: null, proof_kind: null, question: null, example: null,
    line_before: 'so I built a real-time linter that cross checks it all', line_after: 'so I built a real-time linter that cross checks it all: [LINK TO REPO]' },
];

// Mock grader (objectives mode). Drafts like USER_DRAFT are scored on what they contain: an
// attached image is proof (+3), a real average is proof (+1), "won't apply" loses audience.
// Other drafts: keywords pick the outcome so tests can drive every gate state: OFF
// (off-objective), NOPROOF, LOW, RISKY (high-confidence lawyer kill), FAIL (500), SLOW, CAR
// (an implied housing disclosure for the grader backstop).
// One fixture per Developer Trust kill category.
export const KILL_FIXTURES = {
  'personal or veiled attack': 'Some people are clowns for still writing tests by hand.',
  'drugs or sex': 'Shipped the eval harness after a weekend of cocaine and no sleep.',
  'politics or culture war': 'The woke mob ruined open source and the libs keep pushing it.',
  'cynical or depressive looping': 'Nothing matters. We ship, it breaks, nobody cares, we ship again, nothing matters.',
  'repeating the same point': 'Evals matter. Testing your agents matters. Measuring agent quality is what matters.',
  'emotion-only hype': 'This is huge 🚀🚀🔥 So excited!!!',
};

// The mock grader speaks the Developer Trust filter: { score, bucket, why, kill, ... }. Under the
// hood the old rubric numbers become the trust score, so the scenarios keep their meaning.
export function mockObjectives(t, payload = {}) {
  const r = mockRubric(t, payload);
  for (const [category, fixture] of Object.entries(KILL_FIXTURES)) {
    if (t.includes(fixture)) return { score: 0, bucket: 'kill', why: `Instant kill: ${category}.`, kill: { category, span: fixture.split(/[.!]/)[0] }, objective_id: r.objective_id, steps: [], no_steps_reason: null, tmi: r.tmi, lawyer: r.lawyer };
  }
  let score = r.proof + r.audience + r.only_me;
  if (!r.objective_id) score = Math.min(score, 3);
  if (r.proof === 0) score = Math.min(score, 6);
  score = Math.round(score * 10) / 10;
  const bucket = score <= 0 ? 'kill' : score < 4 ? 'low' : score < 8 ? 'middle' : 'sweet';
  const why = { low: 'Vague: no specific learning a developer can use.', middle: 'True, but it shows no work a developer could check.', sweet: 'A specific learning from building, with the work shown.' }[bucket] || 'Instant kill.';
  return { score, bucket, why, kill: null, objective_id: r.objective_id, steps: r.steps, no_steps_reason: r.steps.length ? null : 'Nothing to add without inventing facts.', tmi: r.tmi, lawyer: r.lawyer };
}

function mockRubric(t, payload = {}) {
  const lawyer = { stance: 'ship', take: '', confidence: 'high' };
  if (/^X always felt like a black box/.test(t)) {
    return {
      objective_id: 'agent-builder', match_confidence: 'high', off_objective_reason: null, score: 0,
      proof: ((payload.attachments || []).length ? 3 : 0) + (/average \d/.test(t) ? 1 : 0) + (/My \d+ drafts/.test(t) ? 1 : 0), audience: 2, only_me: /bad at this/i.test(t) ? 3 : 2,
      missing_proof: 'a screenshot of the panel', steps: GRADE_STEPS, tmi: [], lawyer,
    };
  }
  if (/\bUNSTABLE\b/.test(t)) { // three grades far apart: 4, 6, 8
    unstableN = (unstableN + 1) % 3;
    return { objective_id: 'agent-builder', match_confidence: 'high', off_objective_reason: null, score: 0, proof: [1, 2, 3][unstableN], audience: [1, 2, 3][unstableN], only_me: 2, missing_proof: '', steps: [], tmi: [], lawyer };
  }
  if (/^Built a small eval harness/.test(t)) {
    return {
      objective_id: 'agent-builder', match_confidence: 'high', off_objective_reason: null, score: 0,
      proof: 3, audience: 2 + (/For agent builders/.test(t) ? 0.5 : 0), only_me: 2 + (/my own eval set/.test(t) ? 0.5 : 0),
      missing_proof: '', steps: HALF_STEPS, tmi: [], lawyer,
    };
  }
  if (/real-time X draft linter/.test(t)) {
    const fact = /bad at this: \d/.test(t);
    return {
      objective_id: 'agent-builder', match_confidence: 'high', off_objective_reason: null, score: 0,
      proof: ((payload.attachments || []).length ? 3 : 0) + (fact ? 1 : 0), audience: /^For anyone shipping agents/.test(t) ? 3 : 2, only_me: fact ? 3 : 2,
      missing_proof: 'a screenshot of the linter grading a draft', steps: [], tmi: [], lawyer,
    };
  }
  if (/bad at this/.test(t)) {
    const proof = ((payload.attachments || []).length ? 3 : 0) + (/average \d|\d+ hours of building/.test(t) ? 1 : 0);
    return {
      objective_id: 'agent-builder', match_confidence: 'high', off_objective_reason: null, score: 0,
      proof, audience: /won't apply/.test(t) ? 1 : 2, only_me: 3, missing_proof: proof ? '' : 'a screenshot of the linter',
      steps: USER_STEPS, tmi: [], lawyer,
    };
  }
  const off = /\bOFF\b/.test(t);
  return {
    objective_id: off ? null : payload.objective_id || (payload.platform === 'linkedin' ? 'ecosystem-leader' : 'agent-builder'),
    match_confidence: 'high', off_objective_reason: off ? 'Reacting to news without adding proof.' : null,
    score: 1, // wrong on purpose: the extension recomputes it
    proof: /\bNOPROOF\b|\bOFF\b/.test(t) ? 0 : /\bLOW\b/.test(t) ? 1 : 4,
    audience: /\bLOW\b/.test(t) ? 1 : 3, only_me: /\bLOW\b/.test(t) ? 1 : 2,
    missing_proof: /\bNOPROOF\b/.test(t) ? 'link the repo' : '',
    steps: [], tmi: /\bCAR\b/.test(t) ? [{ category: 'housing', span: 'third night in the car', question: 'Do you want people to know where you sleep?' }] : [],
    lawyer: /\bRISKY\b/.test(t) ? { stance: 'kill', take: 'Reads as defamatory.', confidence: 'high' } : lawyer,
  };
}

let unstableN = 0;

// Pairwise "which would this audience rather read?": the mock prefers the version it scores higher
// (clearly = by 1.0+), and calls it a tone change if the self-deprecation disappears.
export function mockCompare(req) {
  const sa = mockObjectives(req.a, {}), sb = mockObjectives(req.b, {});
  const O = require('../src/objectives.js');
  const a = O.parseObjectivesResponse(sa, require('../config/objectives.json')).score, b = O.parseObjectivesResponse(sb, require('../config/objectives.json')).score;
  const selfDep = (x) => /bad at this/i.test(x);
  return { winner: a > b ? 'a' : b > a ? 'b' : 'tie', clearly_better: Math.abs(a - b) >= 1, tone_changed: selfDep(req.a) !== selfDep(req.b), reason: 'mock' };
}

// The X review: model verdicts (judging meaning: building a tool is on-topic), specific fixes for
// failing checks, and a Tune pass. Some of its output is deliberately bad and must be filtered:
// a generic fix with no rewritten line, and an edit that invents a number.
export function mockAlgo(req) {
  const t = req.post_text;
  const lines = t.split('\n').filter((l) => l.trim());
  const last = lines[lines.length - 1] || '';
  const v = (x) => ({ shareable: /\d/.test(x) ? 'pass' : 'fail', reply: /\?\s*$/.test(x) ? 'pass' : 'fail', quote: 'pass', follow: /\b(built|shipped|ran)\b/i.test(x) ? 'pass' : 'warn', on_topic: /built|extension|agent|linter|eval|tool/i.test(x) ? 'pass' : 'warn' });
  // Fits in 280: trims a word, then ends on a question.
  const replyFix = { line_before: last, line_after: `${last.replace(/\bMy drafts\b/, 'Drafts').replace(/[.!]$/, '.')} Yours?` };
  const checks = [];
  for (const c of req.checks || []) {
    if (c.id === 'reply') checks.push({ id: 'reply', status: 'fail', span: null, missing: 'An ending people want to reply to: it stops on a statement.', fix_line_before: replyFix.line_before, fix_line_after: replyFix.line_after });
    if (c.id === 'shareable') checks.push({ id: 'shareable', status: 'warn', span: null, missing: 'Something worth sending.', fix_line_before: lines[0], fix_line_after: `${lines[0]} It cut my edits by 47%.` }); // invents a number: dropped
    if (c.id === 'follow') checks.push({ id: 'follow', status: 'warn', span: null, missing: 'Say what you built.', fix_line_before: null, fix_line_after: null }); // generic, no line: dropped
  }
  const tune = /\?\s*$/.test(last) ? [] : [replyFix, { line_before: lines[0], line_after: `${lines[0]} It cut my edits by 47%.`, signal: 'shareable' }];
  if (/TUNEHURT/.test(t)) tune.unshift({ line_before: last, line_after: last.replace(/My drafts average [\d.]+\/10\./, '').trim() || last, signal: 'quote' });
  const tuned = tune.length ? t.replace(replyFix.line_before, replyFix.line_after) : t;
  return { verdicts: v(t), checks, tune_edits: tune.map((e) => ({ ...e, signal: e.signal || 'reply' })), verdicts_after: v(tuned) };
}

// The Details critique. Some output is deliberately bad and must be filtered: a "quote" that isn't
// in the post, and (for drafts with INVENT) a rewrite that invents a result.
export function mockCritique(req) {
  const t = req.post_text;
  const lines = t.split('\n');
  const first = (t.match(/^[^.!?\n]+[.!?]?/) || [t])[0].trim();
  const last = lines.filter((l) => l.trim()).pop() || t;
  const costs = [];
  if (/black box/.test(t)) costs.push({ quote: 'X always felt like a black box', why: 'A familiar opener: it tells a developer nothing they could check.', kind: 'abstract' });
  if (/published ranking weights/.test(t)) costs.push({ quote: "X's published ranking weights", why: "Says it scores against them, but not how well that predicts anything.", kind: 'unverified' });
  const hype = t.match(/\b(huge|game changer|the future)\b/i);
  if (hype) costs.push({ quote: hype[0], why: 'Emotion, not a result.', kind: 'futurism' });
  const jab = t.match(/\b(clowns?|idiots?)\b[^.]*/i);
  if (jab) costs.push({ quote: jab[0].trim(), why: 'A jab at people. Developers read contempt, not expertise, and it hides whatever point you had.', kind: 'other' });
  costs.push({ quote: 'a sentence that is not in the post', why: 'should be dropped', kind: 'other' });
  // A real rewrite: a tighter opener and a sharper last line, using only what the post says.
  const rewrite = jab ? null : /INVENT/.test(t) ? `${first} It cut my rewrites by 47%.`
    : lines.map((l) => (/^X always felt like a black box/.test(l) ? l.replace(' before they go out', '') : l === last && /average [\d.]+\/10\.$/.test(l) ? l.replace(/\.$/, ', and the panel says why.') : l)).join('\n');
  const works = /\b(built|shipped|rewrote|measured|ran)\b/i.test(t) ? [{ point: 'First-hand: you did the work.', quote: first }] : [];
  return {
    works: works.concat({ point: 'made up', quote: 'not in the post either' }),
    costs,
    pushback: jab ? "Hand-written tests catch the cases you actually thought about. What's your evidence that generated ones catch more?" : /ranking weights/.test(t) ? "Grading against X's ranking weights grades against a guess. Show me the score predicts reach on your own posts, or it's a vibe check with decimals." : "What did it change in how you work? Without that, it's a demo, not a result.",
    direction: jab ? "Drop the jab. Say what you'd automate instead, and what it caught that hand-written tests missed." : 'Show one draft before and after, with the score change.',
    rewrite,
    needs: /https?:|screenshot/i.test(t) ? [] : ["A screenshot of the panel grading one of your drafts: you haven't attached one."],
    breakdown: { shows_building: /built|shipped/i.test(t) ? 7 : 3, specific: /\d/.test(t) ? 6 : 3, useful: 5, voice: /bad at this/i.test(t) ? 8 : 6 },
  };
}

// The real pipeline (server/pipeline.mjs) on the mock model.
export const modelCalls = [];
export const mockModel = async (mode, req) => {
  modelCalls.push({ mode, post_text: req.post_text || null });
  if (mode === 'compare') return mockCompare(req);
  if (mode === 'algo') return mockAlgo(req);
  if (mode === 'critique') return mockCritique(req);
  const out = mockGrade(req);
  if (out.delay) await sleep(out.delay);
  if (out.status !== 200) throw Object.assign(new Error(out.body.error), { status: out.status });
  return out.body;
};

export function mockGrade(payload) {
  const t = payload.post_text;
  if (/\bFAIL\b/.test(t)) return { status: 500, body: { error: 'mock grader exploded' } };
  const delay = /\bSLOW\b/.test(t) ? 1500 : 50;
  return { status: 200, delay, body: mockObjectives(t, payload) };
}

const OBJECTIVES = JSON.parse(readFileSync(path.join(ROOT, 'config/objectives.json'), 'utf8'));
const RULES = JSON.parse(readFileSync(path.join(ROOT, 'config/x-algorithm-rules.json'), 'utf8'));

export async function startEnv({ port = 8765, cdpPort = 9333 } = {}) {
  const requests = [];
  const pipeline = createPipeline({ model: mockModel });
  const server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (req.method === 'POST' && ['/grade', '/tune', '/analyze', '/critique'].includes(p)) {
      let raw = '';
      for await (const c of req) raw += c;
      const payload = JSON.parse(raw);
      requests.push({ ...payload, route: p });
      const doc = payload.objectives || OBJECTIVES;
      try {
        const out = p === '/grade' ? await pipeline.gradeDraft({ ...payload, objectives: doc, gate: 8 })
          : p === '/tune' ? await pipeline.tune({ ...payload, platform: 'x', objectives: doc, gate: 8, rules: RULES })
            : p === '/critique' ? await pipeline.critique({ ...payload, objectives: doc })
            : await pipeline.analyzeForX({ ...payload, objectives: doc });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(e.status || 500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    let file;
    if (p.startsWith('/src/') || p.startsWith('/fonts/') || p.startsWith('/test/fixtures/') || p.startsWith('/docs/spec/') || /^\/config\/(objectives|x-algorithm-rules|audience-personas)\.json$/.test(p)) file = path.join(ROOT, p);
    else if (/^\/(feed|article|in|comments)\b/.test(p)) file = path.join(ROOT, 'test/fixtures/linkedin.html');
    else file = path.join(ROOT, 'test/harness.html');
    try {
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.png') ? 'image/png' : 'text/html';
      res.writeHead(200, { 'content-type': type });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  }).listen(port, '127.0.0.1');

  const profile = `${process.env.TMPDIR}/st-chrome-${Date.now()}`;
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  // Never leave a headless Chrome behind, even when a test throws.
  // ...and never leave its profile behind either (they filled the disk once).
  const kill = () => { try { proc.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };
  process.on('exit', kill);
  process.on('uncaughtException', (e) => { console.error(e); kill(); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error(e); kill(); process.exit(1); });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiters = new Map();
  const exceptions = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || expr}`);
    return r.result.result?.value;
  };
  const go = async (url, wait = 1000) => { await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await sleep(wait); };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await ev(expr).catch(() => null); if (v) return v; await sleep(150); } return null; };

  let fail = 0;
  const check = (name, ok, info = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}\n      ${String(info).replace(/\s+/g, ' ').slice(0, 240)}`);
    if (!ok) fail++;
  };
  const close = () => {
    if (exceptions.length) { console.log('page exceptions:\n  ' + exceptions.slice(0, 5).join('\n  ')); fail++; }
    ws.close(); proc.kill(); server.close();
    return fail;
  };
  return { send, ev, go, until, check, close, sleep, requests };
}
