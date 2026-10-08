// Past posts, both platforms: grade each of your published posts once with the Developer Trust
// filter (cached by post id; re-graded only if the text changes), badge it inline (score, bucket,
// one line on why), and flag privacy hits on-device. Under the badge, "Details" expands the
// critique (src/critique.js) with the post's reach next to its trust score. X: your posts anywhere
// on screen. LinkedIn: your /in/<me>/recent-activity/ page, with a CSV export.
(() => {
  'use strict';
  const P = globalThis.SupertweetPage;
  if (!P) return;
  const A = P.adapter;
  const Aud = P.audience;
  const { hashText } = globalThis.SupertweetChecks;
  const O = globalThis.SupertweetObjectives;
  const TMI = globalThis.SupertweetTMI;
  const { h } = globalThis.SupertweetUI;
  const C = globalThis.SupertweetCritique;
  const storage = chrome.storage.local;

  let cache = {}; // id -> { hash, result, ts, error, ek }
  const queue = [];
  let busy = false;
  const badges = new WeakMap();
  let exportHost = null;
  const opened = new Set(); // post ids with Details open
  const critiques = new Map(); // text hash -> critique | { error } | 'loading'
  let reachNotes = {}; // post id -> "Reach beat trust here: …"
  const metricsOf = new Map(); // post id -> { views, likes, replies, reposts }

  storage.get({ pastScores: {} }, (r) => queueMicrotask(() => { cache = r.pastScores || {}; tick(); }));

  const CSS = `
    :host { all: initial; display: block; }
    .t { margin: 6px 0 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #56687a; }
    .s { font-weight: 800; font-size: 13px; color: #141B26; font-variant-numeric: tabular-nums; }
    .o { font-weight: 700; color: #2F45C4; } .off { color: #b45309; font-weight: 700; }
    .tmi { color: #c0262d; flex-basis: 100%; } .ovr { color: #92400e; flex-basis: 100%; }
    .more { margin: -4px 0 8px; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #56687a; }
    .more > button { font: inherit; font-weight: 700; color: #2F45C4; background: none; border: 0; padding: 0; cursor: pointer; }
    .more .cr { margin-top: 8px; color: #141B26; }
    @media (prefers-color-scheme: dark) { .more .cr { color: #EEF1F5; } .more > button { color: #8B9BF2; } }
    @media (prefers-color-scheme: dark) { .s { color: #EEF1F5; } .t { color: #8b98a5; } .o { color: #8B9BF2; } }
  `;

  // A cached grade counts if it's for this exact text and from the Developer Trust filter (grades
  // from before it have no bucket and are re-graded).
  const fresh = (c, hash) => Boolean(c && c.hash === hash && (c.error || (c.result && c.result.bucket)));

  function badge(post, info, text) {
    let host = badges.get(post);
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-supertweet', 'past-badge');
      host.attachShadow({ mode: 'open' });
      badges.set(post, host);
    }
    if (!A.mountBadge(post, host)) return;
    const kids = [];
    if (!info) kids.push(h('span', null, 'Supertweet: scoring…'));
    else if (info.error) kids.push(h('span', null, `Supertweet: couldn't grade (${info.error})`));
    else {
      const r = info.result;
      // Developer Trust: score, bucket, one-line why.
      kids.push(h('span', { class: 's' }, `${Number(r.score).toFixed(1)}/10`), h('span', { class: r.bucket === 'kill' || r.bucket === 'low' ? 'off' : 'o' }, (O.BUCKET_NAMES && O.BUCKET_NAMES[r.bucket]) || r.bucket || ''), h('span', null, r.kill ? `Kill: ${r.kill.category}` : r.why || ''));
    }
    // Privacy hits on what's already public, on-device.
    const hits = TMI.detect(text, (Aud.config && Aud.config.privateTerms) || []);
    if (hits.length) kids.push(h('span', { class: 'tmi' }, `Privacy: ${[...new Set(hits.map((x) => x.id))].join(', ')}. Consider deleting.`));
    const ovr = info && Aud.overrideFor(info.hash);
    if (ovr) kids.push(h('span', { class: 'ovr' }, `Sent with override: ${ovr.reason}`));
    // The collapsed line above is unchanged; Details sits under it.
    const more = info && info.result ? details(post, info, text) : '';
    host.shadowRoot.replaceChildren(Object.assign(document.createElement('style'), { textContent: CSS + (C ? C.CSS : '') }), h('div', { class: 't', title: 'Supertweet grade' }, ...kids), more);
  }

  // "Details ▸": the critique, with reach next to the trust score. Fetched once per text, on open.
  function details(post, info, text) {
    const id = A.readPost(post).id;
    const key = hashText(text);
    const isOpen = opened.has(id);
    const box = h('div', { class: 'more', 'data-supertweet': 'details' }, h('button', { type: 'button', 'data-act': 'details', onclick: () => {
      if (opened.has(id)) opened.delete(id); else { opened.add(id); loadCritique(key, text); }
      badge(post, info, text);
    } }, isOpen ? 'Details ▾' : 'Details ▸'));
    if (!isOpen) return box;
    const c = critiques.get(key);
    const div = document.createElement('div');
    if (!c || c === 'loading') div.textContent = 'Reading this post…';
    else if (c.error) div.textContent = `Couldn't load the critique (${c.error}).`;
    else div.innerHTML = C.renderCritique(c, { score: info.result.score, bucket: info.result.bucket, metrics: metricsOf.get(id), reachNote: reachNotes[id] });
    box.append(div);
    return box;
  }
  async function loadCritique(key, text) {
    if (critiques.has(key) && critiques.get(key) !== 'loading' && !critiques.get(key).error) return;
    critiques.set(key, 'loading');
    try { critiques.set(key, await Aud.critique(text)); } catch (e) { critiques.set(key, { error: e.message }); }
    tick();
  }

  async function drain() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const q = queue.shift();
      if (fresh(cache[q.id], q.hash)) continue;
      try {
        // Badges need no rewrites. draft_id + source "past" saves the row for the dashboard.
        const result = await Aud.grade({ ...Aud.payloadFor(q.text, null), mode: 'score', draft_id: q.id, source: 'past', post_id: q.postId, post_url: q.url, posted_at: q.date, engagement: q.engagement });
        cache[q.id] = { hash: q.hash, result, ts: Date.now() };
      } catch (e) {
        cache[q.id] = { hash: q.hash, error: e.message, ts: Date.now() };
      }
      await storage.set({ pastScores: trim(cache) });
      tick();
    }
    busy = false;
  }
  const trim = (c) => Object.fromEntries(Object.entries(c).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, 2000));

  function ownPosts() {
    if (A.id === 'linkedin') return A.isOwnActivityPage(Aud.settings().linkedinMe) ? A.findOwnPosts(Aud.settings().linkedinMe) : [];
    return A.findOwnPosts();
  }

  function tick() {
    exportButton(A.id === 'linkedin' && A.isOwnActivityPage(Aud.settings().linkedinMe));
    if (!Aud.active()) return;
    const seen = [];
    for (const post of ownPosts()) {
      const r = A.readPost(post);
      if (!r.id || !r.text) continue;
      const id = A.id === 'x' ? `x:${r.id}` : r.id;
      const hash = hashText(r.text);
      const engagement = A.engagement ? A.engagement(post) : null;
      if (engagement && Object.values(engagement).some((v) => v != null)) metricsOf.set(r.id, engagement);
      const hit = fresh(cache[id], hash) ? cache[id] : null;
      if (!hit && !queue.some((x) => x.id === id)) queue.push({ id, text: r.text, hash, postId: r.id, url: r.url && r.url.startsWith('/') ? `https://x.com${r.url}` : r.url, date: r.date, engagement });
      // Already graded: refresh engagement when the counts change (LinkedIn).
      if (hit && engagement && Object.values(engagement).some((v) => v != null)) {
        const ek = JSON.stringify(engagement);
        if (hit.ek !== ek) { hit.ek = ek; Aud.save([{ id, platform: A.id, source: 'past', engagement }]); storage.set({ pastScores: cache }); }
      }
      seen.push({ post, hit, text: r.text, id: r.id, date: r.date });
    }
    // Reach versus trust, across your posts on screen: one line where a lower-trust post outreached a Sweet one.
    reachNotes = C ? C.reachVsTrust(seen.filter((x) => x.hit && x.hit.result).map((x) => ({ id: x.id, score: x.hit.result.score, bucket: x.hit.result.bucket, metrics: metricsOf.get(x.id), date: x.date }))) : {};
    for (const x of seen) badge(x.post, x.hit, x.text);
    drain();
  }

  // ---------- LinkedIn CSV export ----------
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function buildCsv() {
    const rows = [['urn', 'url', 'score', 'bucket', 'why', 'kill', 'override_reason', 'text']];
    const texts = {};
    for (const post of ownPosts()) { const r = A.readPost(post); if (r.id) texts[r.id] = r.text; }
    const per = {};
    for (const [urn, c] of Object.entries(cache)) {
      if (!c.result || urn.startsWith('x:')) continue;
      const r = c.result;
      const ovr = Aud.overrideFor(c.hash);
      rows.push([urn, `https://www.linkedin.com/feed/update/${urn}/`, r.score, r.bucket || '', r.why || '', r.kill ? r.kill.category : '', ovr ? ovr.reason : '', texts[urn] || '']);
      const k = r.bucket || 'ungraded';
      const p = (per[k] = per[k] || { count: 0, scores: [] });
      p.count++; p.scores.push(r.score);
    }
    const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '');
    rows.push([], ['bucket', 'posts', 'avg_score']);
    for (const [k, p] of Object.entries(per).sort((a, b) => b[1].count - a[1].count)) rows.push([k, p.count, avg(p.scores)]);
    return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  function exportButton(show) {
    if (!show) { if (exportHost) { exportHost.remove(); exportHost = null; } return; }
    if (exportHost && exportHost.isConnected) return;
    exportHost = document.createElement('div');
    exportHost.setAttribute('data-supertweet', 'li-export');
    const root = exportHost.attachShadow({ mode: 'open' });
    root.append(h('button', {
      type: 'button',
      style: 'position:fixed;left:16px;bottom:16px;z-index:2147483001;border:0;cursor:pointer;font:700 13px -apple-system,BlinkMacSystemFont,sans-serif;background:#0a66c2;color:#fff;border-radius:999px;padding:9px 14px;box-shadow:0 4px 14px rgba(0,0,0,.25)',
      onclick: () => {
        const url = URL.createObjectURL(new Blob([buildCsv()], { type: 'text/csv' }));
        const a = h('a', { href: url, download: `supertweet-linkedin-scores-${new Date().toISOString().slice(0, 10)}.csv` });
        root.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    }, 'Export scores (CSV)'));
    document.documentElement.appendChild(exportHost);
  }

  let pendingTick = false;
  new MutationObserver(() => {
    if (pendingTick) return;
    pendingTick = true;
    setTimeout(() => { pendingTick = false; tick(); }, 600);
  }).observe(document.documentElement, { childList: true, subtree: true });
  Aud.ready.then(tick);
  globalThis.SupertweetPastPosts = { buildCsv, tick };
  globalThis.SupertweetLinkedInActivity = globalThis.SupertweetPastPosts;
})();
