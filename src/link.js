// Runs only on the Supertweet web app. When you're signed in there, the page hands over an access
// token; storing it links the extension to the hosted grader. Nothing else is read from the page.
(() => {
  'use strict';
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.type !== 'supertweet:link' || typeof d.token !== 'string' || d.backend !== location.origin) return;
    const { settings = {} } = await chrome.storage.local.get({ settings: {} });
    await chrome.storage.local.set({ apiToken: d.token, apiUser: d.username, settings: { ...settings, backendUrl: location.origin } });
    window.postMessage({ type: 'supertweet:linked', username: d.username }, location.origin);
  });
})();
