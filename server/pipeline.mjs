// The grading pipeline, shared by the Vercel API (api/), the local server (server.mjs) and the
// tests (which pass a mock model). The model is injected: model(mode, request, objectivesDoc).
//
// gradeDraft: three "score" runs, gated on the median; the spread is logged and over 1.0 the score
//   is "unstable" (shown, never used to lock you out). Cached by the exact request, so the same draft
//   always gets the same score. Then the "Get to 8" steps: numbers the app already has are filled in
//   (never asked for), rejected suggestions are filtered out, every text edit must win a pairwise
//   "which would this audience rather read?" check without changing the tone, at most 2 steps, each
//   worth 1.0+, toward the Developer Trust filter's sweet zone. If nothing clears that bar the steps
//   are [] and the grader's one-line no_steps_reason says why. Nothing is invented as a fallback.
// analyzeForX: the model's X review: verdicts for the judgment checks, specific fixes for failing
//   checks (a quoted span or what's missing, and a rewritten line), and a Tune for X pass. Every fix
//   is validated: one line, line breaks kept, hook kept, no invented numbers/links/handles/hashtags,
//   no placeholders, 280 characters on X. A check without a valid specific fix is dropped.
// tune: deterministic cleanup, then the model's tune edits, then both scores: the edit is dropped if
//   the objective score would go down.
// critique: the expandable Details under a score: what works and what costs points (each quoting
//   the post exactly; unquotable items are dropped), a skeptical senior developer's pushback, one
//   direction and a rewrite toward 8 (only facts from the post, the app's stats or logged projects;
//   anything else and the rewrite is withheld with a plain note), and four sub-ratings.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../src/objectives.js');
const S = require('../src/steps.js');
const XL = require('../src/x-linter.js');

