// Panel V2: the "Get to 8" steps and the rules every suggested edit must follow.
// - Smallest span: one line at a time, never the whole post.
// - Line breaks preserved: every other line, blank lines included, comes back byte-for-byte.
// - Hook kept: the first line keeps most of its own words, in order; it's sharpened, not replaced.
//   (Voice elsewhere is the grader's job, and every step is verified to raise the score.)
// - No placeholders in a draft: a fact only the author knows is asked for in an input, and the
//   answer goes in. An edit containing [N] or {answer} never reaches the editor.
// - Never lower the score: callers verify a line edit's score before showing it (see `worthShowing`).
(function (root) {
  'use strict';

  const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{answer\}/;
  const MAX_STEPS = 2; // never more than 2 steps
  const MIN_POINTS = 1; // never show a step worth less than 1.0
  const KEEP_HOOK = 0.8; // share of the first line's words (the hook) that must survive an edit

  const splitLines = (t) => String(t ?? '').split('\n');
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const words = (s) => squash(s).replace(/[^\p{L}\p{N}'’\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const hasPlaceholder = (s) => PLACEHOLDER.test(String(s || ''));

  function lcs(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    return dp;
  }

  // Share of `before`'s words that are still there, in order, in `after`.
  function kept(before, after) {
    const a = words(before).map((w) => w.replace(/’/g, "'")), b = words(after).map((w) => w.replace(/’/g, "'"));
    if (!a.length) return 1;
    return lcs(a, b)[0][0] / a.length;
  }

  // Index of the line an edit targets: exact (ignoring spacing/case) first, then containment.
  function findLine(text, before) {
    const L = splitLines(text);
    const b = squash(before);
    if (!b) return -1;
    let i = L.findIndex((l) => squash(l) === b);
    if (i < 0) i = L.findIndex((l) => squash(l).includes(b));
    return i;
  }
  const firstLineIndex = (L) => L.findIndex((l) => l.trim());
  const firstSentence = (line) => { const m = String(line).trim().match(/^.*?[.!?](?=\s|$)/); return (m ? m[0] : String(line)).trim(); };

  // Replace one line, or one span inside one line (the reference's lineBefore can be either).
  // Returns { text, index, before, after } where before/after are the whole line, or { error }.
  function applyLineEdit(text, before, after) {
    const L = splitLines(text);
    const next = String(after ?? '').replace(/\r/g, '');
    const span = String(before ?? '');
    if (!next.trim()) return { error: 'empty edit' };
    if (next.includes('\n') || span.includes('\n')) return { error: 'an edit changes one line only' };
    if (hasPlaceholder(next)) return { error: 'edits never put placeholders in a draft' };
    if (!span.trim()) return { error: 'line not found' };
    let i = L.findIndex((l) => l === span);
    let line;
    if (i >= 0) line = L[i].match(/^\s*/)[0] + next.trim();
    else {
      const hits = L.map((l, k) => (l.includes(span) ? k : -1)).filter((k) => k >= 0);
      if (hits.length === 1) { i = hits[0]; line = L[i].replace(span, next); } else {
        i = findLine(text, span); // spacing/case differences only
        if (i < 0 || squash(L[i]) !== squash(span)) return { error: hits.length > 1 ? 'that text is on more than one line' : 'line not found' };
        line = L[i].match(/^\s*/)[0] + next.trim();
      }
    }
    const old = L[i];
    if (squash(old) === squash(line)) return { error: 'no change' };
    // The hook is the first sentence of the first line (a one-line post is more than its hook).
    if (i === firstLineIndex(L)) {
      const hook = firstSentence(old);
      if (!line.includes(hook) && kept(hook, line) < KEEP_HOOK) return { error: 'keeps the hook: the first line can only be sharpened, not replaced' };
    }
    L[i] = line;
    return { text: L.join('\n'), index: i, before: old, after: line };
  }

  // Fill an ask_fact template ("... My drafts average {answer}/10.") with the author's answer.
  function fillFact(template, answer) {
    const a = String(answer ?? '').trim();
    if (!a || !String(template || '').includes('{answer}') || a.includes('\n') || hasPlaceholder(a)) return null;
    return String(template).split('{answer}').join(a);
  }

  // Grader steps -> valid, ranked, at most 3. Invalid ones are dropped, never repaired.
  function normalizeSteps(steps, text, opts = {}) {
    const out = [];
    for (const s of Array.isArray(steps) ? steps : []) {
      if (!s || typeof s !== 'object') continue;
      const points = Math.max(0, Math.min(10, Number(s.points) || 0));
      if (points < MIN_POINTS) continue;
      const base = { type: s.type, title: String(s.title || '').trim(), why: String(s.why || '').trim(), points };
      if (s.type === 'attach_proof') {
        out.push({ ...base, title: base.title || 'Show the thing', action_label: String(s.action_label || '').trim() || 'Attach proof', proof_kind: ['screenshot', 'clip', 'link'].includes(s.proof_kind) ? s.proof_kind : 'screenshot' });
      } else if (s.type === 'ask_fact') {
        const q = String(s.question || '').trim();
        if (!q) continue;
        const probe = fillFact(s.line_after, 'x');
        if (!probe || hasPlaceholder(probe) || applyLineEdit(text, s.line_before, probe).error) continue;
        out.push({ ...base, question: q, example: String(s.example || '').trim(), line_before: String(s.line_before), line_after: String(s.line_after) });
      } else if (s.type === 'line_edit') {
        const r = applyLineEdit(text, s.line_before, s.line_after);
        if (r.error) continue;
        // Prefer cuts to additions: an edit can't make the post longer unless it adds proof.
        if ([...r.text].length > [...String(text)].length && !s.adds_proof && !s.prefilled) continue;
        out.push({ ...base, line_before: String(s.line_before), line_after: String(s.line_after), result: r.text, prefilled: Boolean(s.prefilled), adds_proof: Boolean(s.adds_proof) });
      }
    }
    return out.sort((a, b) => b.points - a.points).slice(0, opts.limit || MAX_STEPS);
  }

  // ---------- Numbers Supertweet already has ----------
  // Never ask the author for these: compute them and offer a filled-in edit instead.
  const STATS = [
    { key: 'average_score', re: /\baverage\b|\bmean\b|\btypical score\b/i, fmt: (v) => `${Number(v).toFixed(1)}/10` },
    { key: 'drafts_scored', re: /how many drafts|drafts? (?:scored|graded|checked|flagged)|number of drafts/i, fmt: (v) => String(v) },
    { key: 'posts_through_gate', re: /through the gate|passed the gate|posts? (?:passed|shipped|got through)/i, fmt: (v) => String(v) },
    { key: 'most_failed_checks', re: /most[- ](?:failed|common)|fails? most|which checks?/i, fmt: (v) => (Array.isArray(v) ? v.slice(0, 2).join(' and ') : String(v)) },
  ];
  const statFor = (question) => STATS.find((x) => x.re.test(String(question || '')));
  // An ask_fact for a number the app has -> a prefilled line_edit with the real value (or null if
  // the app doesn't have that number yet; it's never asked for).
  function fillFromStats(step, text, stats) {
    const st = statFor(step.question);
    if (!st) return undefined; // not an app number: leave it alone
    const v = stats && stats[st.key];
    if (v == null || (Array.isArray(v) && !v.length)) return null;
    let val = st.fmt(v);
    if (/\/10$/.test(val) && /\{answer\}\s*\/\s*10/.test(step.line_after)) val = val.replace(/\/10$/, ''); // template already says /10
    const after = fillFact(step.line_after, val);
    if (!after) return null;
    return { ...step, type: 'line_edit', line_after: after, prefilled: true, adds_proof: true, question: null,
      why: `${step.why ? `${step.why} ` : ''}From your Supertweet data: ${st.key === 'average_score' ? `your drafts average ${st.fmt(v)}` : `${st.key.replace(/_/g, ' ')}: ${st.fmt(v)}`}.`.trim() };
  }
  // stats from the app's own log: { grades: [{hash, score, failed: [check titles]}], posted: n }
  function appStats(log) {
    const grades = (log && log.grades) || [];
    if (!grades.length) return {};
    const latest = new Map();
    for (const g of grades) latest.set(g.hash, g);
    const scores = [...latest.values()].map((g) => g.score).filter((x) => typeof x === 'number');
    const fails = {};
    for (const g of latest.values()) for (const f of g.failed || []) fails[f] = (fails[f] || 0) + 1;
    return {
      drafts_scored: latest.size,
      average_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      most_failed_checks: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
      posts_through_gate: (log && log.posted) || 0,
    };
  }

  // The last 10 things you rejected (thumbs-down steps) or overrode, as "don't suggest this" examples.
  function avoidList(rejected, overrides) {
    const a = (rejected || []).map((r) => ({ ts: r.ts || '', kind: 'rejected_step', type: r.type, title: r.title, line_before: r.line_before || null, line_after: r.line_after || null }));
    const b = (overrides || []).filter((o) => o.reason).map((o) => ({ ts: o.ts || '', kind: 'override', gate: o.kind, reason: o.reason }));
    return a.concat(b).sort((x, y) => String(x.ts).localeCompare(String(y.ts))).slice(-10);
  }
  const sameStep = (s, r) => r.kind === 'rejected_step' && r.type === s.type && (r.line_after || null) === (s.line_after || null) && (r.title === s.title || (r.line_before || null) === (s.line_before || null));

  // Get-to-8 rule: only show an edit whose verified score beats the current one.
  const worthShowing = (current, verified) => typeof verified === 'number' && typeof current === 'number' && verified > current;
  // Algorithm details rule: never show one that lowers the score.
  const notWorse = (current, verified) => typeof verified === 'number' && typeof current === 'number' && verified >= current;

  // Per-line diff: [{ index, old, new }] for lines that changed (old above, new below).
  function lineDiff(a, b) {
    const A = splitLines(a), B = splitLines(b);
    const dp = lcs(A, B);
    const out = [];
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) { i++; j++; continue; }
      const delOk = i < A.length && (j >= B.length || dp[i + 1][j] >= dp[i][j + 1]);
      if (delOk && j < B.length && i < A.length) { out.push({ index: i, old: A[i], new: B[j] }); i++; j++; continue; }
      if (delOk) { out.push({ index: i, old: A[i], new: null }); i++; } else { out.push({ index: i, old: null, new: B[j] }); j++; }
    }
    return out;
  }

  const STEP_WORDS = ['no steps', 'one step', 'two steps', 'three steps'];
  const summary = (steps) => `${STEP_WORDS[steps.length] || `${steps.length} steps`}, +${steps.reduce((s, x) => s + x.points, 0).toFixed(1)}`;
  const lineName = (text, index) => {
    const L = splitLines(text);
    const nonEmpty = L.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    if (index === nonEmpty[0]) return 'First line';
    if (index === nonEmpty[nonEmpty.length - 1]) return 'Last line';
    return `Line ${nonEmpty.indexOf(index) + 1}`;
  };

  const api = { splitLines, hasPlaceholder, kept, findLine, applyLineEdit, fillFact, normalizeSteps, fillFromStats, statFor, appStats, avoidList, sameStep, MIN_POINTS, worthShowing, notWorse, lineDiff, summary, lineName, MAX_STEPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetSteps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
