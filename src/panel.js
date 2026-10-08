// The score panel, ported from docs/spec/panel-ref/panel-reference.html (the source of truth for
// the extension and the web app). Markup, CSS, order and names are the reference's. Changes from
// the reference, all needed to run it for real rather than as a demo:
// - CSS variables live on `.st-scope` (a wrapper) instead of :root, so it works in a shadow root.
// - Attach / Apply / Post / Close / objective call `actions` instead of editing demo numbers.
//   Apply uses SupertweetSteps.applyLineEdit: exactly one line changes, every other byte stays.
// - Flags carry their own buttons (Remove / Keep / reason) so a privacy question can be answered.
// - Pending / offline / sending states, the "Post anyway" reason input, Details (the algorithm
//   checklist), an Undo link, and a footer note. None of them show in the two reference states.
(function (root) {
  'use strict';
  const Steps = root.SupertweetSteps || (typeof require === 'function' ? require('./steps.js') : null);

  const CSS = `
.st-scope{
  --st-bg:#0F141B;--st-surf:#171E28;--st-line:#2A3442;--st-text:#E8EDF3;--st-muted:#A3AFBF;
  --st-link:#9AA8F5;--st-btn:#3D55D6;--st-mint:#3FD8A0;--st-amber:#E3A848;--st-red:#EF7A71;--st-bar:#9AA8F5;
  --st-font:"Bricolage Grotesque","Helvetica Neue",system-ui,sans-serif;
  box-sizing:border-box;
}
@media (prefers-color-scheme:light){.st-scope:not([data-theme="dark"]){
  --st-bg:#FFFFFF;--st-surf:#F3F5F8;--st-line:#D9DFE7;--st-text:#141B26;--st-muted:#556173;--st-link:#2F45C4;--st-btn:#2F45C4;--st-mint:#1F8A62;--st-amber:#9A6210;--st-red:#B83A3A;--st-bar:#2F45C4}}
.st-scope[data-theme="light"]{--st-bg:#FFFFFF;--st-surf:#F3F5F8;--st-line:#D9DFE7;--st-text:#141B26;--st-muted:#556173;--st-link:#2F45C4;--st-btn:#2F45C4;--st-mint:#1F8A62;--st-amber:#9A6210;--st-red:#B83A3A;--st-bar:#2F45C4}
.st-scope *,.st-scope *::before,.st-scope *::after{box-sizing:inherit}

/* ---------- the component ---------- */
.st-panel{width:100%;max-width:440px;min-height:640px;background:var(--st-bg);color:var(--st-text);font-family:var(--st-font);
  display:flex;flex-direction:column;border:1px solid var(--st-line);border-radius:16px;overflow:hidden}
.st-head{display:flex;align-items:center;gap:10px;padding:14px 16px 14px 20px;border-bottom:1px solid var(--st-line)}
.st-head img{width:28px;height:28px}
.st-head b{font-size:19px;font-weight:800}
.st-iconbtn{margin-left:auto;width:44px;height:44px;border:0;background:none;color:var(--st-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:10px}
.st-body{flex:1;padding:20px;display:flex;flex-direction:column;gap:18px}
.st-obj{display:flex;align-items:center;gap:10px}
.st-obj span{font-size:13px;color:var(--st-muted)}
.st-obj select{font:inherit;font-size:15px;font-weight:600;color:var(--st-text);background:var(--st-surf);border:1px solid var(--st-line);border-radius:999px;padding:8px 14px;min-height:40px;cursor:pointer}
.st-obj.off select{color:var(--st-amber);border-color:var(--st-amber)}
.st-score{display:flex;align-items:flex-end;gap:10px}
.st-score .n{font-size:72px;line-height:.9;font-weight:800;font-variant-numeric:tabular-nums}
.st-score .of{font-size:20px;color:var(--st-muted);padding-bottom:6px}
.st-pill{margin-left:auto;margin-bottom:8px;font-size:13px;font-weight:700;border:1.5px solid currentColor;border-radius:999px;padding:4px 12px;white-space:nowrap}
.st-bars{display:flex;flex-direction:column;gap:10px}
.st-trust{display:flex;flex-direction:column;gap:8px}
.st-bucket{position:relative;display:grid;grid-template-columns:10fr 36fr 36fr 18fr;gap:3px;font-size:12px;font-weight:600;color:var(--st-muted)}
.st-bucket .seg{display:block;padding-top:14px;border-top:8px solid var(--st-line);border-radius:4px 4px 0 0;text-align:center;white-space:nowrap}
.st-bucket .seg.on{color:var(--st-text)}
.st-bucket .seg.kill.on{border-top-color:var(--st-red)} .st-bucket .seg.low.on{border-top-color:var(--st-red)} .st-bucket .seg.middle.on{border-top-color:var(--st-amber)} .st-bucket .seg.sweet.on{border-top-color:var(--st-mint)}
.st-bucket .mk{position:absolute;top:-3px;width:4px;height:14px;margin-left:-2px;border-radius:2px;background:var(--st-text)}
.st-why{margin:0;font-size:14px;color:var(--st-muted);line-height:1.45}
.st-flag .st-quote{display:block;margin-top:6px;font-style:italic;color:var(--st-text)}
.st-bar{display:grid;grid-template-columns:92px 1fr 70px;align-items:center;gap:12px;font-size:14px}
.st-bar .t{height:8px;border-radius:4px;background:var(--st-line);overflow:hidden}
.st-bar .t i{display:block;height:100%;background:var(--st-bar)}
.st-bar .v{color:var(--st-muted);text-align:right;font-variant-numeric:tabular-nums}
.st-bar .v em{font-style:normal;color:var(--st-red);font-weight:600}
.st-card{background:var(--st-surf);border:1px solid var(--st-line);border-radius:14px;padding:6px 16px 4px}
.st-card .h{display:flex;align-items:baseline;padding:10px 0 8px}
.st-card .h b{font-size:17px;font-weight:800}
.st-card .h span{margin-left:auto;font-size:13px;color:var(--st-muted)}
.st-step{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-top:1px solid var(--st-line)}
.st-step.done{opacity:.55}
.st-step .r{display:flex;align-items:baseline;gap:10px}
.st-step .r b{font-size:16px}
.st-step .r span{margin-left:auto;font-size:15px;font-weight:700;color:var(--st-mint)}
.st-step p{margin:0;font-size:14px;color:var(--st-muted);line-height:1.45}
.st-step label{font-size:13px;color:var(--st-muted)}
.st-step input{font:inherit;font-size:15px;color:var(--st-text);background:var(--st-bg);border:1px solid var(--st-line);border-radius:10px;padding:10px 12px;min-height:44px;width:100%}
.st-diff{font-size:14px;line-height:1.5;background:var(--st-bg);border-radius:10px;padding:10px 12px;white-space:pre-wrap}
.st-diff .was{color:var(--st-muted);text-decoration:line-through}
.st-diff .lbl{display:block;font-size:12px;color:var(--st-muted);margin-top:4px}
.st-diff mark{background:none;color:var(--st-amber);font-weight:600}
.st-act{align-self:flex-start;font:inherit;font-size:14px;font-weight:600;color:var(--st-text);background:var(--st-bg);border:1px solid var(--st-line);border-radius:10px;padding:10px 14px;min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer}
.st-act:disabled{opacity:.45;cursor:not-allowed}
.st-warn{font-size:13px;color:var(--st-amber)}
.st-safe{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--st-muted)}
.st-flag{border:1.5px solid var(--st-amber);border-radius:12px;padding:12px 14px;font-size:14px}
.st-algo{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--st-muted);border-top:1px solid var(--st-line);padding-top:6px}
.st-algo button{margin-left:auto;font:inherit;font-size:13px;color:var(--st-link);background:none;border:0;min-height:44px;cursor:pointer}
.st-foot{padding:16px 20px 20px;border-top:1px solid var(--st-line);display:flex;flex-direction:column;gap:10px;align-items:center}
.st-post{width:100%;min-height:52px;border:0;border-radius:12px;background:var(--st-btn);color:#fff;font:inherit;font-size:17px;font-weight:700;cursor:pointer}
.st-post:disabled{background:var(--st-surf);color:var(--st-muted);border:1px solid var(--st-line);cursor:not-allowed}
.st-foot a{font-size:13px;color:var(--st-link)}
.st-iconbtn:focus-visible,.st-act:focus-visible,.st-post:focus-visible,.st-obj select:focus-visible,.st-algo button:focus-visible,.st-step input:focus-visible{outline:2px solid var(--st-link);outline-offset:2px}

/* ---------- additions (not in the two reference states) ---------- */
.st-flag .st-flag-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.st-flag input,.st-foot input{font:inherit;font-size:15px;color:var(--st-text);background:var(--st-bg);border:1px solid var(--st-line);border-radius:10px;padding:10px 12px;min-height:44px;width:100%;margin-top:10px}
.st-flag.block{border-color:var(--st-red)}
.st-flag .ev{display:block;font-size:13px;color:var(--st-muted);margin-top:4px}
.st-more{display:flex;gap:14px;flex-wrap:wrap}
.st-link{font:inherit;font-size:13px;color:var(--st-link);background:none;border:0;padding:0;min-height:32px;cursor:pointer}
.st-tune .st-scores{margin:0 0 8px;font-size:14px;font-weight:600}
.st-tune .st-diff{margin-top:8px}
.st-acts{display:flex;gap:10px;margin:12px 0 8px}
.st-checks{display:flex;flex-direction:column;gap:12px}
.st-check{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-top:1px solid var(--st-line)}
.st-check .r b{font-size:15px}
.st-check p{margin:0;font-size:14px;color:var(--st-muted);line-height:1.45}
.st-check .st-weight{font-size:13px}
.st-pass{margin:0;font-size:13px;color:var(--st-muted)}
.st-alert{color:var(--st-amber)}
.st-algo button + button{margin-left:6px}
.st-crit-toggle{align-self:flex-start}
.st-crit{border-top:1px solid var(--st-line);padding-top:10px;color:var(--st-text)}
.st-crit .cr-rewrite{background:var(--st-surf)}
.st-foot .st-note{font-size:13px;color:var(--st-muted);text-align:center}
.st-foot .st-reason{width:100%;display:flex;flex-direction:column;gap:8px}
.st-foot .st-reason .st-act{align-self:stretch;justify-content:center}
.st-post.over{background:var(--st-amber);color:#141B26}
/* Grading runs when you ask: the pill slot becomes the Grade button; an outdated score dims. */
button.st-grade{font:inherit;font-size:14px;font-weight:700;color:#fff;background:var(--st-btn);border-color:var(--st-btn);padding:8px 16px;min-height:40px;cursor:pointer}
button.st-grade:focus-visible{outline:2px solid var(--st-link);outline-offset:2px}
.st-score.stale .n{opacity:.4}
`;

  const MARK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M36 10 H92 A26 26 0 0 1 118 36 V76 A26 26 0 0 1 92 102 H56 L30 122 L33 102 A26 26 0 0 1 10 76 V36 A26 26 0 0 1 36 10 Z" fill="#2F45C4"/><path d="M44.9 77.1 A27 27 0 1 1 90.3 51.8" fill="none" stroke="#3FD8A0" stroke-width="10" stroke-linecap="round"/><circle cx="64" cy="58" r="7" fill="#fff"/></svg>');
  const ICON = {
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-8 8"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const xLen = (s) => [...s.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
  const hasScore = (st) => typeof st.score === 'number';
  const ready = (st) => hasScore(st) && (st.score >= st.gate || Boolean(st.unstable)) && // "needs 8+": 8.0 passes; an unstable score never locks you out
    !st.flags.length && st.objectiveId !== null && !st.hold;

  function blocker(st) {
    if (st.postLabel) return st.postLabel; // Grade to post, Grading…, Grader offline, Can't find X's Post button
    if (st.flags.length) {
      const own = st.flags.find((f) => f.label);
      if (own) return own.label;
      return `Answer ${st.flags.length} privacy question${st.flags.length > 1 ? 's' : ''}`;
    }
    if (st.objectiveId === null) return 'Doesn\'t serve an objective';
    // The top open step names the fix (steps are ranked by points).
    const s = st.steps.find((x) => !x.done);
    if (s && s.type === 'attach_proof') return 'Add proof to post';
    if (s && s.type === 'ask_fact') return 'Add your number to post';
    if (s && s.type === 'line_edit') return 'Apply the edit to post';
    return `${st.score.toFixed(1)} / 10, needs ${st.gate}+`;
  }

  // The draft after a step, or null. Exactly one line changes; everything else is byte-identical.
  function stepResult(st, s, answer) {
    const after = s.type === 'ask_fact' ? Steps.fillFact(s.lineAfter, answer) : s.lineAfter;
    if (after == null) return null;
    const r = Steps.applyLineEdit(st.draft, s.lineBefore, after);
    return r.error ? null : r.text;
  }

  /** Renders the panel into el. onChange(newState) is called after any user action. */
  function renderPanel(el, st, onChange, actions = {}) {
    const isReady = ready(st);
    const canPost = isReady || Boolean(st.overridden);
    const color = !hasScore(st) ? 'var(--st-muted)' : isReady ? 'var(--st-mint)' : st.score <= 0 ? 'var(--st-red)' : 'var(--st-amber)'; // a kill reads red
    const open = st.steps.filter((s) => !s.done);
    const gain = open.reduce((a, s) => a + s.points, 0);
    // The Developer Trust bucket bar: Kill (0) | Low (<4) | Middle (4-7) | Sweet (8-10), marker at the score.
    const trustBar = () => {
      const b = hasScore(st) ? (st.score <= 0 ? 'kill' : st.score < 4 ? 'low' : st.score < 8 ? 'middle' : 'sweet') : null;
      const pos = hasScore(st) ? (st.score <= 0 ? 5 : 10 + st.score * 9) : null;
      const seg = (k, label) => `<span class="seg ${k}${b === k ? ' on' : ''}">${label}</span>`;
      // "Why this score": the critique (src/critique.js), fetched when you open it.
      const cr = st.critique;
      const C = root.SupertweetCritique;
      const crit = !hasScore(st) || !C ? '' : `<button class="st-link st-crit-toggle" data-act="critique">${cr && cr.open ? 'Why this score ▾' : 'Why this score ▸'}</button>${!cr || !cr.open ? ''
        : cr.status === 'loading' ? '<p class="st-note">Reading your draft…</p>' : cr.status === 'error' ? `<p class="st-warn">${esc(cr.message || 'critique unavailable')}</p>` : `<div class="st-crit">${C.renderCritique(cr.data, { canUse: true })}</div>`}`;
      return `<div class="st-trust"${b ? ` data-bucket="${b}"` : ''}><div class="st-bucket">${seg('kill', 'Kill')}${seg('low', 'Low')}${seg('middle', 'Middle')}${seg('sweet', 'Sweet')}${pos != null ? `<i class="mk" style="left:${pos}%"></i>` : ''}</div>${st.why ? `<p class="st-why">${esc(st.why)}</p>` : ''}${crit}</div>`;
    };
    const step = (s, i) => {
      let body = '';
      if (s.type === 'attach_proof') body = `<button class="st-act" data-act="attach" data-i="${i}" ${s.done ? 'disabled' : ''}>${ICON.image}${esc(s.done ? 'Attached' : s.attachLabel || 'Attach')}</button>`;
      if (s.type === 'ask_fact') {
        const id = `st-q-${i}`, ans = s.answer || '';
        const after = esc(s.lineAfter).replace('{answer}', ans ? `<mark>${esc(ans)}</mark>` : '<mark>…</mark>');
        const next = ans ? stepResult(st, s, ans) : null;
        const over = next ? xLen(next) - st.charLimit : 0;
        body = `<label for="${id}">${esc(s.question)}</label><input id="${id}" data-i="${i}" value="${esc(ans)}" placeholder="${esc(s.placeholderExample || '')}">
        <div class="st-diff"><span class="was">${esc(s.lineBefore)}</span><span class="lbl">becomes</span>${after}</div>
        ${over > 0 ? `<span class="st-warn">${over} characters over. Shorten before applying.</span>` : ''}
        <button class="st-act" data-act="apply" data-i="${i}" ${!ans || !next || over > 0 || s.done ? 'disabled' : ''}>${s.done ? 'Applied' : 'Apply edit'}</button>`;
      }
      if (s.type === 'line_edit') {
        const next = stepResult(st, s);
        const over = next ? xLen(next) - st.charLimit : 0;
        body = `<div class="st-diff"><span class="was">${esc(s.lineBefore)}</span><span class="lbl">becomes</span>${esc(s.lineAfter)}</div>
        ${over > 0 ? `<span class="st-warn">${over} characters over.</span>` : ''}
        <button class="st-act" data-act="apply" data-i="${i}" ${!next || over > 0 || s.done ? 'disabled' : ''}>${s.done ? 'Applied' : 'Apply edit'}</button>`;
      }
      const more = `<div class="st-more">${s.type === 'ask_fact' ? `<button class="st-link" data-act="skip" data-i="${i}">Skip, I don't have this</button>` : ''}<button class="st-link" data-act="reject" data-i="${i}" title="Bad advice: don't suggest things like this">👎 Bad advice</button></div>`;
      return `<div class="st-step${s.done ? ' done' : ''}"><div class="r"><b>${esc(s.title)}</b><span>+${s.points.toFixed(1)}</span></div><p>${esc(s.why)}</p>${body}${s.done ? '' : more}</div>`;
    };
    const flag = (f, i) => `<div class="st-flag${f.block ? ' block' : ''}" data-flag="${esc(f.id)}">${esc(f.question)}${f.evidence ? `<span class="ev">${esc(f.evidence)}</span>` : ''}${
      f.reason ? `<input data-flag-reason="${i}" placeholder="${esc(f.reason)}" value="${esc(f.reasonValue || '')}">` : ''}${
      (f.actions || []).length ? `<div class="st-flag-acts">${f.actions.map((a, j) => `<button class="st-act" data-flag-i="${i}" data-flag-a="${j}" data-act="${esc(a.act)}" ${a.needsReason && (f.reasonValue || '').trim().length < 8 ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    const footNote = (st.note ? `<span class="st-note">${esc(st.note)}</span>` : '') + (isReady && st.unstable && !(st.score >= st.gate) ? `<span class="st-note">Three grades disagreed by ${Number(st.spread || 0).toFixed(1)}, so this score isn't locking you out.</span>`
      : isReady ? '<span style="font-size:13px;color:var(--st-muted)">Passes the gate. Nothing flagged.</span>'
        : st.overridden ? `<span class="st-note">Sending with your reason</span>`
          : st.overridable === false ? '' : st.overrideOpen
            ? `<div class="st-reason"><input data-override placeholder="Why post this anyway? (8+ characters, logged)" value="${esc(st.overrideReason || '')}"><button class="st-act" data-act="unlock" ${(st.overrideReason || '').trim().length < 8 ? 'disabled' : ''}>Unlock this draft</button></div>`
            : '<a href="#override">Post anyway, with a reason</a>');
    // X algorithm: Tune for X (one pass, both scores shown before anything changes) and Details
    // (only what needs fixing in this draft, each with a specific fix; passes collapse to a count).
    const diffRows = (rows) => rows.map((r) => `<div class="st-diff">${r.old != null ? `<span class="was">${esc(r.old)}</span><span class="lbl">becomes</span>` : '<span class="lbl">new line</span>'}${esc(r.new ?? '')}</div>`).join('');
    const t = st.tune;
    const tuneCard = !t ? '' : t.status === 'running' ? '<div class="st-note st-tune">Tuning for X…</div>'
      : t.status === 'none' ? '<div class="st-note st-tune" data-tune="none">Already in good shape for X</div>'
        : t.status === 'error' ? `<div class="st-warn st-tune">Tune for X: ${esc(t.message || 'unavailable')}</div>`
          : `<div class="st-card st-tune" data-tune="ready"><div class="h"><b>Tune for X</b></div><p class="st-scores">X algorithm ${t.fitBefore.toFixed(1)} → ${t.fitAfter.toFixed(1)}, objective ${t.objBefore.toFixed(1)} → ${t.objAfter.toFixed(1)}</p>${diffRows(t.diff)}
            <div class="st-acts"><button class="st-act" data-act="tune-accept" ${t.accepted ? 'disabled' : ''}>${t.accepted ? 'Accepted' : 'Accept'}</button><button class="st-act" data-act="tune-undo" ${t.accepted ? '' : 'disabled'}>Undo</button></div></div>`;
    const c = st.checks;
    const details = !st.detailsOpen ? '' : `<div class="st-checks">${(c && c.rows ? c.rows : []).map((r, i) => `<div class="st-check" data-check="${esc(r.id)}"><div class="r"><b>${esc(r.title)}</b></div><p class="st-weight">${esc(r.weight)}</p>${r.quote ? `<p>“${esc(r.quote)}”</p>` : r.missing ? `<p>${esc(r.missing)}</p>` : ''}${r.before != null ? diffRows([{ old: r.before, new: r.after }]) : ''}
        ${r.queueAt ? `<button class="st-act" data-act="queue-at" data-i="${i}">${esc(r.queueLabel)}</button>` : `<button class="st-act" data-act="fix-check" data-i="${i}">Fix</button>`}</div>`).join('')}
      ${c && c.status === 'loading' ? '<p class="st-note">Reading your draft for X…</p>' : ''}${c && c.status === 'error' ? `<p class="st-warn">${esc(c.message || 'X review unavailable')}</p>` : ''}
      ${c ? `<p class="st-pass">${c.passes} check${c.passes === 1 ? '' : 's'} pass.</p>` : ''}${(st.alerts || []).map((a) => `<p class="st-note st-alert">X algorithm changed: ${esc(a)}</p>`).join('')}</div>`;
    el.innerHTML = `<section class="st-panel" aria-label="Supertweet score">
    <div class="st-head"><img src="${MARK}" alt=""><b>Supertweet</b><button class="st-iconbtn" aria-label="Close panel">${ICON.close}</button></div>
    <div class="st-body">
      <div class="st-obj${st.objectiveId === null ? ' off' : ''}"><span>Serving</span>
        <select aria-label="Objective">${st.objectiveId === null ? '<option selected>Nothing</option>' : ''}${st.objectives.map((o) => `<option value="${o.id}" ${o.id === st.objectiveId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
      <div class="st-score${st.grade === 'needed' && hasScore(st) ? ' stale' : ''}"><span class="n" style="color:${color}">${hasScore(st) ? st.score.toFixed(1) : '–'}</span><span class="of">/10</span>
        ${st.grade === 'needed' ? `<button class="st-pill st-grade" data-act="grade" title="Grade this draft against your objectives (⌘/Ctrl+Enter)">${hasScore(st) ? 'Re-grade' : 'Grade'}</button>`
    : `<span class="st-pill" style="color:${color}">${st.grade === 'running' ? 'Grading…' : !hasScore(st) ? esc(st.pill || 'Grading…') : st.unstable && !(st.score >= st.gate) ? 'Unstable score' : isReady ? 'Ready' : `Locked · needs ${st.gate}+`}</span>`}</div>
      ${trustBar()}
      ${st.flags.length ? st.flags.map(flag).join('') : ''}
      ${!isReady && st.steps.length ? `<div class="st-card"><div class="h"><b>Get to ${st.gate}</b><span>${open.length} step${open.length === 1 ? '' : 's'}, +${gain.toFixed(1)}</span></div>${st.steps.map(step).join('')}</div>`
    : !isReady && st.noStepsReason ? `<div class="st-card st-asis"><div class="h"><b>Ready as written</b></div><p class="st-note">${esc(st.noStepsReason)}</p></div>` : ''}
      ${st.flags.length ? '' : `<div class="st-safe" style="color:var(--st-muted)"><span style="color:var(--st-mint)">${ICON.check}</span>No privacy or legal flags</div>`}
      ${st.platform === 'x' ? `<div class="st-algo"><span>X algorithm ${st.algorithmFit.toFixed(1)} (advisory)</span><button data-act="tune">Tune for X</button><button data-act="details" aria-expanded="${st.detailsOpen ? 'true' : 'false'}">Details</button></div>${tuneCard}${details}` : ''}
    </div>
    <div class="st-foot">
      <button class="st-post${st.overridden && !isReady ? ' over' : ''}" ${canPost && !st.postLabel ? '' : 'disabled'}>${canPost && !st.postLabel ? esc(st.sendLabel || (st.platform === 'x' ? 'Post to X' : 'Post to LinkedIn')) : esc(blocker(st))}</button>
      ${footNote}
      ${st.canUndo ? '<a href="#undo" data-act="undo">Undo last change</a>' : ''}
    </div></section>`;

    const rerender = () => renderPanel(el, st, onChange, actions);
    // Leaving an input (Unlock, Keep, Apply): the host only re-renders when you're not typing.
    const blur = () => { const a = el.getRootNode().activeElement; if (a && el.contains(a) && a.blur) a.blur(); };
    const keepFocus = (sel, inp) => { const pos = inp.selectionStart; rerender(); const n = el.querySelector(sel); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    el.querySelector('.st-iconbtn').onclick = () => actions.close && actions.close();
    el.querySelector('select').onchange = (e) => { if (actions.objective && e.target.value !== 'Nothing') actions.objective(e.target.value); };
    el.querySelectorAll('[data-act="attach"]').forEach((b) => (b.onclick = () => actions.attach && actions.attach(st.steps[+b.dataset.i])));
    el.querySelectorAll('input[data-i]').forEach((inp) => (inp.oninput = () => { const s = st.steps[+inp.dataset.i]; s.answer = inp.value.trim(); if (actions.answer) actions.answer(s, s.answer); keepFocus(`#st-q-${inp.dataset.i}`, inp); }));
    el.querySelectorAll('[data-act="apply"]').forEach((b) => (b.onclick = () => {
      const s = st.steps[+b.dataset.i];
      const next = stepResult(st, s, s.answer);
      if (next == null || !actions.apply) return;
      blur();
      actions.apply(s, next);
    }));
    el.querySelectorAll('input[data-flag-reason]').forEach((inp) => (inp.oninput = () => { const f = st.flags[+inp.dataset.flagReason]; f.reasonValue = inp.value; if (actions.flagReason) actions.flagReason(f, inp.value); keepFocus(`input[data-flag-reason="${inp.dataset.flagReason}"]`, inp); }));
    el.querySelectorAll('[data-flag-i]').forEach((b) => (b.onclick = () => { const f = st.flags[+b.dataset.flagI]; const a = f.actions[+b.dataset.flagA]; blur(); if (actions.flag) actions.flag(f, a); }));
    const det = el.querySelector('[data-act="details"]');
    if (det) det.onclick = () => { st.detailsOpen = !st.detailsOpen; if (actions.details) actions.details(st.detailsOpen); rerender(); };
    const ov = el.querySelector('a[href="#override"]');
    if (ov) ov.onclick = (e) => { e.preventDefault(); st.overrideOpen = true; if (actions.overrideOpen) actions.overrideOpen(); rerender(); const n = el.querySelector('input[data-override]'); if (n) n.focus(); };
    const oi = el.querySelector('input[data-override]');
    if (oi) oi.oninput = () => { st.overrideReason = oi.value; if (actions.overrideReason) actions.overrideReason(oi.value); keepFocus('input[data-override]', oi); };
    const un = el.querySelector('[data-act="unlock"]');
    if (un) un.onclick = () => { if ((st.overrideReason || '').trim().length >= 8 && actions.override) { blur(); actions.override(st.overrideReason.trim()); } };
    const ud = el.querySelector('[data-act="undo"]');
    if (ud) ud.onclick = (e) => { e.preventDefault(); if (actions.undo) actions.undo(); };
    el.querySelector('.st-post').onclick = () => actions.post && actions.post();
    const on = (act, fn) => el.querySelectorAll(`[data-act="${act}"]`).forEach((b) => (b.onclick = (e) => { e.preventDefault(); blur(); fn(b); }));
    on('skip', (b) => actions.skip && actions.skip(st.steps[+b.dataset.i]));
    on('reject', (b) => actions.reject && actions.reject(st.steps[+b.dataset.i]));
    on('tune', () => actions.tune && actions.tune());
    on('critique', () => actions.critique && actions.critique());
    on('use-rewrite', () => actions.useRewrite && st.critique && st.critique.data && actions.useRewrite(st.critique.data.rewrite));
    on('tune-accept', () => actions.tuneAccept && actions.tuneAccept());
    on('tune-undo', () => actions.tuneUndo && actions.tuneUndo());
    on('fix-check', (b) => actions.fixCheck && actions.fixCheck(st.checks.rows[+b.dataset.i]));
    on('queue-at', (b) => actions.queueAt && actions.queueAt(st.checks.rows[+b.dataset.i].queueAt));
    const gb = el.querySelector('[data-act="grade"]');
    if (gb) gb.onclick = () => actions.grade && actions.grade();
  }

  // The "Serving" select's labels: the same names everywhere (SupertweetObjectives.nameOf).
  const O = root.SupertweetObjectives || (typeof require === 'function' ? require('./objectives.js') : null);
  const labelOf = (o) => (o ? O.nameOf(o) : 'Nothing');

  const CSS_ALL = CSS + ((root.SupertweetCritique && root.SupertweetCritique.CSS) || '');
  const api = { CSS: CSS_ALL, MARK, renderPanel, blocker, ready, labelOf, xLen, stepResult };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetPanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
