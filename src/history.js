// Supertweet history sheet. Scans your own tweets from the Posts & replies tab, caches them in
// chrome.storage.local, and scores them with the Developer Trust filter (kills and privacy hits
// on-device; the full filter via Claude on request). Each post shows its score, bucket, one-line why
// and link, worst first. Deleting is never automatic and never in bulk: one post at a time, from its
// own Delete button, confirmed again for that post on its own page, and logged.
(() => {
  'use strict';
  const { score, tokens } = globalThis.SupertweetScorer;
  const TMI = globalThis.SupertweetTMI;
  const O = globalThis.SupertweetObjectives;
  const P = globalThis.SupertweetPage;
  const storage = globalThis.chrome && chrome.storage && chrome.storage.local;
  if (!storage || !P || P.id !== 'x') return; // X only

  const PARAM = 'supertweet';
  const params = new URLSearchParams(location.search);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  let scan = {}; // id -> { id, handle, url, text, date, deleted, kept, score, bucket, reason }
  let scanning = false;
  let filter = 'recommended';
  let statusText = '';

  const load = async () => { scan = (await storage.get({ scan: {} })).scan || {}; };
  const save = () => storage.set({ scan });

  function myHandles() {
    const s = new Set(P.MY_HANDLES);
    const me = P.loggedInHandle();
    if (me) s.add(me);
    return s;
  }

  function statusLink(article) {
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const time = a.querySelector('time');
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
      if (time && m) return { handle: m[1].toLowerCase(), id: m[2], date: time.getAttribute('datetime') };
    }
    return null;
  }

  // ---------- Scan ----------

  function harvest() {
    const mine = myHandles();
    let added = 0;
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const link = statusLink(art);
      if (!link || !mine.has(link.handle) || P.authorOf(art) !== link.handle) continue;
      const t = art.querySelector('[data-testid="tweetText"]');
      const text = t ? P.tweetTextOf(t) : '';
      if (!text) continue; // media-only posts have nothing to grade
      const prev = scan[link.id];
      if (!prev) added++;
      if (!prev || prev.text.length < text.length) {
        scan[link.id] = { ...prev, id: link.id, handle: link.handle, url: `/${link.handle}/status/${link.id}`, text, date: link.date };
      }
    }
    return added;
  }

  async function runScan() {
    scanning = true;
    openSheet();
    let idle = 0;
    let lastHeight = 0;
    while (scanning && idle < 12) {
      const added = harvest();
      window.scrollBy(0, Math.round(innerHeight * 0.9));
      await sleep(900);
      const h = document.documentElement.scrollHeight;
      idle = added === 0 && h === lastHeight ? idle + 1 : 0;
      lastHeight = h;
      statusText = `Scanning… ${Object.keys(scan).length} tweets cached`;
      if (added) { gradeAll(); await save(); }
      renderSheet();
    }
    scanning = false;
    gradeAll();
    await save();
    statusText = `Scan done. ${Object.keys(scan).length} tweets cached.`;
    renderSheet();
  }

  function startScan() {
    const me = P.loggedInHandle();
    if (!me) { statusText = 'Log in to X first.'; renderSheet(); return; }
    if (location.pathname.toLowerCase() === `/${me}/with_replies`) { runScan(); return; }
    location.assign(`/${me}/with_replies?${PARAM}=scan`);
  }

  // ---------- Grade: safety and privacy on-device, objectives from cached Claude grades ----------

  let past = {}; // x:<id> -> { hash, result } (shared with past-posts.js)
  let grading = false;

  // Oldest first, so the later of two near-duplicates is the repeat.
  function gradeAll() {
    const live = Object.values(scan).filter((t) => !t.deleted).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const earlier = [];
    const terms = (P.audience.config && P.audience.config.privateTerms) || [];
    for (const t of live) {
      const kill = score(t.text, { history: earlier.slice(-500) });
      earlier.push(tokens(t.text));
      const hits = TMI.detect(t.text, terms);
      const c = past[`x:${t.id}`];
      const obj = c && c.result && c.result.bucket && c.hash === P.hashText(t.text) ? c.result : null;
      t.score = obj ? obj.score : null;
      t.objective = obj ? obj.objective_id : undefined;
      if (obj && obj.bucket === 'kill') Object.assign(t, { bucket: 'kill', score: 0, reason: obj.kill ? `Kill: ${obj.kill.category}${obj.kill.span ? ` (“${obj.kill.span}”)` : ''}. ${obj.why}`.trim() : obj.why });
      else if (kill.bucket === 'kill' && !/repeats a point/.test(kill.reason)) Object.assign(t, { bucket: 'kill', score: obj ? obj.score : 0, reason: kill.reason });
      else if (hits.length) Object.assign(t, { bucket: 'privacy', reason: `Privacy: ${[...new Set(hits.map((x) => x.id))].join(', ')}.` });
      else if (obj) Object.assign(t, { bucket: obj.bucket, reason: obj.why || O.headline(obj) });
      else Object.assign(t, { bucket: 'ungraded', reason: 'Not graded with the Developer Trust filter yet.' });
    }
  }

  const SEVERITY = { kill: 0, privacy: 1, low: 2, middle: 3, ungraded: 4, sweet: 5 };
  const recommended = (t) => !t.kept && ['kill', 'privacy', 'low'].includes(t.bucket);

  // Grade the not-yet-graded tweets with the Developer Trust filter (on request).
  async function gradeWithClaude() {
    grading = true;
    renderSheet();
    const todo = Object.values(scan).filter((t) => !t.deleted && t.bucket === 'ungraded');
    let n = 0;
    for (const t of todo) {
      if (!grading) break;
      try {
        const result = await P.audience.grade({ ...P.audience.payloadFor(t.text, null), mode: 'score', draft_id: `x:${t.id}`, source: 'past', post_id: t.id, post_url: `https://x.com${t.url}`, posted_at: t.date });
        past[`x:${t.id}`] = { hash: P.hashText(t.text), result, ts: Date.now() };
      } catch (e) { statusText = `Stopped: ${e.message}`; break; }
      n++;
      statusText = `Graded ${n} of ${todo.length}…`;
      if (n % 5 === 0) { await storage.set({ pastScores: past }); gradeAll(); renderSheet(); }
    }
    await storage.set({ pastScores: past });
    grading = false;
    if (!statusText.startsWith('Stopped')) statusText = `Graded ${n} tweets with the Developer Trust filter.`;
    gradeAll();
    renderSheet();
  }

  // ---------- Sheet ----------

  const SHEET_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .launch { position: fixed; left: 16px; bottom: 16px; z-index: 2147483001; border: 0; cursor: pointer;
      font: 700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1419; color: #fff; border-radius: 999px; padding: 9px 14px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    .sheet { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 2147483002;
      display: flex; flex-direction: column; background: #fff; color: #0f1419; border-left: 1px solid #cfd9de;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: -6px 0 24px rgba(0,0,0,.15); }
    .sheet[hidden] { display: none; }
    @media (prefers-color-scheme: dark) {
      .sheet { background: #000; color: #e7e9ea; border-color: #2f3336; }
      .row { border-color: #2f3336 !important; }
      .launch { background: #e7e9ea; color: #0f1419; }
    }
    header { padding: 14px 16px 10px; border-bottom: 1px solid #cfd9de33; }
    h2 { margin: 0 0 6px; font-size: 17px; }
    .stats { font-size: 12px; opacity: .8; }
    .bar { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    button.b { font-weight: 600; font-size: 12px; font-family: inherit; border: 1px solid #cfd9de; background: transparent; color: inherit;
      border-radius: 999px; padding: 5px 11px; cursor: pointer; }
    button.b.on { background: #1d9bf0; border-color: #1d9bf0; color: #fff; }
    button.del { border-color: #c0262d; color: #c0262d; }
    .status { margin-top: 6px; font-size: 12px; opacity: .8; min-height: 1em; }
    .list { overflow-y: auto; flex: 1; }
    .row { padding: 10px 16px; border-bottom: 1px solid #eff3f4; }
    .meta { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .sc { font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; }
    .bucket { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; color: #fff; }
    .kill { background: #c0262d; } .below { background: #b45309; } .middle { background: #6b7280; } .sweet { background: #15803d; }
    .rec { color: #c0262d; font-weight: 700; }
    .date { margin-left: auto; opacity: .6; }
    .text { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .why { font-size: 12px; opacity: .75; } .link { font-size: 12px; color: #2F45C4; text-decoration: none; word-break: break-all; }
    .acts { display: flex; gap: 6px; margin-top: 6px; }
    .empty { padding: 24px 16px; opacity: .7; }
    .x { position: absolute; top: 10px; right: 12px; }
  `;

  const host = document.createElement('div');
  host.setAttribute('data-supertweet', 'sheet');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${SHEET_CSS}</style><button class="launch" type="button">Supertweet history</button><div class="sheet" hidden></div>`;
  document.documentElement.appendChild(host);
  const sheet = root.querySelector('.sheet');
  root.querySelector('.launch').addEventListener('click', () => (sheet.hidden ? openSheet() : closeSheet()));

  async function openSheet() {
    if (!scanning) { await load(); past = (await storage.get({ pastScores: {} })).pastScores || {}; gradeAll(); }
    sheet.hidden = false;
    renderSheet();
  }
  function closeSheet() { sheet.hidden = true; }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, cls, onClick) {
    const b = el('button', `b ${cls || ''}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderSheet() {
    if (sheet.hidden) return;
    const live = Object.values(scan).filter((t) => !t.deleted && t.bucket);
    const recs = live.filter(recommended);
    const counts = {};
    live.forEach((t) => { counts[t.bucket] = (counts[t.bucket] || 0) + 1; });
    const graded = live.filter((t) => typeof t.score === 'number');
    const avg = graded.length ? graded.reduce((x, t) => x + t.score, 0) / graded.length : null;

    sheet.textContent = '';
    const head = el('header');
    head.append(el('h2', null, 'Your tweets, worst first (Developer Trust)'));
    head.append(btn('Close', 'x', closeSheet));
    head.append(el('div', 'stats', live.length
      ? `${live.length} tweets · ${graded.length} graded${avg != null ? ` · avg ${avg.toFixed(1)}` : ''} · kill ${counts.kill || 0} · low ${counts.low || 0} · middle ${counts.middle || 0} · sweet ${counts.sweet || 0} · privacy ${counts.privacy || 0}`
      : 'Nothing cached yet. Scan reads your Posts & replies tab.'));
    const bar = el('div', 'bar');
    bar.append(scanning ? btn('Stop scan', '', () => { scanning = false; }) : btn(live.length ? 'Rescan' : 'Scan my history', 'on', startScan));
    if (counts.ungraded) bar.append(grading ? btn('Stop grading', '', () => { grading = false; }) : btn(`Grade ${counts.ungraded} with Claude`, '', gradeWithClaude));
    bar.append(btn(`Recommended deletes (${recs.length})`, filter === 'recommended' ? 'on' : '', () => { filter = 'recommended'; renderSheet(); }));
    bar.append(btn(`All (${live.length})`, filter === 'all' ? 'on' : '', () => { filter = 'all'; renderSheet(); }));
    head.append(bar, el('div', 'status', statusText));
    sheet.append(head);

    const list = el('div', 'list');
    // Worst first: by trust score (kills are 0), then by severity, then newest.
    const rows = (filter === 'recommended' ? recs : live).slice().sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || SEVERITY[a.bucket] - SEVERITY[b.bucket] || (b.date || '').localeCompare(a.date || ''));
    if (!rows.length) list.append(el('div', 'empty', filter === 'recommended' && live.length ? 'No deletes recommended.' : 'No tweets to show.'));
    for (const t of rows.slice(0, 400)) {
      const row = el('div', 'row');
      const meta = el('div', 'meta');
      const cls = { kill: 'kill', privacy: 'kill', low: 'below', middle: 'middle', sweet: 'sweet', ungraded: 'middle' }[t.bucket];
      const label = { kill: 'Kill', privacy: 'Privacy', low: 'Low', middle: 'Middle', sweet: 'Sweet', ungraded: 'Ungraded' }[t.bucket];
      meta.append(el('span', 'sc', t.score == null ? '–' : `${t.score.toFixed(1)}/10`), el('span', `bucket ${cls}`, label));
      if (recommended(t)) meta.append(el('span', 'rec', 'Delete recommended'));
      meta.append(el('span', 'date', t.date ? new Date(t.date).toLocaleDateString() : ''));
      const link = document.createElement('a');
      link.href = t.url; link.target = '_blank'; link.rel = 'noopener'; link.className = 'link'; link.textContent = t.url.replace(/^https?:\/\/(www\.)?/, '');
      row.append(meta, el('div', 'text', t.text), el('div', 'why', t.reason), link);
      const acts = el('div', 'acts');
      // This post only: opens it, where Supertweet asks again before anything is deleted.
      acts.append(btn('Delete…', 'del', () => location.assign(`${t.url}?${PARAM}=delete`)));
      if (recommended(t)) acts.append(btn('Keep', '', async () => { t.kept = true; await save(); renderSheet(); }));
      row.append(acts);
      list.append(row);
    }
    if (rows.length > 400) list.append(el('div', 'empty', `Showing the first 400 of ${rows.length}.`));
    sheet.append(list);
  }

  // ---------- Delete (one tweet, on its own page, after a second confirm) ----------

  async function confirmDelete() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (!m) return;
    const id = m[2];
    const article = await waitFor(() => [...document.querySelectorAll('article[data-testid="tweet"]')].find((a) => {
      const l = statusLink(a);
      return l && l.id === id;
    }), 15000);
    history.replaceState(null, '', location.pathname);
    if (!article) return;
    if (!myHandles().has(P.authorOf(article))) return; // never offer to delete someone else's tweet

    const bar = document.createElement('div');
    const br = bar.attachShadow({ mode: 'open' });
    br.innerHTML = `<style>
      .c { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483003; max-width: min(560px, calc(100vw - 32px));
        background: #0f1419; color: #fff; border-radius: 14px; padding: 12px 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
      .q { flex: 1 1 240px; } b { font-weight: 700; }
      button { font-weight: 600; font-size: 13px; font-family: inherit; border-radius: 999px; padding: 6px 14px; cursor: pointer; border: 1px solid #536471; background: transparent; color: #fff; }
      .go { background: #c0262d; border-color: #c0262d; }
    </style><div class="c"><span class="q"><b>Supertweet:</b> delete this post? This can't be undone.</span>
      <button class="go" type="button">Delete post</button><button class="no" type="button">Cancel</button></div>`;
    document.documentElement.appendChild(bar);
    const q = br.querySelector('.q');
    br.querySelector('.no').addEventListener('click', () => bar.remove());
    br.querySelector('.go').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await deleteViaX(article);
        await load();
        const t = scan[id];
        if (t) { t.deleted = true; await save(); }
        // Every deletion is logged.
        const { deletionLog = [] } = await storage.get({ deletionLog: [] });
        await storage.set({ deletionLog: deletionLog.concat({ id, url: location.href.split('?')[0], at: new Date().toISOString(), score: t ? t.score ?? null : null, bucket: t ? t.bucket : null, text: t ? t.text : null }).slice(-1000) });
        q.textContent = 'Deleted. Returning to your history…';
        await sleep(800);
        location.assign(`/${P.loggedInHandle() || m[1]}/with_replies?${PARAM}=sheet`);
      } catch (err) {
        q.textContent = `Could not delete: ${err.message}`;
      }
    });
  }

  // Uses X's own menu: caret → Delete → confirm.
  async function deleteViaX(article) {
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) throw new Error('post menu not found');
    caret.click();
    const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /^\s*delete\s*$/i.test(m.innerText)), 4000);
    if (!item) throw new Error('no Delete in the menu (is this your post?)');
    item.click();
    const ok = await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'), 4000);
    if (!ok) throw new Error('X did not show its confirm dialog');
    ok.click();
    if (!(await waitFor(() => !article.isConnected, 6000))) throw new Error('X did not remove the post');
  }

  // ---------- Entry points from URL ----------

  const mode = params.get(PARAM);
  if (mode) {
    (async () => {
      if (mode === 'scan') {
        history.replaceState(null, '', location.pathname);
        await load();
        await waitFor(() => document.querySelector('article[data-testid="tweet"]'), 15000);
        runScan();
      } else if (mode === 'sheet') {
        history.replaceState(null, '', location.pathname);
        openSheet();
      } else if (mode === 'delete') {
        confirmDelete();
      }
    })();
  }
})();
