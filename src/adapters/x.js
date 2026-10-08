// X / Twitter adapter. All X DOM knowledge lives here.
(() => {
  'use strict';
  const TEXTAREA_SEL = '[data-testid^="tweetTextarea_"][role="textbox"]';
  const BUTTON_SEL = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
  // Your other handles, from settings (popup → Advanced). The account logged into X is always included.
  const MY_HANDLES = [];
  const setHandles = (list) => { MY_HANDLES.splice(0, MY_HANDLES.length, ...(list || []).map((h) => String(h).replace(/^@/, '').trim().toLowerCase()).filter(Boolean)); };

  const handleFrom = (a) => {
    const m = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
    return m ? m[1].toLowerCase() : null;
  };
  const loggedInHandle = () => handleFrom(document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'));
  const authorOf = (article) => handleFrom(article.querySelector('[data-testid="User-Name"] a[href^="/"]'));

  // innerText drops X's emoji <img>s; keep their alt text so hype emoji still count.
  function tweetTextOf(el) {
    let out = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeName === 'IMG') out += c.getAttribute('alt') || '';
        else if (c.nodeName === 'BR') out += '\n';
        else if (c.nodeType === 1) walk(c);
      }
    };
    walk(el);
    return out.trim();
  }

  function myHandles() {
    const s = new Set(MY_HANDLES);
    const me = loggedInHandle();
    if (me) s.add(me);
    return s;
  }

  const XAdapter = {
    id: 'x',
    formatRules: 'x_format',
    rubric: true, // the on-device developer-trust rubric gates X at 7+
    matches: (url) => /^https:\/\/(?:mobile\.)?(?:x|twitter)\.com\//.test(url),
    findComposer: () => [...document.querySelectorAll(TEXTAREA_SEL)],
    isComposer: (el) => (el && el.closest ? el.closest(TEXTAREA_SEL) : null),
    readDraft: (el) => ({ text: (el.innerText || '').replace(/​/g, '').trim(), title: null }),
    sendButtons: () => [...document.querySelectorAll(BUTTON_SEL)],
    isSendButton: (el) => (el && el.closest ? el.closest(BUTTON_SEL) : null),
    // Every compose box that a send button posts (a thread has several).
    composersFor(btn) {
      for (let n = btn.parentElement; n && n !== document.body; n = n.parentElement) {
        const found = n.querySelectorAll(TEXTAREA_SEL);
        if (found.length) return [...found];
      }
      return [];
    },
    buttonFor(el) {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const b = n.querySelector(BUTTON_SEL);
        if (b) return b;
      }
      return null;
    },
    findOwnPosts() {
      const mine = myHandles();
      return [...document.querySelectorAll('article[data-testid="tweet"]')].filter((a) => mine.has(authorOf(a)));
    },
    readPost(article) {
      const textEl = article.querySelector('[data-testid="tweetText"]');
      let id = null, url = null, date = null;
      for (const a of article.querySelectorAll('a[href*="/status/"]')) {
        const time = a.querySelector('time');
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
        if (time && m) { id = m[2]; url = `/${m[1]}/status/${m[2]}`; date = time.getAttribute('datetime'); break; }
      }
      return { id, url, date, author: authorOf(article), text: textEl ? tweetTextOf(textEl) : '', textEl };
    },
    mountBadge(post, host) {
      const textEl = post.querySelector('[data-testid="tweetText"]');
      if (textEl && host.previousElementSibling !== textEl) textEl.insertAdjacentElement('afterend', host);
      return Boolean(textEl);
    },
    // "Post", "Reply", "Post all": whatever X's own button says.
    sendLabel: (btn) => (btn.innerText || btn.textContent || 'Post').trim() || 'Post',
    // Media attached in this composer: type and video length.
    composerMedia(el) {
      const root = el.closest('[role="dialog"]') || el.closest('[data-testid="primaryColumn"]') || document;
      const att = root.querySelector('[data-testid="attachments"]');
      if (!att) return { media: 'none' };
      const v = att.querySelector('video');
      if (v) return { media: 'video', videoSeconds: Number.isFinite(v.duration) ? v.duration : 0 };
      return att.querySelector('img') ? { media: 'image' } : { media: 'none' };
    },
    // Reach shown on a post: views, likes, replies, reposts (from the buttons' aria-labels, e.g.
    // "1,234 views. View post analytics", "12 Replies. Reply"). null where X shows none.
    engagement(article) {
      const n = (el) => {
        if (!el) return null;
        const m = String(el.getAttribute('aria-label') || el.innerText || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KM])?/i);
        return m ? Math.round(Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1)) : null;
      };
      return {
        views: n(article.querySelector('a[href$="/analytics"], [data-testid="app-text-transition-container"]')),
        likes: n(article.querySelector('[data-testid="like"], [data-testid="unlike"]')),
        replies: n(article.querySelector('[data-testid="reply"]')),
        reposts: n(article.querySelector('[data-testid="retweet"], [data-testid="unretweet"]')),
      };
    },
    // "Attach screenshot": open X's own media picker (the file input behind the image button).
    openAttach(el) {
      const root = el.closest('[role="dialog"]') || el.closest('[data-testid="primaryColumn"]') || document;
      const input = root.querySelector('input[data-testid="fileInput"]') || document.querySelector('input[data-testid="fileInput"]');
      if (input) { input.click(); return true; }
      const btn = root.querySelector('[aria-label="Add photos or video"], [data-testid="addMedia"]');
      if (btn) { btn.click(); return true; }
      return false;
    },
    // Reply composers are discounted like out-of-network posts.
    isReplyComposer(el) {
      if (/\/status\/\d+/.test(location.pathname) && !el.closest('[role="dialog"]')) return true;
      const d = el.closest('[role="dialog"]');
      return Boolean(d && d.querySelector('article[data-testid="tweet"]'));
    },
    // Follower count (on your own profile) and when you last posted (any page showing your posts).
    profileFacts() {
      const me = loggedInHandle();
      if (!me) return null;
      const out = {};
      const f = document.querySelector(`a[href="/${me}/verified_followers" i], a[href="/${me}/followers" i]`);
      if (f) {
        const m = (f.innerText || '').replace(/,/g, '').match(/([\d.]+)\s*([KM])?/i);
        if (m) out.followers = Math.round(Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1));
      }
      const times = XAdapter.findOwnPosts().map((a) => XAdapter.readPost(a).date).filter(Boolean).sort();
      if (times.length) out.lastPostAt = times[times.length - 1];
      return Object.keys(out).length ? out : null;
    },
    // Used by history.js.
    loggedInHandle, authorOf, tweetTextOf, MY_HANDLES, setHandles,
  };

  (globalThis.SupertweetAdapters = globalThis.SupertweetAdapters || {}).x = XAdapter;
})();
