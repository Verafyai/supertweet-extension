// LinkedIn adapter. Selectors live in linkedin.selectors.js.
(() => {
  'use strict';
  const S = globalThis.SupertweetLinkedInSelectors;

  // Union of every fallback, document order, no duplicates.
  function all(list, root = document) {
    const seen = new Set();
    const out = [];
    for (const sel of list) {
      let found = [];
      try { found = root.querySelectorAll(sel); } catch { continue; }
      for (const el of found) if (!seen.has(el)) { seen.add(el); out.push(el); }
    }
    return out;
  }
  const closestAny = (el, list) => {
    if (!el || !el.closest) return null;
    for (const sel of list) { const c = el.closest(sel); if (c) return c; }
    return null;
  };
  const slugFrom = (href) => {
    const m = String(href || '').match(/\/in\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  };

  function sendButtons() {
    const candidates = all(S.postButton);
    // Text fallback: a primary-looking button labeled Post/Publish/Next inside a composer root.
    for (const root of all(S.composerRoot)) {
      for (const b of root.querySelectorAll('button')) {
        if (!candidates.includes(b) && S.postButtonText.test(b.innerText || '')) candidates.push(b);
      }
    }
    return candidates.filter((b) => S.postButtonText.test(b.innerText || b.getAttribute('aria-label') || ''));
  }

  function me(settingsSlug) {
    if (settingsSlug) return String(settingsSlug).toLowerCase();
    const a = all(S.meLink)[0];
    return a ? slugFrom(a.getAttribute('href')) : null;
  }

  const LinkedInAdapter = {
    id: 'linkedin',
    formatRules: 'linkedin_format',
    rubric: false,
    selectors: S,
    matches: (url) => /^https:\/\/www\.linkedin\.com\//.test(url),
    findComposer: () => all(S.composerEditor),
    isComposer: (el) => {
      if (!el || !el.closest) return null;
      return all(S.composerEditor).find((c) => c === el || c.contains(el)) || null;
    },
    readDraft(el) {
      const root = closestAny(el, S.composerRoot) || document;
      const titleEl = all(S.articleTitle, root)[0] || null;
      return {
        text: (el.innerText || '').replace(/​/g, '').trim(),
        title: titleEl ? String(titleEl.value || titleEl.innerText || '').trim() || null : null,
      };
    },
    sendButtons,
    isSendButton: (el) => {
      if (!el || !el.closest) return null;
      const b = el.closest('button');
      return b && sendButtons().includes(b) ? b : null;
    },
    composersFor(btn) {
      const root = closestAny(btn, S.composerRoot);
      const inRoot = root ? all(S.composerEditor, root) : [];
      // The article "Publish" dialog is separate from the editor: fall back to every open editor.
      return inRoot.length ? inRoot : all(S.composerEditor);
    },
    buttonFor(el) {
      const root = closestAny(el, S.composerRoot);
      const btns = sendButtons();
      return (root && btns.find((b) => root.contains(b))) || btns[0] || null;
    },
    composerMedia(el) {
      const root = closestAny(el, S.composerRoot) || document;
      const m = all(S.composerMedia, root)[0];
      return m ? { media: m.tagName === 'VIDEO' ? 'video' : 'image' } : { media: 'none' };
    },
    // "Attach screenshot": open LinkedIn's own media picker (a click, never an upload by us).
    openAttach(el) {
      const root = closestAny(el, S.composerRoot) || document;
      const b = all(S.attachButton, root)[0] || all(S.attachButton)[0];
      if (b) { b.click(); return true; }
      return false;
    },
    sendLabel: (btn) => (btn.innerText || btn.textContent || 'Post').trim() || 'Post',
    // Comment boxes send on Enter.
    enterSends: (el) => Boolean(closestAny(el, S.commentEditor) || el.closest('.comments-comment-box, form.comments-comment-box__form')),
    // Only on your own recent-activity page.
    isOwnActivityPage(settingsSlug) {
      const m = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\//);
      const mine = me(settingsSlug);
      return Boolean(m && mine && decodeURIComponent(m[1]).toLowerCase() === mine);
    },
    me,
    findOwnPosts(settingsSlug) {
      const mine = me(settingsSlug);
      if (!mine) return [];
      return all(S.activityPost).filter((post) => {
        // Nested matches (an inner urn element inside a post) are skipped.
        if (closestAny(post.parentElement, S.activityPost)) return false;
        const actor = all(S.postActorLink, post)[0];
        return actor && slugFrom(actor.getAttribute('href')) === mine; // reposts of others are excluded
      });
    },
    readPost(post) {
      const urn = post.getAttribute('data-urn') || post.getAttribute('data-id');
      const textEl = all(S.postText, post)[0] || null;
      return {
        id: urn,
        url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null,
        date: null,
        author: (() => { const a = all(S.postActorLink, post)[0]; return a ? slugFrom(a.getAttribute('href')) : null; })(),
        text: textEl ? (textEl.innerText || '').trim() : '',
        textEl,
      };
    },
    // Visible counts on a post; null where LinkedIn shows none.
    engagement(post) {
      const n = (list) => { const el = all(list, post)[0]; if (!el) return null; const m = (el.innerText || el.getAttribute('aria-label') || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([km])?/i); if (!m) return null; return Math.round(Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1)); };
      return { likes: n(S.postReactions), replies: n(S.postComments), reposts: n(S.postReposts) };
    },
    mountBadge(post, host) {
      const textEl = all(S.postText, post)[0];
      const anchor = textEl || post.firstElementChild;
      if (!anchor) return false;
      if (host.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', host);
      return true;
    },
  };

  (globalThis.SupertweetAdapters = globalThis.SupertweetAdapters || {}).linkedin = LinkedInAdapter;
})();
