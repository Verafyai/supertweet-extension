// Objective grading for drafts (objectives.json is the only thing a post is scored against), and
// the score panel's state. Grading runs when you press Grade (or ⌘/Ctrl+Enter). The server
// (server/pipeline.mjs) grades three times and gates on the median, then returns at most 2 "Get
// to 8" steps that won a pairwise "which would this audience rather read?" check. Grades are
// cached by draft, across reloads, so the same draft always shows the same score. The X algorithm
// row offers Tune for X (one validated pass) and Details (specific fixes for this draft).
// Safety checks run on-device on every keystroke: the TMI filter, X-rubric kills and bait.
// Private terms and contact info are masked before anything leaves the browser.
(() => {
  'use strict';
  const { checks, hashText } = globalThis.SupertweetChecks;
  const O = globalThis.SupertweetObjectives;
  const TMI = globalThis.SupertweetTMI;
  const XL = globalThis.SupertweetXLinter;
  const Steps = globalThis.SupertweetSteps;
  const P = globalThis.SupertweetPanel;
  const { merge } = globalThis.SupertweetSettings;
  const { replaceDraft } = globalThis.SupertweetUI;

  const TIMEOUT_MS = 100_000;
  const OVERRIDE_MIN = 8;
  const CHAR_LIMIT = { x: 280, linkedin: 3000 };

  function createAudience({ adapter, onChange, context }) {
    const platform = adapter.id;
    const storage = chrome.storage.local;
    let config = null; // { objectivesDoc, rules, privateTerms, settings, unlinked }
    let overrides = [];
    const states = new Map(); // editor -> grade state
    const results = new Map(); // request key -> { result, steps }
    const kept = new WeakMap(); // editor -> Set of kept TMI keys
    const choice = new WeakMap(); // editor -> objective id picked in "Serving" ('auto' until you pick)
    const ui = new WeakMap(); // editor -> panel-only state (answers, reasons, details, override)
    const undo = new WeakMap(); // editor -> earlier drafts, one per change the panel made

    const send = (msg) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('grader timed out')), TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          clearTimeout(t);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message)); else resolve(res);
        });
      } catch (e) { clearTimeout(t); reject(e); }
    });

    async function loadConfig() {
      try {
        const c = await send({ type: 'config' });
        config = { ...c, settings: merge(c.settings) };
      } catch (e) {
        config = { error: e.message, settings: merge(null), objectivesDoc: null, rules: null, privateTerms: [] };
      }
      overrides = (await storage.get({ overrides: [] })).overrides || [];
      results.clear();
      for (const el of [...states.keys()]) { states.delete(el); track(el); }
      onChange();
    }
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local') return;
      if (c.overrides) { overrides = c.overrides.newValue || []; onChange(); }
      if (c.settings || c.objectivesOverride || c.privateTerms || c.apiToken || c.algoSync) loadConfig();
    });
    const ready = loadConfig();

    const settings = () => (config ? config.settings : merge(null));
    const doc = () => (config && config.objectivesDoc) || { objectives: [] };
    const privateTerms = () => (config && config.privateTerms) || [];
    const active = () => Boolean(config && !config.unlinked);
    const chosen = (el) => choice.get(el) || 'auto';
    const gate = () => settings().threshold || 8;
    const uiOf = (el) => { if (!ui.has(el)) ui.set(el, { answers: {}, reasons: {} }); return ui.get(el); };

    // ---------- Draft changes made by the panel (all undoable) ----------

    function applyDraft(el, next) {
      const before = adapter.readDraft(el).text;
      const st = undo.get(el) || [];
      st.push(before);
      undo.set(el, st.slice(-20));
      replaceDraft(el, next);
      onChange();
    }
    function undoLast(el) {
      const st = undo.get(el) || [];
      const prev = st.pop();
      if (prev == null) return;
      replaceDraft(el, prev);
      onChange();
    }

    // ---------- Grading ----------

    const draftIds = new WeakMap();
    const newId = () => `${platform}:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
    const draftIdFor = (el) => { if (!draftIds.has(el)) draftIds.set(el, newId()); return draftIds.get(el); };
    const mediaOf = (el) => { const m = adapter.composerMedia ? adapter.composerMedia(el).media : 'none'; return m && m !== 'none' ? [m] : []; };

    function payloadFor(text, title, el, attachments) {
      const pick = el ? chosen(el) : 'auto';
      return {
        platform,
        post_text: TMI.mask(text, privateTerms()), // private terms and contact info never leave the device
        title: title ? TMI.mask(title, privateTerms()) : null,
        objective_id: pick !== 'auto' ? pick : null,
        objectives: config && config.objectivesSource === 'edited' ? doc() : undefined,
        draft_id: el ? draftIdFor(el) : undefined,
        attachments: attachments || (el ? mediaOf(el) : []),
        checks: checks(text, title),
      };
    }
    const requestKey = (text, title, el, attachments) => hashText(JSON.stringify([text, title, el ? chosen(el) : 'auto', attachments || [], doc().objectives.map((o) => o.id), privateTerms().length]));

    // ---------- What the app already knows (stats, rejections) and the grade cache ----------
    // Kept in chrome.storage so the same draft shows the same score after a reload, the grader never
    // asks for numbers Supertweet can compute, and your rejected steps teach it what not to suggest.
    let memory = { gradeCache: {}, gradeLog: [], rejectedSteps: [], postedCount: 0 };
    storage.get({ gradeCache: {}, gradeLog: [], rejectedSteps: [], postedCount: 0 }, (r) => queueMicrotask(() => { memory = { ...memory, ...r }; onChange(); }));
    const persist = (patch) => { Object.assign(memory, patch); storage.set(patch); };
    const appStats = () => Steps.appStats({ grades: memory.gradeLog, posted: memory.postedCount });
    const avoid = () => Steps.avoidList(memory.rejectedSteps, overrides);

    async function grade(payload) {
      const res = await send({ type: 'grade', payload: { ...payload, app_stats: appStats(), avoid: avoid() } });
      if (!res || !res.ok) throw new Error((res && res.error) || 'no response from grader');
      return O.parseObjectivesResponse(res.data, doc());
    }

    const shown = new Map(); // editor -> last state with results (display while updating)
    const busy = new Set();
    const cached = (key) => results.get(key) || (memory.gradeCache[key] ? { result: memory.gradeCache[key] } : null);

    function track(el) {
      if (!active()) return;
      const { text, title } = adapter.readDraft(el);
      const media = mediaOf(el);
      const key = requestKey(text, title, el, media);
      const prev = states.get(el);
      if (prev && prev.key === key) return;
      if (prev) { clearTimeout(prev.timer); if (prev.result) shown.set(el, prev); }
      const st = { key, hash: hashText(text), text, title, media, status: text ? 'pending' : 'empty', result: null, error: null, timer: null };
      states.set(el, st);
      if (!text) { shown.delete(el); return; }
      const hit = cached(key);
      if (hit) Object.assign(st, { status: 'done', result: hit.result });
      // Otherwise it waits for you: grading only runs from the Grade button (gradeNow).
    }

    // The Grade button / ⌘+Enter.
    function gradeNow(el) {
      track(el);
      const st = states.get(el);
      if (!st || st.status !== 'pending') return;
      run(el);
    }

    async function run(el) {
      const st = states.get(el);
      if (!st || st.status !== 'pending') return;
      if (busy.has(el)) { st.queued = true; return; } // runs when the current grade finishes
      busy.add(el);
      st.status = 'grading';
      onChange();
      try {
        st.result = await grade({ ...payloadFor(st.text, st.title, el, st.media), mode: 'score' });
        st.status = 'done';
        remember(st.key, st.result, st);
      } catch (e) { st.status = 'error'; st.error = e.message; }
      onChange();
      busy.delete(el);
      const now = states.get(el);
      if (now && now !== st && now.status === 'pending' && now.queued) run(el);
    }

    // Same draft, same score: remembered by request key (text + objective + media) across reloads.
    function remember(key, result, st) {
      results.set(key, { result });
      if (results.size > 200) results.delete(results.keys().next().value);
      const gc = { ...memory.gradeCache, [key]: result };
      const keys = Object.keys(gc);
      if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete gc[k];
      const failed = st ? XL.lint(st.text, {}, (config && config.rules) || {}).filter((x) => x.s === 'fail').map((x) => x.t) : [];
      const log = st ? memory.gradeLog.concat({ hash: st.hash, score: result.score, failed, ts: Date.now() }).slice(-500) : memory.gradeLog;
      persist({ gradeCache: gc, gradeLog: log });
    }

    // Steps to show: the server's (already pairwise-checked, at most 2, 1.0+), minus skipped and
    // rejected ones. None while locked = "Ready as written" (except proof, which the server adds).
    function stepsFor(el, st) {
      const r = st && st.result;
      if (!r || r.bucket === 'kill' || r.score >= gate()) return [];
      const u = uiOf(el);
      const skipped = u.skipped || new Set();
      const keyOf = (s) => `${s.type}|${s.title}|${s.line_before || ''}|${s.line_after || ''}`;
      return Steps.normalizeSteps(r.steps, st.text).filter((s) => !skipped.has(keyOf(s)) && !memory.rejectedSteps.some((x) => Steps.sameStep(s, { ...x, kind: 'rejected_step' })))
        .map((s) => ({ ...s, key: keyOf(s) }));
    }

    // ---------- On-device safety (every keystroke) ----------

    function tmiFor(el, text, result) {
      const hits = TMI.mergeGrader(TMI.detect(text, privateTerms()), result ? result.tmi : []);
      return { hits, open: TMI.openQuestions(hits, kept.get(el) || new Set()) };
    }

    // On-device Developer Trust kill check (instant, before grading): category + the span quoted.
    // "Repeating the same point" is left to the grader (the on-device check misfires on it).
    function onDeviceKill(text) {
      const S = globalThis.SupertweetScorer;
      return S && String(text || '').trim() ? O.killFromScorer(S.score(text)) : null;
    }

    // Engagement bait: a hard block (never overridable).
    function safetyKill(text) {
      const R = XL.lint(text, {}, (config && config.rules) || {});
      const bait = R.find((x) => x.id === 'report' && x.s === 'fail');
      if (bait) return `Cut the engagement bait ("${bait.evidence}")`;
      return null;
    }

    const overrideFor = (hash) => overrides.find((o) => o.hash === hash && o.platform === platform) || null;

    function decision(el) {
      const { text } = adapter.readDraft(el);
      if (!active()) {
        // Unlinked: on-device safety still applies; grading doesn't.
        const t = tmiFor(el, text, null);
        const kill = safetyKill(text);
        const tk = onDeviceKill(text);
        if (t.open.some((x) => x.sev === 'block') || kill || tk) return O.objectiveGate({ text, status: 'done', tmiOpen: t.open, safetyKill: kill, kill: tk, placeholders: [], result: { score: 10, bucket: 'sweet', objective_id: 'x' } });
        return { locked: false, tone: 'neutral', label: '', kind: 'unlinked' };
      }
      const st = states.get(el);
      const result = st && st.status === 'done' ? st.result : null;
      const t = tmiFor(el, text, result);
      return O.objectiveGate({
        text, status: st ? st.status : 'pending', error: st && st.error, result, hash: st && st.hash,
        tmiOpen: t.open, safetyKill: safetyKill(text), kill: onDeviceKill(text), placeholders: XL.placeholders(text),
        override: st && overrideFor(st.hash), threshold: gate(),
      });
    }

    async function logOverride(el, reason, kind) {
      const st = states.get(el);
      if (!st) return;
      const r = st.result;
      const entry = { ts: new Date().toISOString(), platform, hash: st.hash, reason, kind, score: r ? r.score : null, objective_id: r ? r.objective_id : null };
      const all = ((await storage.get({ overrides: [] })).overrides || []).concat(entry).slice(-500);
      await storage.set({ overrides: all });
    }

    // Heat of the moment: park the draft for 24 hours instead of posting now.
    async function queue(el, due) {
      const { text } = adapter.readDraft(el);
      const at = due || Date.now() + 24 * 3600e3;
      const all = ((await storage.get({ queue: [] })).queue || []).concat({ id: newId(), platform, text, due: at, created: Date.now() });
      await storage.set({ queue: all.slice(-50) });
      uiOf(el).note = due ? `Queued for ${new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. It's in the Supertweet popup; you can clear this draft.` : 'Queued for 24 hours. Find it in the Supertweet popup tomorrow; you can clear this draft.';
      onChange();
    }

    // ---------- Panel state (the PanelState typedef in src/panel.js) ----------

    const algoContext = (el) => ({ ...(context ? context(el) : {}) });

    function flagsFor(el, text, cur, d) {
      const u = uiOf(el);
      const flags = [];
      const t = tmiFor(el, text, cur);
      for (const hit of t.open) {
        const ev = TMI.evidence(hit);
        const f = { id: hit.id, question: hit.q, evidence: ev.length ? `Found: ${ev.join(', ')}` : '', block: hit.sev === 'block', actions: [], hit };
        if (hit.sev === 'block') f.label = hit.id === 'private' ? 'Remove your private term' : hit.id === 'address' ? 'Remove the street address' : 'Remove the contact info';
        if (hit.matches.length) f.actions.push({ label: hit.matches.length > 1 ? 'Remove these' : 'Remove it', act: 'remove' });
        if (hit.sev === 'warn') f.actions.push({ label: "Keep, it's intentional", act: 'keep' });
        if (hit.id === 'heat') f.actions.push({ label: 'Queue for 24h', act: 'queue' });
        if (hit.sev === 'high') { f.reason = 'Why is this safe to post? (8+ characters)'; f.reasonValue = u.reasons[TMI.keyOf(hit)] || ''; f.actions.push({ label: 'Keep', act: 'keep-reason', needsReason: true }); }
        flags.push(f);
      }
      const bait = safetyKill(text);
      if (bait) flags.push({ id: 'safety', question: bait, label: bait.replace(/\s*\(.*$/, '').slice(0, 40), block: true, actions: [] });
      // A Developer Trust kill: red block naming the category and quoting the span. "Post anyway,
      // with a reason" (logged) is the only way past it.
      const tk = (cur && cur.kill) || onDeviceKill(text);
      if (tk && d.kind !== 'overridden') flags.push({ id: 'kill', question: `Kill: ${tk.category}`, evidence: tk.span ? `“${tk.span}”` : '', label: `Kill: ${tk.category}`, block: true, actions: [] });
      if (XL.placeholders(text).length) flags.push({ id: 'placeholder', question: 'Your draft still has a bracketed placeholder. Replace it with the real thing.', label: 'Replace the placeholder', actions: [] });
      if (cur && cur.lawyer && cur.lawyer.stance === 'kill' && cur.lawyer.confidence === 'high' && d.kind !== 'overridden') flags.push({ id: 'lawyer', question: `Lawyer: ${cur.lawyer.take}`, label: 'Lawyer: risky to post', actions: [] });
      return flags;
    }

    function stateFor(el, extra) {
      const u = uiOf(el);
      const { text } = adapter.readDraft(el);
      const st = states.get(el);
      const d = decision(el);
      const last = shown.get(el);
      const cur = st && st.status === 'done' ? st.result : null;
      const r = cur || (st && st.status !== 'error' && last && last.result) || null;
      const objs = O.forPlatform(doc(), platform);
      const pick = chosen(el);
      const rules = (config && config.rules) || {};
      const R = platform === 'x' ? XL.lint(text, algoContext(el), rules) : [];
      const pending = active() && (!st || st.status === 'pending' || st.status === 'grading');
      const needsGrade = active() && Boolean(text.trim()) && (!st || (st.status === 'pending' && !st.queued));
      const shownSteps = cur ? stepsFor(el, st) : [];
      const steps = shownSteps.map((s) => ({
        type: s.type, title: s.title, why: s.why, points: s.points, key: s.key,
        attachLabel: s.action_label, question: s.question, placeholderExample: s.example,
        lineBefore: s.line_before, lineAfter: s.line_after, answer: u.answers[`${s.type}:${s.line_before || ''}`] || '',
      }));
      // X algorithm: the model's verdicts (once you've asked for them) override the keyword checks.
      const analysis = platform === 'x' ? analyses.get(hashText(text)) : null;
      const RM = analysis && analysis.verdicts ? XL.mergeVerdicts(R, analysis.verdicts) : R;
      const checksView = u.details && platform === 'x' ? { ...XL.checkRows(RM, text, analysis, rules), status: analysis ? 'done' : u.analysisError ? 'error' : 'loading', message: u.analysisError } : null;
      const flags = flagsFor(el, text, cur, d);
      const state = {
        platform,
        objectives: objs.map((o) => ({ id: o.id, label: P.labelOf(o) })),
        // Context only (who's reading): the trust score never depends on it.
        objectiveId: pick !== 'auto' ? pick : (r && r.objective_id) || (objs[0] && objs[0].id) || '',
        score: r ? r.score : null,
        gate: gate(),
        why: r ? r.why : '',
        steps,
        flags,
        algorithmFit: platform === 'x' ? XL.fit(RM, text, rules) : 0,
        draft: text,
        charLimit: CHAR_LIMIT[platform] || 280,
        attachments: st ? st.media : [],
        // Additions for the live panel (see src/panel.js):
        hold: !active() || pending || (st && st.status === 'error') || Boolean(extra.postLabel),
        grade: needsGrade ? 'needed' : pending ? 'running' : null,
        pill: !active() ? 'Not linked' : st && st.status === 'error' ? 'Grader offline' : 'Grading…',
        postLabel: extra.postLabel || (!active() ? 'Link Supertweet to grade' : !text.trim() ? 'Write something' : needsGrade && !flags.length ? 'Grade to post' : st && (st.status === 'grading' || st.queued) ? 'Grading…' : st && st.status === 'error' && d.kind !== 'overridden' ? 'Grader offline' : null),
        overridable: Boolean(d.locked && d.overridable),
        overridden: d.kind === 'overridden',
        overrideOpen: Boolean(u.overrideOpen), overrideReason: u.overrideReason || '',
        detailsOpen: Boolean(u.details),
        checks: checksView,
        alerts: bannerAlerts(),
        tune: u.tune && u.tune.hash === hashText(text) || (u.tune && u.tune.accepted) ? u.tune : null,
        critique: u.critique && u.critique.hash === hashText(text) ? u.critique : null,
        noStepsReason: cur && cur.bucket !== 'kill' && cur.score < gate() && !shownSteps.length ? cur.no_steps_reason || 'Nothing to add without inventing facts.' : null,
        unstable: Boolean(cur && cur.unstable), spread: cur ? cur.spread : 0,
        sendLabel: extra.sendLabel, note: extra.note || u.note || null,
        canUndo: (undo.get(el) || []).length > 0,
      };
      return { state, d };
    }

    // Only what affects posts, only when a value changed ("Replies now weigh 6 (was 5).").
    function bannerAlerts() {
      const b = platform === 'x' && config && config.rules && config.rules.sync && config.rules.sync.banner;
      return b && Array.isArray(b.alerts) ? b.alerts.slice(0, 5) : [];
    }

    // ---------- X algorithm: Details review and Tune for X ----------
    const analyses = new Map(); // text hash -> the model's X review (verdicts + specific fixes)
    const failingChecks = (R) => R.filter((x) => x.s === 'fail' || x.s === 'warn').map((x) => ({ id: x.id, title: x.t, status: x.s, weight: String(x.why || '').split(/(?<=\.)\s/)[0] }));
    const sinceLast = (el) => { const c = algoContext(el); return typeof c.minutesSinceLastPost === 'number' ? c.minutesSinceLastPost : null; };
    async function analyze(el) {
      const { text } = adapter.readDraft(el);
      const h = hashText(text);
      if (analyses.has(h) || !text.trim()) return;
      const u = uiOf(el);
      u.analysisError = null;
      const R = XL.lint(text, algoContext(el), (config && config.rules) || {});
      const st = states.get(el);
      try {
        const res = await send({ type: 'analyze', payload: { post_text: TMI.mask(text, privateTerms()), objective_id: (st && st.result && st.result.objective_id) || (chosen(el) !== 'auto' ? chosen(el) : null), checks: failingChecks(R), minutes_since_last_post: sinceLast(el) } });
        if (!res || !res.ok) throw new Error((res && res.error) || 'X review unavailable');
        analyses.set(h, res.data);
        if (analyses.size > 50) analyses.delete(analyses.keys().next().value);
      } catch (e) { u.analysisError = e.message; }
      onChange();
    }

    async function tune(el) {
      const { text, title } = adapter.readDraft(el);
      const u = uiOf(el);
      const h = hashText(text);
      if (TMI.mask(text, privateTerms()) !== text) { u.tune = { hash: h, status: 'error', message: 'remove private terms and contact info first' }; onChange(); return; }
      u.tune = { hash: h, status: 'running' };
      onChange();
      const rules = (config && config.rules) || {};
      const ctx = algoContext(el);
      const st = states.get(el);
      try {
        const res = await send({ type: 'tune', payload: { post_text: text, objective_id: (st && st.result && st.result.objective_id) || (chosen(el) !== 'auto' ? chosen(el) : null), attachments: mediaOf(el), checks: failingChecks(XL.lint(text, ctx, rules)), app_stats: appStats(), avoid: avoid(), minutes_since_last_post: sinceLast(el) } });
        if (!res || !res.ok) throw new Error((res && res.error) || 'Tune for X unavailable');
        const t = res.data;
        if (uiOf(el).tune !== u.tune) return;
        if (t.status !== 'ok') { u.tune = { hash: h, status: 'none' }; onChange(); return; }
        const fitBefore = XL.fit(XL.mergeVerdicts(XL.lint(text, ctx, rules), t.verdicts_before), text, rules);
        const fitAfter = XL.fit(XL.mergeVerdicts(XL.lint(t.text, ctx, rules), t.verdicts_after), t.text, rules);
        // A weak edit isn't worth showing: it has to raise the X score by 1.0 or more.
        if (fitAfter - fitBefore < 1) { u.tune = { hash: h, status: 'none' }; onChange(); return; }
        const diff = Steps.lineDiff(text, t.text).map((x) => ({ old: x.old, new: x.new }));
        u.tune = { hash: h, status: 'ready', original: text, text: t.text, fitBefore, fitAfter, objBefore: t.objective_before, objAfter: t.objective_after, diff, grade: t.grade_after, title };
      } catch (e) { u.tune = { hash: h, status: 'error', message: e.message }; }
      onChange();
    }

    function actionsFor(el, state, d, extra) {
      const u = uiOf(el);
      return {
        close: () => globalThis.SupertweetUI.open(false),
        grade: () => gradeNow(el),
        objective: (id) => { choice.set(el, id); gradeNow(el); onChange(); }, // picking an objective re-grades against it
        attach: () => { if (adapter.openAttach) adapter.openAttach(el); },
        apply: (s, next) => { applyDraft(el, next); },
        answer: (s, v) => { u.answers[`${s.type}:${s.lineBefore || ''}`] = v; },
        flagReason: (f, v) => { if (f.hit) u.reasons[TMI.keyOf(f.hit)] = v; },
        flag: (f, a) => {
          const { text } = adapter.readDraft(el);
          const k = kept.get(el) || new Set();
          if (a.act === 'remove') applyDraft(el, TMI.removeMatches(text, f.hit));
          if (a.act === 'keep') { k.add(TMI.keyOf(f.hit)); kept.set(el, k); onChange(); }
          if (a.act === 'keep-reason' && (u.reasons[TMI.keyOf(f.hit)] || '').trim().length >= OVERRIDE_MIN) { k.add(TMI.keyOf(f.hit)); kept.set(el, k); onChange(); }
          if (a.act === 'queue') queue(el);
        },
        details: (open) => { u.details = open; if (open && platform === 'x') analyze(el); onChange(); },
        skip: (s) => { (u.skipped = u.skipped || new Set()).add(s.key); onChange(); }, // optional: never changes the score
        reject: (s) => { persist({ rejectedSteps: memory.rejectedSteps.concat({ ts: new Date().toISOString(), type: s.type, title: s.title, line_before: s.lineBefore || null, line_after: s.lineAfter || null }).slice(-50) }); onChange(); },
        tune: () => tune(el),
        critique: async () => {
          const { text } = adapter.readDraft(el);
          const h = hashText(text);
          if (u.critique && u.critique.hash === h) { u.critique.open = !u.critique.open; onChange(); if (u.critique.status !== 'error') return; }
          u.critique = { hash: h, open: true, status: 'loading' };
          onChange();
          try { const data = await api.critique(text); if (u.critique.hash === h) Object.assign(u.critique, { status: 'done', data }); } catch (e) { if (u.critique.hash === h) Object.assign(u.critique, { status: 'error', message: e.message }); }
          onChange();
        },
        useRewrite: (t) => { if (t) applyDraft(el, t); },
        tuneAccept: () => {
          const t = u.tune;
          if (!t || t.status !== 'ready' || t.accepted) return;
          // The tuned draft was graded on the server before it was shown: that grade stands.
          if (t.grade) remember(requestKey(t.text, t.title, el, mediaOf(el)), O.parseObjectivesResponse(t.grade, doc()), null);
          t.accepted = true;
          applyDraft(el, t.text);
        },
        tuneUndo: () => { const t = u.tune; if (t && t.accepted) { u.tune = null; undoLast(el); } },
        fixCheck: (row) => { const r = Steps.applyLineEdit(adapter.readDraft(el).text, row.before, row.after); if (!r.error) applyDraft(el, r.text); },
        queueAt: (due) => queue(el, due),
        overrideOpen: () => { u.overrideOpen = true; },
        overrideReason: (v) => { u.overrideReason = v; },
        override: async (reason) => { await logOverride(el, reason, d.kind); u.overrideOpen = false; u.overrideReason = ''; },
        undo: () => undoLast(el),
        post: () => extra.onPost && extra.onPost(),
      };
    }

    // Render the panel for this editor into `mount` (only when something changed).
    function render(el, mount, panel, extra = {}) {
      const u = uiOf(el);
      const { state, d } = stateFor(el, extra);
      const key = JSON.stringify(state, (k, v) => (k === 'hit' ? undefined : v));
      // Don't rebuild while you're typing in the panel (the panel re-renders itself for that).
      const typing = panel.root.activeElement && panel.root.activeElement.tagName === 'INPUT';
      if ((u.key === key && mount.firstChild) || typing) return { d, state };
      u.key = key;
      P.renderPanel(mount, state, null, actionsFor(el, state, d, extra));
      return { d, state };
    }

    // Before clicking the native button: capture what's being sent (the composer clears after).
    function snapshot(el) {
      const st = states.get(el);
      if (!st || !st.text || !draftIds.has(el)) return null;
      const o = overrideFor(st.hash);
      return { el, row: { id: draftIds.get(el), platform, text: st.text, gate_result: o ? 'overridden' : 'passed', override_reason: o ? o.reason : null } };
    }
    // After the send is confirmed: mark the row posted and start a fresh session for this editor.
    function markPosted(snap) {
      if (!snap) return;
      send({ type: 'save', rows: [{ ...snap.row, posted_at: new Date().toISOString() }] }).catch(() => {});
      draftIds.delete(snap.el);
      undo.delete(snap.el);
      if (snap.row.gate_result === 'passed') persist({ postedCount: (memory.postedCount || 0) + 1 }); // "posts through the gate"
    }
    const save = (rows) => send({ type: 'save', rows }).catch(() => {});

    function forget(el) {
      const st = states.get(el);
      if (st) clearTimeout(st.timer);
      states.delete(el);
    }

    const api = {
      // The Details critique for any text (past posts, the panel).
      critique: async (text) => {
        const res = await send({ type: 'critique', payload: { platform, post_text: TMI.mask(text, privateTerms()), app_stats: appStats() } });
        if (!res || !res.ok) throw new Error((res && res.error) || 'critique unavailable');
        return res.data;
      },
      ready, active, track, gradeNow, decision, render, stateFor, forget, grade, payloadFor, overrideFor, snapshot, markPosted, save, settings,
      hashText, get config() { return config; }, get doc() { return doc(); }, get overrides() { return overrides; },
    };
    return api;
  }

  globalThis.SupertweetAudience = { createAudience };
})();
