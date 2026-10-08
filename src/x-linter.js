// X algorithm linter: the rule engine from docs/spec/x-linter.html as pure functions, driven by
// config/x-algorithm-rules.json. Runs on every keystroke (no model call): rule results, the live
// 0-10 algorithm fit, wants / doesn't-want lists, the deterministic "algorithm filter" cleanup, and
// guards that keep model rewrites from inventing facts.
(function (root) {
  'use strict';

  const BAIT = /\b(follow (?:me )?for (?:more|updates|part \d+)[!.]*|follow for|rt if|like if|retweet if|giveaway|comment ["']?\w+["']? (and|&) i'?ll|drop a|ratio|you won'?t believe|nobody is talking about|here'?s what most people get wrong|steal this|bookmark this)\b/i;
  const HYPE = /\b(game[- ]?changer|mind[- ]?blowing|insane|10x|unlock(ed)?|revolutioni[sz]e|crushing it)\b|🧵|👇|🚀|🔥/i;
  const TOPIC = /\b(agents?|agentic|ai|llms?|models?|claude|gpt|mcp|evals?|evaluation|devrel|developers?|docs|documentation|sdk|api|onboarding|observability|trac(e|es|ing)|prompt|fine-?tun\w*|inference|gpu|open[- ]source|repo|lean|harness|linter|extension|plugin|tool(ing|s)?|app|workflow|automation|grader|scor(e|es|ing)|ranking|algorithm|chrome|browser|built|building|shipped|shipping)\b/i;
  const FIRST = /\b(i|we) (built|ran|tested|shipped|measured|launched|tried|found|wrote|open-?sourced)\b|\bpart \d|\b(series|episode)\b/i;
  const URL_RE = /https?:\/\/\S+/gi;
  const CAPS_OK = /^(DEVREL|HTTP|JSON|HTML|LLMS?|GPUS?)$/;
  const PLACEHOLDER = /\[[A-Z][A-Z0-9 '\/-]{2,}\]/g;

  const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9']+/g) || [];

  // Timing you can act on: "Your last post was 40 minutes ago. Posting after 3:10 PM avoids the
  // author diversity penalty." plus the time to queue it for.
  const SPACING_MIN = 180;
  const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function spacingFix(since, now) {
    if (since == null || since >= SPACING_MIN) return {};
    const t = new Date((now ?? Date.now()) + (SPACING_MIN - since) * 60000);
    t.setSeconds(0, 0);
    const ago = since < 60 ? `${since} minute${since === 1 ? '' : 's'}` : `${Math.floor(since / 60)} h ${since % 60} min`;
    return { fix: `Your last post was ${ago} ago. Posting after ${clock(t)} avoids the author diversity penalty.`, queueAt: t.getTime(), queueLabel: `Queue for ${clock(t)}` };
  }
  function jacc(a, b) {
    const A = new Set(words(a)), B = new Set(words(b));
    if (!A.size || !B.size) return 0;
    let i = 0;
    A.forEach((w) => { if (B.has(w)) i++; });
    return i / (A.size + B.size - i);
  }
  const xlen = (s) => [...String(s || '').replace(URL_RE, 'x'.repeat(23))].length;

  // ctx: { media: 'none'|'image'|'video', videoSeconds, minutesSinceLastPost, followers, recent: [texts], isReply }
  function lint(text, ctx = {}, rules = {}) {
    const t = String(text || '').trim();
    const W = rules.action_weights || {};
    const media = ctx.media || 'none';
    const recent = (ctx.recent || []).filter(Boolean).slice(0, 20);
    const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    const first = sentences[0] || '', last = sentences[sentences.length - 1] || '';
    const links = t.match(URL_RE) || [], textNoLinks = t.replace(URL_RE, '').trim();
    const tags = (t.match(/(^|\s)#\w+/g) || []).length, mentions = (t.match(/(^|\s)@\w+/g) || []).length;
    const emoji = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
    const caps = (t.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !CAPS_OK.test(w)).length;
    const hasNum = /\d/.test(textNoLinks), hasList = /^\s*(\d+[.)]|[-•])\s/m.test(t), hasRepo = /github\.com|huggingface\.co/i.test(t);
    const util = /\b(test|checklist|template|how to|steps?|benchmark|results?|numbers?)\b/i.test(t);
    const shareSignals = [hasNum, hasList, hasRepo, util].filter(Boolean).length;
    const maxSim = recent.reduce((m, r) => Math.max(m, jacc(t, r)), 0);
    const since = typeof ctx.minutesSinceLastPost === 'number' ? ctx.minutesSinceLastPost : null;
    const w = (...k) => k.map((x) => ({ name: x, value: W[x] }));

    const R = [
      { id: 'shareable', g: 'hit', t: 'Worth sending to someone', w: w('ShareViaCopyLinkWeight', 'ShareViaDmWeight', 'ShareWeight'),
        s: !t ? 'warn' : shareSignals >= 2 ? 'pass' : shareSignals === 1 ? 'warn' : 'fail',
        why: `Copy-link shares carry the biggest positive weight (${W.ShareViaCopyLinkWeight}). DM shares ${W.ShareViaDmWeight}.`, fix: 'Add the concrete artifact: a number, steps, a test, or the repo.' },
      { id: 'reply', g: 'hit', t: 'Invites replies', w: w('ReplyWeight', 'BidirectionalFollowReplyWeightBoost'),
        s: /\?\s*$/.test(last) ? 'pass' : /\?/.test(t) ? 'warn' : 'fail',
        why: `Replies weigh ${W.ReplyWeight}, plus ${W.BidirectionalFollowReplyWeightBoost} more from mutual follows.`, fix: 'End on the question you actually want practitioners to answer.' },
      { id: 'quote', g: 'hit', t: 'Has a quotable claim', w: w('QuoteWeight'),
        s: first && first.length <= 120 && !/\?$/.test(first) ? 'pass' : 'warn',
        why: `Quotes weigh ${W.QuoteWeight}. A short declarative opener is easy to quote.`, fix: 'Open with one claim under 120 characters.' },
      { id: 'follow', g: 'hit', t: 'Gives a reason to follow', w: w('FollowAuthorWeight'),
        s: FIRST.test(t) ? 'pass' : 'warn',
        why: `Follows weigh ${W.FollowAuthorWeight}. First-hand work signals there is more coming.`, fix: 'Say what you built, ran or tested.' },
      { id: 'dwell', g: 'hit', t: 'Substance to read', w: w('ContDwellTimeWeight'),
        s: textNoLinks.length >= 120 || media !== 'none' ? 'pass' : 'warn',
        why: 'Dwell time is scored continuously.', fix: 'Add one concrete sentence or a screenshot.' },
      { id: 'likes', g: 'hit', t: 'Not chasing likes', w: w('FavoriteWeight', 'RetweetWeight'), s: 'info',
        why: `Likes weigh ${W.FavoriteWeight} and reposts ${W.RetweetWeight}. A reply is worth ${W.FavoriteWeight ? Math.round(W.ReplyWeight / W.FavoriteWeight) : 10} likes.` },

      { id: 'report', g: 'avoid', t: 'No bait or hostility', w: w('ReportWeight'), s: BAIT.test(t) ? 'fail' : 'pass',
        why: `Reports carry the heaviest weight in the file (${W.ReportWeight}).`, fix: `Cut the bait phrase: ${(t.match(BAIT) || [''])[0]}`, evidence: (t.match(BAIT) || [''])[0] },
      { id: 'mute', g: 'avoid', t: 'No clutter', w: w('MuteAuthorWeight', 'BlockAuthorWeight'),
        s: tags > 2 || mentions > 3 || emoji > 4 || caps > 3 ? 'fail' : tags > 1 || emoji > 2 ? 'warn' : 'pass',
        why: `Mutes ${W.MuteAuthorWeight}, blocks ${W.BlockAuthorWeight}. Hashtags ${tags}, mentions ${mentions}, emoji ${emoji}, all-caps ${caps}.`, fix: 'Keep to 2 hashtags, 3 mentions, 4 emoji at most. Fewer is better.' },
      { id: 'not-interested', g: 'avoid', t: 'On-topic, no hype', w: w('NotInterestedWeight'),
        s: HYPE.test(t) ? 'fail' : TOPIC.test(t) ? 'pass' : 'warn',
        why: `"Not interested" weighs ${W.NotInterestedWeight} and is the most common negative.`, fix: HYPE.test(t) ? `Drop "${(t.match(HYPE) || [''])[0]}".` : 'Tie it to agents, AI development or DevRel.', evidence: (t.match(HYPE) || [''])[0] },
      { id: 'link-only', g: 'avoid', t: 'Not just a link', w: w('OpenLinkWeight'),
        s: links.length && textNoLinks.length < 80 ? 'warn' : 'pass',
        why: `Link opens weigh ${W.OpenLinkWeight}. The post itself has to earn replies and shares.`, fix: 'Put the finding in the post; the link is the receipt.' },

      { id: 'spacing', g: 'distribution', t: 'Spaced from your last post', p: `Author diversity decay ${(rules.distribution_params || {}).AuthorDiversityDecay ?? 0.5}`,
        s: since == null ? 'info' : since < 60 ? 'fail' : since < SPACING_MIN ? 'warn' : 'pass',
        why: since == null ? 'Visit your profile once so Supertweet can see when you last posted.' : `Each extra post from you in one viewer's feed is multiplied by ${(rules.distribution_params || {}).AuthorDiversityDecay ?? 0.5}.`,
        ...spacingFix(since, ctx.now) },
      { id: 'similarity', g: 'distribution', t: 'Not a repeat', p: 'DPP rerank θ 0.65',
        s: !recent.length ? 'info' : maxSim > 0.5 ? 'fail' : maxSim > 0.3 ? 'warn' : 'pass',
        why: recent.length ? `Closest recent post overlaps ${Math.round(maxSim * 100)}%. Similar posts get spaced apart.` : 'No recent posts seen yet for the repeat check.', fix: 'Find a new angle.' },
      { id: 'original', g: 'distribution', t: 'Posted as an original', p: 'Out-of-network ×0.75',
        s: ctx.isReply || /^@\w+/.test(t) ? 'warn' : 'pass',
        why: 'Replies and reposts are discounted like out-of-network posts.', fix: 'If it stands alone, post it as an original.' },
      { id: 'video', g: 'distribution', t: 'Video counts as a view', p: 'Min 10s',
        s: media !== 'video' ? 'info' : (ctx.videoSeconds || 0) >= 10 ? 'pass' : 'fail',
        why: media === 'video' ? `Clip is ${Math.round(ctx.videoSeconds || 0)}s.` : 'Only applies to video.', fix: 'Make the clip 10 seconds or longer.' },
      { id: 'cold-start', g: 'distribution', t: 'New-author boost', p: '<1,000 followers', s: 'info',
        why: typeof ctx.followers !== 'number' ? 'Follower count not seen yet.' : ctx.followers < 1000 ? 'You qualify: posts under 24h old with under 1,000 impressions get lifted.' : 'Not eligible above 1,000 followers.' },
      { id: 'lifetime', g: 'distribution', t: '48-hour shelf life', p: 'Age filter 48h', s: 'info', why: 'Posts older than 48 hours drop out of For You.' },
    ];
    return R;
  }

  // Hit weights: square root of the summed param.rs weights per rule, so copy-link (20) can't drown
  // everything else. Recomputed from action_weights, so a synced weight change flows through.
  function fitWeights(rules) {
    const af = rules.algorithm_fit || {};
    const base = af.hit_weights_sqrt_scaled || {};
    const W = rules.action_weights || {};
    const ruleWeights = Object.fromEntries((rules.rules || []).map((r) => [r.id, r.weights || []]));
    const out = {};
    for (const id of Object.keys(base)) {
      const ks = ruleWeights[id] || [];
      const sum = ks.reduce((s, k) => s + (Number(W[k]) || 0), 0);
      // dwell's raw weight is tiny (0.004); the spec pins it at 1.
      out[id] = id === 'dwell' || !sum ? base[id] : Math.sqrt(sum);
    }
    return { hit: out, penalties: af.penalties || {} };
  }

  function fit(R, text, rules) {
    if (!String(text || '').trim()) return 0;
    const { hit, penalties } = fitWeights(rules);
    let num = 0, den = 0;
    for (const r of R) {
      if (hit[r.id] === undefined) continue;
      den += hit[r.id];
      num += hit[r.id] * (r.s === 'pass' ? 1 : r.s === 'warn' ? 0.5 : 0);
    }
    let f = den ? (10 * num) / den : 0;
    for (const r of R) {
      const p = penalties[r.id];
      if (!p) continue;
      if (r.s === 'fail') f -= p[0];
      else if (r.s === 'warn') f -= p[1];
    }
    if (R.some((r) => r.id === 'report' && r.s === 'fail')) f = Math.min(f, 1);
    return Math.max(0, Math.min(10, Math.round(f * 10) / 10));
  }

  const band = (f) => (f > 8 ? 'pass' : f >= 5 ? 'warn' : 'fail');

  // What this draft gives the ranker, and what it's missing or risking.
  function wantsLists(R) {
    const fmt = (r) => (r.w || []).filter((x) => x.value != null).map((x) => `${x.name.replace('Weight', '').replace(/([a-z])([A-Z])/g, '$1 $2')} ${x.value > 0 ? '+' : ''}${x.value}`).join(', ');
    return {
      gives: R.filter((r) => r.g === 'hit' && r.s === 'pass').map((r) => ({ id: r.id, text: r.t, weights: fmt(r) })),
      missing: R.filter((r) => r.s === 'fail' || r.s === 'warn').map((r) => ({ id: r.id, text: r.g === 'hit' ? `Missing: ${r.t.toLowerCase()}` : `Risk: ${r.t.toLowerCase()}`, fix: r.fix, weights: fmt(r) || r.p || '', severity: r.s })),
    };
  }

  // Deterministic cleanup: bait, hype, extra hashtags and emoji, shouty caps.
  function cleanup(text, rules = {}) {
    const W = rules.action_weights || {};
    const changes = [];
    let out = String(text || '');
    const bait = new RegExp(BAIT.source, 'gi');
    const b = out.match(bait);
    if (b) { out = out.replace(bait, ''); changes.push({ rule: 'report', what: `Removed engagement bait ("${b[0]}"). Reports weigh ${W.ReportWeight}.` }); }
    const hype = new RegExp(HYPE.source, 'giu');
    const hh = out.match(hype);
    if (hh) { out = out.replace(hype, ''); changes.push({ rule: 'not-interested', what: `Removed hype (${[...new Set(hh)].join(', ')}). "Not interested" weighs ${W.NotInterestedWeight}.` }); }
    const tags = out.match(/(^|[ \t])#\w+/gm) || [];
    if (tags.length > 1) { let seen = 0; out = out.replace(/(^|[ \t])#\w+/gm, (m) => (seen++ ? '' : m)); changes.push({ rule: 'mute', what: `Kept 1 hashtag, removed ${tags.length - 1}. Clutter invites mutes (${W.MuteAuthorWeight}).` }); }
    let e = 0;
    const em = (out.match(/\p{Extended_Pictographic}/gu) || []).length;
    if (em > 2) { out = out.replace(/\p{Extended_Pictographic}️?/gu, (m) => (++e > 2 ? '' : m)); changes.push({ rule: 'mute', what: 'Trimmed emoji to 2.' }); }
    const caps = (out.match(/\b[A-Z]{4,}\b/g) || []).filter((x) => !CAPS_OK.test(x));
    if (caps.length > 3) { out = out.replace(/\b[A-Z]{4,}\b/g, (x) => (CAPS_OK.test(x) ? x : x[0] + x.slice(1).toLowerCase())); changes.push({ rule: 'mute', what: 'Lowercased shouty all-caps words.' }); }
    // Tidy each line; keep every line break. A line the cleanup emptied is dropped; blank lines stay.
    const before = String(text || '').split('\n');
    out = out.split('\n').map((l, i) => { let t = l.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trimEnd(); if (!/^\s*[!.,;:]/.test(before[i] || '')) t = t.replace(/^\s*[!.,;:]+\s*/, ''); return /^\s/.test(before[i] || '') ? t : t.trimStart(); })
      .filter((l, i) => l.trim() || !String(before[i] || '').trim()).join('\n').replace(/^\n+|\n+$/g, '');
    return { out, changes };
  }

  // ---------- Guards for model rewrites: never invent facts ----------
  // A number with its unit; longest units first so "340ms" isn't read as "340m".
  const NUM = /\d+(?:[.,]\d+)*(?:\s?(?:min|ms|%|x|k|m|s|h)\b|%)?/gi;
  const numbersIn = (s) => (String(s || '').replace(URL_RE, ' ').match(NUM) || []).map((n) => n.replace(/\s/g, '').toLowerCase());
  const tokensOf = (s, re) => new Set((String(s || '').match(re) || []).map((x) => x.toLowerCase()));

  // Replaces numbers, links, @handles, hashtags and emoji that weren't in the original with
  // placeholders (or drops them), and reports what it did.
  function guardRewrite(original, rewrite) {
    let out = String(rewrite || '');
    const added = [];
    const origNums = new Set(numbersIn(original));
    out = out.replace(NUM, (m, off, whole) => {
      // Leave digits inside placeholders and URLs alone.
      const before = whole.slice(0, off);
      if (/\[[^\]]*$/.test(before) || /https?:\/\/\S*$/.test(before)) return m;
      if (origNums.has(m.replace(/\s/g, '').toLowerCase())) return m;
      added.push(m);
      return '[YOUR NUMBER]';
    });
    const origLinks = tokensOf(original, URL_RE);
    out = out.replace(URL_RE, (u) => (origLinks.has(u.toLowerCase()) ? u : (added.push(u), '[LINK]')));
    const origHandles = tokensOf(original, /@\w+/g);
    out = out.replace(/@\w+/g, (h) => (origHandles.has(h.toLowerCase()) ? h : (added.push(h), '')));
    const origTags = tokensOf(original, /#\w+/g);
    out = out.replace(/(^|\s)#\w+/g, (m) => (origTags.has(m.trim().toLowerCase()) ? m : (added.push(m.trim()), '')));
    const origEmoji = tokensOf(original, /\p{Extended_Pictographic}/gu);
    out = out.replace(/\p{Extended_Pictographic}️?/gu, (m) => (origEmoji.has(m.replace('️', '')) ? m : (added.push(m), '')));
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
    return { out, added };
  }

  const placeholders = (s) => [...new Set(String(s || '').match(PLACEHOLDER) || [])];

  // Word-level diff for the before/after view: [{ text, op: 'same'|'del'|'add' }].
  function wordDiff(a, b) {
    const A = String(a || '').split(/(\s+)/), B = String(b || '').split(/(\s+)/);
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ text: A[i], op: 'same' }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ text: A[i++], op: 'del' });
      else out.push({ text: B[j++], op: 'add' });
    }
    while (i < n) out.push({ text: A[i++], op: 'del' });
    while (j < m) out.push({ text: B[j++], op: 'add' });
    return out.filter((x) => x.text);
  }

  // X Algorithm panelist: stance from the live fit, never from the model.
  function algorithmStance(f, R) {
    if (R.some((r) => r.id === 'report' && r.s === 'fail') || f < 5) return 'kill';
    return f > 8 ? 'ship' : 'fix';
  }

  // Parse every param!(Name, type, "...", value) in param.rs.
  function parseParams(src) {
    const out = {};
    const re = /param!\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*[A-Za-z0-9_]+\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*(-?[0-9][0-9_]*(?:\.[0-9_]+)?(?:e-?\d+)?)\s*\)/g;
    let m;
    while ((m = re.exec(String(src || '')))) out[m[1]] = Number(m[2].replace(/_/g, ''));
    return out;
  }

  // Diff synced params against stored weights: changed values update automatically; new or
  // removed params go to a review list, never straight into rules.
  function diffParams(stored, synced) {
    const changed = [], added = [], removed = [];
    for (const [k, v] of Object.entries(synced)) {
      if (!(k in stored)) added.push({ name: k, value: v });
      else if (stored[k] !== v) changed.push({ name: k, from: stored[k], to: v });
    }
    for (const k of Object.keys(stored)) if (!(k in synced)) removed.push({ name: k, value: stored[k] });
    return { changed, added, removed };
  }

  // ---------- Model judgment over keywords ----------
  // For the judgment checks the model's verdict replaces the regex heuristic (hype still fails).
  const JUDGED = { shareable: 'shareable', reply: 'reply', quote: 'quote', follow: 'follow', on_topic: 'not-interested' };
  function mergeVerdicts(R, verdicts) {
    if (!verdicts) return R;
    return R.map((r) => {
      const key = Object.keys(JUDGED).find((k) => JUDGED[k] === r.id);
      const v = key && verdicts[key];
      if (!['pass', 'warn', 'fail'].includes(v)) return r;
      if (r.id === 'not-interested' && r.s === 'fail' && r.evidence) return r; // hype is a fact, not a judgment
      return { ...r, s: v, judged: true };
    });
  }

  // Weight behind a check, for ranking ("Reports -234" outranks "Quotes 5").
  const weightOf = (r) => (r.w || []).reduce((s, x) => s + Math.abs(Number(x.value) || 0), 0) || (r.id === 'spacing' ? 10 : r.g === 'distribution' ? 1 : 0);
  const weightText = (r) => String(r.why || '').split(/(?<=\.)\s/)[0];

  // The Details rows: only what needs fixing in THIS draft, each with a specific fix, at most 3,
  // ranked by weight; passes collapse to one count. `analysis` (model) supplies the quoted span or
  // what's missing and a rewritten line; deterministic checks (bait, hype, clutter, timing) build
  // their own. A failing check with no specific fix isn't shown.
  function checkRows(R, text, analysis, rules = {}) {
    const t = String(text || '');
    const byId = Object.fromEntries(((analysis && analysis.checks) || []).map((c) => [c.id, c]));
    const rows = [];
    for (const r of R) {
      if (r.s !== 'fail' && r.s !== 'warn') continue;
      const a = byId[r.id];
      let row = null;
      if (a && a.fix_line_before != null && a.fix_line_after) {
        row = { id: r.id, s: r.s, title: r.t, weight: weightText(r), quote: a.span || null, missing: a.missing || null, before: a.fix_line_before, after: a.fix_line_after };
      } else if (r.id === 'spacing' && r.queueAt) {
        row = { id: r.id, s: r.s, title: r.t, weight: weightText(r), missing: r.fix, queueAt: r.queueAt, queueLabel: r.queueLabel };
      } else if ((r.id === 'report' || r.id === 'not-interested') && r.evidence) {
        const line = t.split('\n').find((l) => l.includes(r.evidence));
        const fixed = line && cleanup(line, rules).out;
        if (line && fixed && fixed.trim() && fixed !== line) row = { id: r.id, s: r.s, title: r.t, weight: weightText(r), quote: r.evidence, before: line, after: fixed };
      } else if (r.id === 'mute') {
        const lines = t.split('\n');
        const cleaned = cleanup(t, rules).out.split('\n');
        const i = lines.findIndex((l, k) => cleaned[k] !== undefined && l !== cleaned[k] && cleaned[k].trim());
        if (i >= 0) row = { id: r.id, s: r.s, title: r.t, weight: weightText(r), quote: lines[i], before: lines[i], after: cleaned[i] };
      }
      if (row) rows.push({ ...row, rank: weightOf(r) });
    }
    rows.sort((a, b) => b.rank - a.rank);
    const passes = R.filter((r) => r.s === 'pass').length;
    return { rows: rows.slice(0, 3), passes };
  }

  // ---------- Algorithm sync: only alert on what affects posts ----------
  const ALERT_DIST = new Set(['AuthorDiversityDecay', 'AuthorDiversityFloor', 'OonWeightFactor', 'TopicOonWeightFactor', 'ColdStartImpressionThreshold', 'ColdStartFollowerCap', 'ColdStartMaxPostAgeSecs', 'MinVideoDurationMs', 'AgeFilterHours', 'VMRankerDppTheta']);
  const NAMES = { ReplyWeight: 'Replies', QuoteWeight: 'Quotes', ShareWeight: 'Shares', ShareViaCopyLinkWeight: 'Copy-link shares', ShareViaDmWeight: 'DM shares', FollowAuthorWeight: 'Follows', RetweetWeight: 'Reposts', FavoriteWeight: 'Likes', ReportWeight: 'Reports', MuteAuthorWeight: 'Mutes', BlockAuthorWeight: 'Blocks', NotInterestedWeight: '"Not interested"', BidirectionalFollowReplyWeightBoost: 'Replies from mutuals', ClickWeight: 'Clicks', OpenLinkWeight: 'Link opens', AuthorDiversityDecay: 'Author diversity decay', AuthorDiversityFloor: 'Author diversity floor', OonWeightFactor: 'Out-of-network factor', TopicOonWeightFactor: 'Topic out-of-network factor', ColdStartImpressionThreshold: 'Cold-start impression threshold', ColdStartFollowerCap: 'Cold-start follower cap', ColdStartMaxPostAgeSecs: 'Cold-start window (seconds)', MinVideoDurationMs: 'Minimum video length (ms)', AgeFilterHours: 'Age filter (hours)', VMRankerDppTheta: 'Diversity rerank theta' };
  const isActionWeight = (name) => /(Weight|WeightBoost)$/.test(name) && !/(Retrieval|Sampl|Kafka|Shadow|Max|Limit|Results|Timeout|Batch|Cache)/i.test(name);
  const classifyParam = (name) => (ALERT_DIST.has(name) || isActionWeight(name) ? 'alert' : 'ignore');
  const humanize = (name) => NAMES[name] || name.replace(/Weight(Boost)?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  // { alerts: ["Replies now weigh 6 (was 5)."], devlog: [...everything else] }
  function syncAlerts(diff) {
    const alerts = [], devlog = [];
    for (const c of diff.changed || []) {
      if (classifyParam(c.name) === 'alert') alerts.push(isActionWeight(c.name) ? `${humanize(c.name)} now weigh ${c.to} (was ${c.from}).` : `${humanize(c.name)} is now ${c.to} (was ${c.from}).`);
      else devlog.push(`changed ${c.name}: ${c.from} -> ${c.to}`);
    }
    for (const a of diff.added || []) devlog.push(`new ${a.name} = ${a.value}`);
    for (const r of diff.removed || []) devlog.push(`removed ${r.name}`);
    return { alerts, devlog };
  }

  const api = { lint, fit, fitWeights, band, wantsLists, cleanup, guardRewrite, placeholders, wordDiff, algorithmStance, parseParams, diffParams, xlen, numbersIn, PLACEHOLDER, mergeVerdicts, checkRows, classifyParam, syncAlerts, spacingFix, JUDGED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetXLinter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
