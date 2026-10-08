// Picks the adapter for this page. Tests on localhost can force one with <html data-supertweet-platform>.
(() => {
  'use strict';
  const A = globalThis.SupertweetAdapters || {};
  const forced = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && document.documentElement.dataset.supertweetPlatform;
  globalThis.SupertweetPlatform = forced ? A[forced] : Object.values(A).find((a) => a.matches(location.href)) || null;
})();
