// Deterministic draft checks, computed in code and passed to the grader. Also the draft hash
// that ties a grade to one exact draft.
(function (root) {
  'use strict';

  // Same text with different whitespace hashes the same, so a posted tweet matches its draft.
  const normalize = (text) => String(text || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();

  // cyrb53: fast, sync, good enough to tell drafts apart.
  function hashText(text) {
    const s = normalize(text);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b[a-z0-9-]+\.(?:com|io|ai|dev|org|net|co|app|xyz|gg|so)\b(?:\/[^\s<>"')]*)?/gi;
  const OWN_HOSTS = /(?:^|\.)(?:x\.com|twitter\.com|t\.co|linkedin\.com|lnkd\.in)$/i;

  function checks(text, title) {
    const body = String(text || '');
    // URLs are not words for the word-count rules.
    const words = body.replace(URL_RE, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const links = (body.match(URL_RE) || []).filter((u) => {
      const host = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
      return !OWN_HOSTS.test(host);
    });
    return {
      words: words.length,
      chars: [...body.trim()].length,
      em_dashes: (body.match(/—/g) || []).length,
      hashtags: (body.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) || []).length,
      external_links: links.length,
      has_external_link: links.length > 0,
      title_words: title ? (String(title).match(/[\p{L}\p{N}]+/gu) || []).length : 0,
    };
  }

  // Violations computable without a model, given a platform's format rules.
  function formatViolations(c, rules) {
    const out = [];
    if (!rules) return out;
    if (rules.words_min && c.words < rules.words_min) out.push({ rule: `words_min ${rules.words_min}`, evidence: `${c.words} words` });
    if (rules.words_max && c.words > rules.words_max) out.push({ rule: `words_max ${rules.words_max}`, evidence: `${c.words} words` });
    if (rules.max_chars && c.chars > rules.max_chars) out.push({ rule: `max_chars ${rules.max_chars}`, evidence: `${c.chars} characters` });
    if (rules.avoid_em_dashes && c.em_dashes > 0) out.push({ rule: 'avoid_em_dashes', evidence: `${c.em_dashes} em-dash${c.em_dashes > 1 ? 'es' : ''}` });
    return out;
  }

  const api = { checks, formatViolations, hashText, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
