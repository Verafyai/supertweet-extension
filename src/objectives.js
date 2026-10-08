// Objectives: the only things a post is scored against (config/objectives.json).
// Validation, display names, the objectives-mode response parser, and the send gate.
(function (root) {
  'use strict';

  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const str = (v) => (typeof v === 'string' ? v : '');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const PLATFORMS = ['x', 'linkedin', 'both'];

  function validateObjectives(doc) {
    const errors = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['root must be an object'];
    if (!Array.isArray(doc.objectives) || !doc.objectives.length) return ['objectives must be a non-empty array'];
    const ids = new Set();
    doc.objectives.forEach((o, i) => {
      const at = `objectives[${i}]`;
      if (!o || typeof o !== 'object') { errors.push(`${at} must be an object`); return; }
      if (typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(o.id)) errors.push(`${at}.id must be a lowercase-hyphenated string`);
      else if (ids.has(o.id)) errors.push(`${at}.id "${o.id}" is duplicated`);
      else ids.add(o.id);
      if (typeof o.statement !== 'string' || !o.statement.trim()) errors.push(`${at}.statement must be a non-empty string`);
      if (typeof o.audience !== 'string' || !o.audience.trim()) errors.push(`${at}.audience must be a non-empty string`);
      if (!PLATFORMS.includes(o.primary_platform)) errors.push(`${at}.primary_platform must be x, linkedin or both`);
      for (const k of ['proof_that_counts', 'in_scope', 'not_this']) {
        if (!Array.isArray(o[k]) || o[k].some((s) => typeof s !== 'string')) errors.push(`${at}.${k} must be an array of strings`);
      }
      if (Array.isArray(o.proof_that_counts) && !o.proof_that_counts.length) errors.push(`${at}.proof_that_counts needs at least one item`);
    });
    if (doc.off_objective_everywhere != null && (!Array.isArray(doc.off_objective_everywhere) || doc.off_objective_everywhere.some((s) => typeof s !== 'string'))) errors.push('off_objective_everywhere must be an array of strings');
    return errors;
  }

  // "agents-change-devrel" → "Agents change DevRel"; an explicit `name` wins.
  // Short names, the same everywhere (the score panel's "Serving" select, badges, dashboard).
  // The reference panel's labels for the three objectives; otherwise from the statement.
  const LABELS = { 'agent-builder': 'Hands-on agent builder', 'ecosystem-leader': 'Ecosystem leader who measures', 'agents-change-devrel': 'How agents change DevRel' };
  function nameOf(o) {
    if (!o) return 'Off-objective';
    if (o.label || o.name) return o.label || o.name;
    if (LABELS[o.id]) return LABELS[o.id];
    const st = String(o.statement || '').replace(/^build credibility (?:as an? |on )?/i, '').replace(/\.$/, '').trim();
    if (st) return st.charAt(0).toUpperCase() + st.slice(1);
    const s = o.id.replace(/-/g, ' ').replace(/\bdevrel\b/gi, 'DevRel').replace(/\bai\b/gi, 'AI');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Objectives for a platform, primary-platform first.
  function forPlatform(doc, platform) {
    const all = (doc && doc.objectives) || [];
    const rank = (o) => (o.primary_platform === platform ? 0 : o.primary_platform === 'both' ? 1 : 2);
    return all.slice().sort((a, b) => rank(a) - rank(b));
  }

  // ---------- The Developer Trust filter ----------
  // "Would a developer trust you with a real problem?" 0-10. Buckets come from the score, never
  // from the model's label: Kill (0), Low (<4), Middle (4-7.9), Sweet (8-10). A kill is score 0.
  const KILL_CATEGORIES = ['personal or veiled attack', 'drugs or sex', 'politics or culture war', 'cynical or depressive looping', 'repeating the same point', 'emotion-only hype'];
  const bucketOf = (score) => (score <= 0 ? 'kill' : score < 4 ? 'low' : score < 8 ? 'middle' : 'sweet');
  const BUCKET_NAMES = { kill: 'Kill', low: 'Low', middle: 'Middle', sweet: 'Sweet' };

  function parseObjectivesResponse(raw, doc) {
    let j = raw;
    if (typeof raw === 'string') {
      const s = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('grader response is not an object');
    if (j.error) throw new Error(String(j.error));
    const ids = new Set(((doc && doc.objectives) || []).map((o) => o.id));
    const objective_id = j.objective_id && (!ids.size || ids.has(j.objective_id)) ? j.objective_id : null;
    const kill = j.kill && typeof j.kill === 'object' && str(j.kill.category) ? { category: KILL_CATEGORIES.includes(j.kill.category) ? j.kill.category : str(j.kill.category), span: str(j.kill.span) } : null;
    let score = num(j.score, 0, 10) ?? 0;
    if (kill || j.bucket === 'kill') score = 0;
    score = Math.round(score * 10) / 10;
    const lawyer = j.lawyer && typeof j.lawyer === 'object' ? {
      stance: ['ship', 'fix', 'kill'].includes(j.lawyer.stance) ? j.lawyer.stance : 'ship',
      take: str(j.lawyer.take),
      confidence: ['low', 'medium', 'high'].includes(j.lawyer.confidence) ? j.lawyer.confidence : 'low',
    } : null;
    return {
      score, bucket: bucketOf(score), why: str(j.why), kill: kill || (score === 0 && j.bucket === 'kill' ? { category: 'instant kill', span: '' } : null),
      objective_id,
      // "Get to 8" steps, raw: src/steps.js validates them against the draft.
      steps: arr(j.steps).map((x) => ({
        type: ['attach_proof', 'ask_fact', 'line_edit'].includes(x && x.type) ? x.type : null,
        title: str(x && x.title), why: str(x && x.why), points: num(x && x.points, 0, 10) ?? 0,
        question: str(x && x.question) || null, example: str(x && x.example) || null, action_label: str(x && x.action_label) || null,
        proof_kind: str(x && x.proof_kind) || null, line_before: x && x.line_before != null ? String(x.line_before) : null, line_after: x && x.line_after != null ? String(x.line_after) : null,
        adds_proof: Boolean(x && x.adds_proof), prefilled: Boolean(x && x.prefilled), compare: str(x && x.compare) || null,
      })).filter((x) => x.type),
      no_steps_reason: str(j.no_steps_reason) || null,
      tmi: arr(j.tmi).map((t) => ({ category: str(t && t.category) || 'other', span: str(t && t.span), question: str(t && t.question) })).filter((t) => t.question || t.span),
      lawyer,
      // Three grades, gated on the median (server/pipeline.mjs). Over 1.0 apart: "Unstable score".
      runs: arr(j.runs).filter((x) => typeof x === 'number'),
      spread: num(j.spread, 0, 10) ?? 0,
      unstable: j.unstable === true,
    };
  }

  // The send gate. One short reason, the most important first.
  // inputs: {
  //   text, status ('pending'|'grading'|'done'|'error'), error, result (parsed), hash,
  //   tmiOpen: [hits], safetyKill: string|null (bait, attacks…), placeholders: [..],
  //   override: { hash, reason } | null, threshold (8) }
  // Hard locks (no override): empty, TMI block items, safety (engagement bait), placeholders.
  // Typed reason unlocks: grader offline, lawyer kill (high confidence), a trust kill, score < threshold.
  // The gate is score >= threshold: "needs 8+" means 8.0 passes.
  // Warn/high TMI questions must be answered in place (Keep / Keep with reason).
  function objectiveGate(i) {
    const threshold = i.threshold ?? 8;
    if (!String(i.text || '').trim()) return { locked: true, tone: 'neutral', label: 'Write something', overridable: false, kind: 'empty' };
    const blocks = (i.tmiOpen || []).filter((h) => h.sev === 'block');
    if (blocks.length) return { locked: true, tone: 'red', label: blocks[0].id === 'private' ? 'Remove your private term' : blocks[0].id === 'address' ? 'Remove the street address' : 'Remove the contact info', overridable: false, kind: 'tmi-block' };
    if (i.safetyKill) return { locked: true, tone: 'red', label: i.safetyKill, overridable: false, kind: 'safety' };
    if ((i.placeholders || []).length) return { locked: true, tone: 'amber', label: 'Replace the placeholder', overridable: false, kind: 'placeholder' };
    const questions = (i.tmiOpen || []).length;
    if (questions) return { locked: true, tone: 'amber', label: `Answer ${questions} privacy question${questions > 1 ? 's' : ''}`, overridable: false, kind: 'tmi' };
    const overridden = Boolean(i.override && i.override.hash === i.hash && String(i.override.reason || '').trim().length >= 8);
    // The on-device trust kill locks right away, before grading; "Post anyway" (a typed reason) is offered.
    if (i.kill && !overridden) return { locked: true, tone: 'red', label: `Kill: ${i.kill.category}`, overridable: true, kind: 'kill' };
    if (i.status === 'pending' || i.status === 'grading' || !i.status) return { locked: true, tone: 'neutral', label: 'Grading…', overridable: false, kind: 'pending' };

    const lock = (() => {
      if (i.status === 'error') return { tone: 'red', label: 'Grader offline', kind: 'offline' };
      const r = i.result;
      if (r.lawyer && r.lawyer.stance === 'kill' && r.lawyer.confidence === 'high') return { tone: 'red', label: 'Lawyer: risky to post', kind: 'lawyer' };
      // A kill (from the grader, or the on-device check) locks; a typed reason can override it.
      const kill = r.kill || i.kill;
      if (kill || r.bucket === 'kill') return { tone: 'red', label: `Kill: ${kill ? kill.category : 'instant kill'}`, kind: 'kill' };
      // Unstable (three grades more than 1.0 apart): never locks you out on the score alone.
      if (!(r.score >= threshold) && !r.unstable) return { tone: 'amber', label: `${r.score.toFixed(1)} / 10, needs ${threshold}+`, kind: 'score' };
      return null;
    })();
    if (!lock) return i.result.unstable && !(i.result.score >= threshold)
      ? { locked: false, tone: 'amber', label: 'Unstable score', overridable: false, kind: 'unstable' }
      : { locked: false, tone: 'green', label: `${i.result.score.toFixed(1)} / 10`, overridable: false, kind: 'pass' };
    if (overridden) return { locked: false, tone: 'amber', label: `Sent anyway: ${i.override.reason}`, overridable: false, kind: 'overridden', overriddenKind: lock.kind };
    return { locked: true, ...lock, overridable: true };
  }

  // The on-device scorer's kill (src/scorer.js) as a Developer Trust kill: category + quoted span.
  // "Repeating the same point" is left to the grader: the on-device check misfires on it.
  const KILL_MAP = [[/personal or veiled attack/i, 'personal or veiled attack'], [/drugs|sex/i, 'drugs or sex'], [/politic|divisive/i, 'politics or culture war'], [/cynical|negative|depress/i, 'cynical or depressive looping'], [/hype|pure emotion/i, 'emotion-only hype']];
  function killFromScorer(r) {
    if (!r || r.bucket !== 'kill' || /repeats a point/.test(r.reason || '')) return null;
    const hit = KILL_MAP.find(([re]) => re.test(r.reason));
    return { category: hit ? hit[1] : 'instant kill', span: (String(r.reason).match(/[“"](.+?)[”"]/) || [])[1] || '' };
  }

  // "Middle · 5.0 · true but trite"
  function headline(result) {
    if (!result) return '';
    return [BUCKET_NAMES[result.bucket] || '', typeof result.score === 'number' ? result.score.toFixed(1) : '', result.why].filter(Boolean).join(' · ');
  }

  const api = { validateObjectives, nameOf, forPlatform, parseObjectivesResponse, objectiveGate, headline, bucketOf, BUCKET_NAMES, KILL_CATEGORIES, killFromScorer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetObjectives = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
