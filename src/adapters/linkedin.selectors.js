// Every LinkedIn selector, in one place. LinkedIn's DOM changes often: each key is a list of
// fallbacks, tried in order and unioned. When something breaks on linkedin.com, fix it here.
(() => {
  'use strict';
  globalThis.SupertweetLinkedInSelectors = {
    // Share-box modal editor and the long-form article editor. Both are contenteditable role=textbox.
    composerEditor: [
      '.share-creation-state__text-editor [contenteditable="true"][role="textbox"]',
      '.share-box [contenteditable="true"][role="textbox"]',
      '[role="dialog"] .ql-editor[contenteditable="true"]',
      '[role="dialog"] [contenteditable="true"][role="textbox"]',
      '.article-editor-content [contenteditable="true"]',
      '[data-test-article-editor-content-textbox]',
      '.reader-article-editor [contenteditable="true"][role="textbox"]',
      // Comments and replies.
      '.comments-comment-box__form .ql-editor[contenteditable="true"]',
      '.comments-comment-texteditor [contenteditable="true"]',
      'form.comments-comment-box__form [role="textbox"]',
    ],
    commentEditor: [
      '.comments-comment-box__form .ql-editor[contenteditable="true"]',
      '.comments-comment-texteditor [contenteditable="true"]',
      'form.comments-comment-box__form [role="textbox"]',
    ],
    // Media in the share box, and the button that opens LinkedIn's own photo/video picker.
    composerMedia: [
      '.share-creation-state__media-preview img',
      '.share-creation-state__media-preview video',
      '[role="dialog"] .share-media-preview img',
      '[role="dialog"] .image-sharing-detour-container img',
    ],
    attachButton: [
      '[role="dialog"] button[aria-label*="Add media" i]',
      '[role="dialog"] button[aria-label*="Add a photo" i]',
      '[role="dialog"] button[aria-label*="photo" i]',
      '.share-creation-state button[aria-label*="media" i]',
      '.share-box button[aria-label*="photo" i]',
    ],
    // Article title (article editor only).
    articleTitle: [
      'textarea.article-editor-headline__textarea',
      '[data-test-article-editor-headline] textarea',
      'textarea[placeholder="Title"]',
      'textarea[aria-label*="Title" i]',
    ],
    // Containers that scope an editor to its send button.
    composerRoot: [
      'form.comments-comment-box__form',
      '.comments-comment-box',
      '.share-box',
      '[role="dialog"]',
      '.article-editor',
      '.reader-article-editor',
    ],
    // Send buttons: share modal "Post", article "Next"/"Publish".
    postButton: [
      'button.share-actions__primary-action',
      '.share-box-footer__primary-btn',
      '[role="dialog"] button.artdeco-button--primary',
      '.article-editor-nav button.artdeco-button--primary',
      'button[data-test-article-publish-button]',
      'button.comments-comment-box__submit-button',
      '.comments-comment-box__submit-button--cr',
    ],
    postButtonText: /^\s*(post|publish|next|repost|comment|reply)\s*$/i,
    // Posts on /in/<me>/recent-activity/.
    activityPost: [
      'div.feed-shared-update-v2[data-urn^="urn:li:activity:"]',
      '[data-urn^="urn:li:activity:"]',
      'div[data-id^="urn:li:activity:"]',
    ],
    postText: [
      '.update-components-text',
      '.feed-shared-update-v2__description',
      '.feed-shared-inline-show-more-text',
      '.feed-shared-text',
    ],
    postActorLink: [
      '.update-components-actor__meta-link',
      '.update-components-actor__container a[href*="/in/"]',
      '.feed-shared-actor__container-link',
      'a.app-aware-link[href*="/in/"]',
    ],
    // Engagement counts on a post (activity page).
    postReactions: ['.social-details-social-counts__reactions-count', '.social-details-social-counts__social-proof-fallback-number', 'button[aria-label*="reaction" i] span'],
    postComments: ['.social-details-social-counts__comments', 'button[aria-label*="comment" i]'],
    postReposts: ['.social-details-social-counts__item--right-aligned button[aria-label*="repost" i]', 'button[aria-label*="repost" i]'],
    // Your own profile link, as a fallback when the popup slug is empty.
    meLink: [
      '.feed-identity-module__actor-meta a[href*="/in/"]',
      'a.global-nav__me-photo[href*="/in/"]',
      '.global-nav__me a[href*="/in/"]',
    ],
  };
})();