const RUNS = 3;
const UNSTABLE = 1.0;
const X_LIMIT = 280;
const round1 = (x) => Math.round(x * 10) / 10;
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function createPipeline({ model, cacheSize = 500 }) {
  const cache = new Map();
  const remember = (k, v) => { cache.set(k, v); if (cache.size > cacheSize) cache.delete(cache.keys().next().value); return v; };
  const memo = async (k, fn) => { if (cache.has(k)) return cache.get(k); const v = await fn(); return remember(k, v); };

  const objectiveOf = (doc, id) => ((doc && doc.objectives) || []).find((o) => o.id === id) || null;

  async function gradeDraft(b) {
    const doc = b.objectives;
    const req = {
      platform: b.platform, title: b.title || null, post_text: b.post_text, objective_id: b.objective_id || null,
      attachments: b.attachments || [], deterministic_checks: b.checks || null, app_stats: b.app_stats || {}, avoid: b.avoid || [],
    };
    const k = hash(['grade', req, ((doc && doc.objectives) || []).map((o) => o.id), b.gate || 8]);
    return memo(k, async () => {
      const runs = await Promise.all(Array.from({ length: RUNS }, () => model('score', req, doc)));
      const parsed = runs.map((r) => O.parseObjectivesResponse(r, doc));
      const order = parsed.map((_, i) => i).sort((x, y) => parsed[x].score - parsed[y].score);
      const mid = order[Math.floor(order.length / 2)];
      const scores = parsed.map((p) => p.score);
      const spread = round1(Math.max(...scores) - Math.min(...scores));
      const steps = await finalSteps(b, parsed[mid], runs[mid]);
      return { ...runs[mid], steps, runs: scores, spread, unstable: spread > UNSTABLE };
    });
  }

  async function finalSteps(b, result, raw) {
    const text = b.post_text;
    if (result.bucket === 'kill' || result.score >= (b.gate || 8)) return [];
    let cand = [];
    for (const s of raw.steps || []) {
      if (s.type !== 'ask_fact') { cand.push(s); continue; }
      const filled = S.fillFromStats(s, text, b.app_stats);
      if (filled === null) continue; // the app's own number, not available yet: never asked
      cand.push(filled || s);
    }
    cand = cand.filter((s) => !(b.avoid || []).some((r) => S.sameStep(s, r)));
    // A claim with no number isn't missing proof when a screenshot or a link already backs it.
    if ((b.attachments || []).length || /https?:\/\//.test(text)) cand = cand.filter((s) => s.type !== 'ask_fact');
    const valid = S.normalizeSteps(cand, text, { limit: 10 });
    const obj = objectiveOf(b.objectives, result.objective_id);
    const judged = await Promise.all(valid.map(async (s) => {
      if (s.type === 'attach_proof') return s; // proof, not an edit
      let edited = s.result;
      if (s.type === 'ask_fact') {
        const sample = String(s.example || '').replace(/^e\.g\.,?\s*/i, '').trim();
        const filled = sample && S.fillFact(s.line_after, sample);
        const r = filled && S.applyLineEdit(text, s.line_before, filled);
        edited = r && !r.error ? r.text : null;
      }
      if (!edited) return null;
      const flip = parseInt(hash([text, edited]).slice(0, 2), 16) % 2 === 1; // order varies, deterministically
      const audience = `A developer deciding whether to trust the author with a real problem${obj ? ` (${obj.audience})` : ''}.`;
      const v = await model('compare', { audience, objective: obj ? obj.statement : '', platform: b.platform, a: flip ? edited : text, b: flip ? text : edited }, b.objectives);
      const editedWins = v && v.winner === (flip ? 'a' : 'b') && v.clearly_better && !v.tone_changed;
      return editedWins ? { ...s, compare: v.reason } : null;
    }));
    return judged.filter(Boolean).slice(0, S.MAX_STEPS);
  }

  // A model-proposed line edit, validated against the ORIGINAL draft's facts.
  function validEdit(original, current, before, after, platform) {
    if (before == null || !after) return null;
    const r = S.applyLineEdit(current, before, after);
    if (r.error) return null;
    if (XL.guardRewrite(original, r.after).added.length) return null; // invented number, link, handle, hashtag or emoji
    if (XL.placeholders(r.after).length || S.hasPlaceholder(r.after)) return null;
    if (platform !== 'linkedin' && XL.xlen(r.text) > X_LIMIT) return null;
    return r;
  }

  async function analyzeForX(b) {
    const text = b.post_text;
    const req = { post_text: text, objective_id: b.objective_id || null, checks: b.checks || [], minutes_since_last_post: b.minutes_since_last_post ?? null };
    return memo(hash(['algo', req]), async () => {
      const raw = await model('algo', req, b.objectives);
      const failing = new Set((b.checks || []).map((c) => c.id));
      const checks = (raw.checks || []).filter((c) => failing.has(c.id) && (c.status === 'fail' || c.status === 'warn')).map((c) => {
        if (c.span && !text.includes(c.span)) return null; // must quote this draft exactly
        if (!c.span && !String(c.missing || '').trim()) return null;
        const r = validEdit(text, text, c.fix_line_before, c.fix_line_after, 'x');
        return r ? { id: c.id, status: c.status, span: c.span || null, missing: c.span ? null : c.missing, fix_line_before: r.before, fix_line_after: r.after } : null;
      }).filter(Boolean);
      return { verdicts: raw.verdicts || null, verdicts_after: raw.verdicts_after || null, checks, tune_edits: raw.tune_edits || [] };
    });
  }

  async function tune(b) {
    const original = b.post_text;
    const cleaned = XL.cleanup(original, b.rules || {}).out;
    const [before, analysisOriginal, analysis] = await Promise.all([
      gradeDraft({ ...b, post_text: original }),
      analyzeForX({ ...b, post_text: original }),
      analyzeForX({ ...b, post_text: cleaned }),
    ]);
    const scoreOf = (raw) => O.parseObjectivesResponse(raw, b.objectives).score;
    const objBefore = scoreOf(before);
    // Edit by edit: each one is kept only if the objective score doesn't go down.
    let text = cleaned;
    let after = cleaned === original ? before : await gradeDraft({ ...b, post_text: cleaned });
    if (scoreOf(after) < objBefore) { text = original; after = before; } // even the cleanup cost points: skip it
    const applied = [];
    for (const e of analysis.tune_edits) {
      const r = validEdit(original, text, e.line_before, e.line_after, b.platform);
      if (!r) continue;
      const g = await gradeDraft({ ...b, post_text: r.text });
      if (scoreOf(g) < objBefore) continue; // this edit would lower the objective score: dropped
      text = r.text; after = g;
      applied.push({ before: r.before, after: r.after, signal: e.signal });
    }
    if (text === original) return { status: 'none', objective_before: objBefore };
    if (b.platform !== 'linkedin' && XL.xlen(text) > X_LIMIT) return { status: 'none', objective_before: objBefore };
    return { status: 'ok', text, applied, objective_before: objBefore, objective_after: scoreOf(after), grade_after: after, verdicts_before: analysisOriginal.verdicts, verdicts_after: applied.length ? analysis.verdicts_after || analysis.verdicts : analysis.verdicts };
  }

  // Projects the author has logged: objectives.json's "projects" list.
  const projectsOf = (doc) => [...new Set(((doc && doc.projects) || []).map((x) => String(x).trim()).filter(Boolean))];
  const statsText = (st) => Object.entries(st || {}).map(([k, v]) => (k === 'average_score' && typeof v === 'number' ? `${v} ${v.toFixed(1)} ${v.toFixed(1)}/10` : Array.isArray(v) ? v.join(' ') : String(v))).join(' ');
  const paragraphs = (t) => String(t || '').split('\n').filter((l) => l.trim()).length;
  const clamp10 = (x) => Math.max(0, Math.min(10, Math.round(Number(x) || 0)));

  async function critique(b) {
    const text = b.post_text;
    const known_facts = { app_stats: b.app_stats || {}, projects: projectsOf(b.objectives) };
    return memo(hash(['critique', text, known_facts]), async () => {
      const raw = await model('critique', { platform: b.platform || 'x', post_text: text, known_facts }, b.objectives);
      const quoted = (q) => Boolean(q && String(q).trim() && text.includes(String(q).trim()));
      const works = (raw.works || []).filter((w) => quoted(w.quote)).slice(0, 2).map((w) => ({ point: w.point, quote: w.quote.trim() }));
      const costs = (raw.costs || []).filter((c) => quoted(c.quote)).slice(0, 3).map((c) => ({ quote: c.quote.trim(), why: c.why, kind: c.kind }));
      if (!works.length && !costs.length) throw Object.assign(new Error("the critique couldn't quote your post; try again"), { status: 502 });
      let rewrite = raw.rewrite ? String(raw.rewrite).replace(/\r/g, '').trim() : null;
      const needs = (raw.needs || []).map(String).filter((x) => x.trim()).slice(0, 3);
      if (rewrite) {
        // Only facts from the post, the app's numbers, or logged projects.
        const g = XL.guardRewrite(`${text} ${statsText(b.app_stats)} ${known_facts.projects.join(' ')}`, rewrite);
        if (g.added.length) { needs.push(`A rewrite would need something that isn't in your post or your data (${[...new Set(g.added)].join(', ')}), so none is shown.`); rewrite = null; }
        else if (XL.placeholders(rewrite).length || /\[[^\]]*\]/.test(rewrite)) rewrite = null;
        else if ((b.platform || 'x') !== 'linkedin' && XL.xlen(rewrite) > X_LIMIT) { needs.push('A rewrite that fits 280 characters would have to drop a point; cut one first.'); rewrite = null; }
        else if (paragraphs(text) > 1 && paragraphs(rewrite) === 1) rewrite = null; // keep your line breaks
      }
      const bd = raw.breakdown || {};
      return { works, costs, pushback: String(raw.pushback || '').trim(), direction: String(raw.direction || '').trim(), rewrite, needs,
        breakdown: { shows_building: clamp10(bd.shows_building), specific: clamp10(bd.specific), useful: clamp10(bd.useful), voice: clamp10(bd.voice) } };
    });
  }

  return { gradeDraft, analyzeForX, tune, critique, cache };
}
