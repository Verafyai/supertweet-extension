// The expandable Details under a Developer Trust score (past-post badges and the panel): what works,
// what costs points, the pushback, how to get to 8 (with a fact-checked rewrite), the four
// sub-ratings, and reach versus trust. Pure functions: HTML strings (escaped) and numbers.
(function (root) {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const compact = (n) => (n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K` : String(n));
  const KIND = { futurism: 'futurism', unverified: 'unverified claim', abstract: 'abstract', sloppy: 'sloppy', other: '' };

  // "1.2K views · 14 likes · 3 replies · 1 repost" (whatever the page shows)
  function reachLine(m) {
    if (!m) return '';
    const part = (n, one, many) => (typeof n === 'number' ? `${compact(n)} ${n === 1 ? one : many}` : null);
    return [part(m.views, 'view', 'views'), part(m.likes, 'like', 'likes'), part(m.replies, 'reply', 'replies'), part(m.reposts, 'repost', 'reposts')].filter(Boolean).join(' · ');
  }
  // Reach: views when the page shows them, else likes + replies + reposts.
  const reachOf = (m) => (!m ? null : typeof m.views === 'number' ? m.views : ['likes', 'replies', 'reposts'].some((k) => typeof m[k] === 'number') ? (m.likes || 0) + (m.replies || 0) + (m.reposts || 0) : null);
  const unit = (m) => (m && typeof m.views === 'number' ? 'views' : 'engagements');

  // posts: [{ id, score, bucket, metrics, date }] -> { id: "one line" } for each lower-trust post that
  // outperformed a Sweet one (the best-reaching Sweet post it still beat).
  function reachVsTrust(posts) {
    const out = {};
    const sweet = posts.filter((p) => typeof p.score === 'number' && p.score >= 8 && reachOf(p.metrics) != null);
    for (const p of posts) {
      if (typeof p.score !== 'number' || p.score >= 8) continue;
      const r = reachOf(p.metrics);
      if (r == null) continue;
      const beaten = sweet.filter((q) => unit(q.metrics) === unit(p.metrics) && reachOf(q.metrics) < r).sort((a, b) => reachOf(b.metrics) - reachOf(a.metrics))[0];
      if (!beaten) continue;
      const when = beaten.date ? ` from ${new Date(beaten.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
      out[p.id] = `Reach beat trust here: this ${p.score.toFixed(1)} post got ${compact(r)} ${unit(p.metrics)}, more than your ${beaten.score.toFixed(1)} post${when} (${compact(reachOf(beaten.metrics))}).`;
    }
    return out;
  }

  // The Details section. c: the critique; opts: { score, bucket, metrics, reachNote, canUse }
  function renderCritique(c, opts = {}) {
    if (!c) return '';
    const q = (s) => `<q>${esc(s)}</q>`;
    const b = c.breakdown || {};
    const parts = [];
    if (opts.metrics || typeof opts.score === 'number') {
      const reach = reachLine(opts.metrics);
      parts.push(`<p class="cr-reach">${typeof opts.score === 'number' ? `<b>Trust ${opts.score.toFixed(1)}</b>` : ''}${reach ? ` · ${esc(reach)}` : ''}</p>${opts.reachNote ? `<p class="cr-note">${esc(opts.reachNote)}</p>` : ''}`);
    }
    if (c.works && c.works.length) parts.push(`<div class="cr-sec" data-cr="works"><b>What works</b><ul>${c.works.map((w) => `<li>${q(w.quote)} ${esc(w.point)}</li>`).join('')}</ul></div>`);
    if (c.costs && c.costs.length) parts.push(`<div class="cr-sec" data-cr="costs"><b>What costs points</b><ul>${c.costs.map((x) => `<li>${q(x.quote)} ${KIND[x.kind] ? `<i>${esc(KIND[x.kind])}:</i> ` : ''}${esc(x.why)}</li>`).join('')}</ul></div>`);
    if (c.pushback) parts.push(`<div class="cr-sec" data-cr="pushback"><b>Pushback</b><blockquote>${esc(c.pushback)}</blockquote></div>`);
    if (c.direction || c.rewrite || (c.needs && c.needs.length)) {
      parts.push(`<div class="cr-sec" data-cr="to8"><b>How to get to 8</b>${c.direction ? `<p>${esc(c.direction)}</p>` : ''}${c.rewrite ? `<pre class="cr-rewrite">${esc(c.rewrite)}</pre>${opts.canUse ? '<button class="cr-use" type="button" data-act="use-rewrite">Use this rewrite</button>' : ''}` : ''}${(c.needs || []).map((n) => `<p class="cr-needs">${esc(n)}</p>`).join('')}</div>`);
    }
    parts.push(`<p class="cr-bd" data-cr="breakdown">Shows building ${b.shows_building ?? '–'} · Specific ${b.specific ?? '–'} · Useful to a developer ${b.useful ?? '–'} · Voice ${b.voice ?? '–'}</p>`);
    return `<div class="cr">${parts.join('')}</div>`;
  }

  const CSS = `
.cr{display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.45}
.cr b{font-weight:700}
.cr ul{margin:4px 0 0;padding-left:18px}
.cr li{margin:2px 0}
.cr q{font-style:italic}
.cr q::before{content:"“"} .cr q::after{content:"”"}
.cr blockquote{margin:4px 0 0;padding-left:10px;border-left:3px solid currentColor;opacity:.9}
.cr p{margin:4px 0 0}
.cr-rewrite{white-space:pre-wrap;font:inherit;margin:6px 0 0;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.12)}
.cr-needs{opacity:.85}
.cr-bd{opacity:.85}
.cr-note{font-weight:600}
.cr-use{font:inherit;font-size:13px;font-weight:600;margin-top:6px;padding:6px 12px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit;cursor:pointer}
`;

  const api = { renderCritique, reachVsTrust, reachLine, reachOf, compact, CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetCritique = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
