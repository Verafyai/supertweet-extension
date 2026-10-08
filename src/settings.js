// Settings shared by the background worker, popup, options page and content scripts.
// Stored in chrome.storage.local under "settings".
(function (root) {
  'use strict';
  const DEFAULTS = {
    backendUrl: 'https://supertweet-plum.vercel.app', // hosted grader; http://127.0.0.1:8787 for the local server
    threshold: 8.0,            // Post unlocks at this trust score or above
    linkedinMe: '',            // your linkedin.com/in/<slug>
    myHandles: [],             // your other X handles (the one you're logged in as is always included)
  };
  function merge(saved) {
    const s = saved || {};
    return { ...DEFAULTS, ...s, myHandles: Array.isArray(s.myHandles) ? s.myHandles : [] };
  }
  // Grading goes only to the hosted Supertweet backend or a local server, never anywhere else.
  const HOSTED = 'https://supertweet-plum.vercel.app';
  const isLocalUrl = (u) => /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(String(u || '').trim());
  const isHostedUrl = (u) => String(u || '').trim().replace(/\/$/, '') === HOSTED;
  const isAllowedBackend = (u) => isLocalUrl(u) || isHostedUrl(u);
  const api = { DEFAULTS, merge, isLocalUrl, isHostedUrl, isAllowedBackend, HOSTED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SupertweetSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
