// "Before you share this": on-device oversharing checks, ported from docs/spec/x-linter.html.
// It asks before you give away personal information; it doesn't judge quality.
// - block: must remove (contact info, street address, your private terms). Never overridable.
// - high: keep only with a typed reason (legal matters, confidential or interview-sourced info).
// - warn: one click "Keep, it's intentional" (job search, money, housing, health, family, heat).
// A kept answer is tied to the exact matched words, so new matches ask again.
// Private terms never leave the device: mask() replaces them before any grading call.
(function (root) {
  'use strict';

  const RULES = [
    { id: 'contact', sev: 'block', re: /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
      q: 'This includes an email address or phone number.' },
    { id: 'address', sev: 'block', re: /\b\d{2,6}\s+(?:[NSEW]{1,2}\s+)?\w+(?:\s\w+)?\s+(?:st|street|ave|avenue|rd|road|blvd|way|dr|drive|ln|lane|pl|place|ct|court)\b\.?(?:\s+(?:NE|NW|SE|SW))?/gi,
      q: 'This looks like a street address.' },
    { id: 'private', sev: 'block', re: null, q: 'This contains one of your private terms.' },
    // Tightened from the prototype so tech usage doesn't trip it: "LLM judge", "developer
    // discovery", "hearing from users" and "filing a bug" are not legal matters.
    { id: 'legal', sev: 'high', re: /\b(divorc\w*|custody|lawsuit|su(ed|ing)\b|court|(?:the|a) judge|judge (?:ruled|ordered|granted|denied|said)|(?:the|a|court|custody|my|our) hearing|attorney|lawyer|(?:opposing |legal )counsel|protection order|restraining order|settlement|deposition|subpoena|mediation|(?:in|legal|court) discovery|discovery (?:request|deadline)s?|court filing|filing (?:a|the) (?:motion|petition|case|lawsuit)|\d{2}-\d-\d{5}-\d{1,2})\b/gi,
      q: 'This touches an active or past legal matter. Anything public can be read by the other side and quoted back. Want it out there?' },
    { id: 'confidential', sev: 'high', re: /\b(confidential|nda|off the record|internal(ly)?|between us|they told me|in my interview|the recruiter said|hiring manager said)\b/gi,
      q: 'This may repeat something told to you in private, or in an interview. Is it yours to share?' },
    { id: 'job', sev: 'warn', re: /\b(interview(ed|ing|s)?|recruiters?|job (hunt|search)|open to work|laid off|unemployed|between jobs|got rejected|final round|offer letter|my next role)\b/gi,
      q: 'This tells everyone, including current and future employers, where you are in a job search. Intentional?' },
    { id: 'money', sev: 'warn', re: /\b(broke|debt|bankrupt\w*|can'?t afford|behind on|my salary|my comp|eviction|rent is)\b|\$\s?\d{2,3}(,\d{3}|k)\b/gi,
      q: 'This shares money details. People will remember it longer than the point you were making.' },
    { id: 'housing', sev: 'warn', re: /\b(living (in|out of) my car|car camping|sleeping in my (car|tesla)|homeless|couch ?surfing|no place to live|where i'?m staying|my lease)\b/gi,
      q: "This says where and how you're living right now. Do you want strangers to know that?" },
    { id: 'health', sev: 'warn', re: /\b(diagnos\w*|therap(y|ist)|medication|meds|depress\w*|anxiety|panic attack|adhd|hospital\w*|my doctor|burn(ed|t)? out)\b/gi,
      q: "This shares health details. Fine if it's the point of the post; worth a second look if it isn't." },
    { id: 'family', sev: 'warn', re: /\b(my (ex|ex-wife|ex-husband|wife|husband|girlfriend|boyfriend|partner|kids?|son|daughter|brother|sister|mom|dad|father|mother))\b/gi,
      q: "This brings someone close to you into public view. They didn't get a vote. Do they need to be in it?" },
    { id: 'heat', sev: 'warn', re: /\b(i'?m so done|can'?t believe (he|she|they)|so angry|furious|f+u+c+k+|screw (them|this|you)|worst (person|company))\b/gi,
      q: 'This reads as written in the moment. Want to queue it for 24 hours and re-read?' },
  ];
  const CATEGORIES = RULES.map((r) => r.id).concat('other');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const privateRe = (terms) => {
    const t = (terms || []).map((x) => String(x).trim()).filter(Boolean);
    return t.length ? new RegExp(`\\b(${t.map(escapeRe).join('|')})\\b`, 'gi') : null;
  };

  // [{ id, sev, q, matches: [...] , masked: bool }]
  function detect(text, privateTerms) {
    const t = String(text || '');
    const out = [];
    for (const r of RULES) {
      const re = r.id === 'private' ? privateRe(privateTerms) : r.re;
      if (!re) continue;
      const m = [...new Set((t.match(re) || []).map((x) => x.trim()).filter(Boolean))];
      if (m.length) out.push({ id: r.id, sev: r.sev, q: r.q, matches: m, masked: r.id === 'private' || r.id === 'contact' });
    }
    return out;
  }

  const keyOf = (hit) => `${hit.id}:${hit.matches.join('|')}`;

  // Questions still needing an answer. Block items are always open.
  function openQuestions(hits, kept) {
    const k = kept instanceof Set ? kept : new Set(kept || []);
    return hits.filter((h) => h.sev === 'block' || !k.has(keyOf(h)));
  }

  // Grader backstop: implied disclosures the regexes miss, merged at warn level.
  function mergeGrader(hits, graderTmi) {
    const out = hits.slice();
    for (const g of graderTmi || []) {
      const span = String(g.span || '').trim();
      if (span && out.some((h) => h.matches.some((m) => m.toLowerCase() === span.toLowerCase()))) continue;
      if (/\[PRIVATE\]/.test(span)) continue; // masked on purpose
      out.push({ id: CATEGORIES.includes(g.category) ? g.category : 'other', sev: 'warn', q: g.question || 'Worth a second look before sharing?', matches: span ? [span] : [], masked: false, fromGrader: true });
    }
    return out;
  }

  // Replace private terms and contact info before any text leaves the device.
  function mask(text, privateTerms) {
    let t = String(text || '');
    const re = privateRe(privateTerms);
    if (re) t = t.replace(re, '[PRIVATE]');
    return t.replace(RULES[0].re, '[PRIVATE]');
  }

  // "Remove" strips the matched words from the draft.
  function removeMatches(text, hit) {
    let v = String(text || '');
    for (const m of hit.matches) v = v.split(m).join('');
    return v.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
  }

  // Masked evidence for display: contact info and private terms never shown.
  const evidence = (hit) => (hit.masked ? hit.matches.map(() => 'hidden') : hit.matches);

  const api = { detect, openQuestions, mergeGrader, mask, removeMatches, evidence, keyOf, RULES, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetTMI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
