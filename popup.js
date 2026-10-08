// Popup: link status with the hosted grader, plus two advanced settings.
(async () => {
  const { merge, isAllowedBackend } = globalThis.SupertweetSettings;
  const $ = (id) => document.getElementById(id);
  let s = merge((await chrome.storage.local.get({ settings: {} })).settings);
  $('backendUrl').value = s.backendUrl;
  $('linkedinMe').value = s.linkedinMe;
  $('myHandles').value = (s.myHandles || []).map((h) => `@${h}`).join(', ');

  async function save(patch) {
    const stored = (await chrome.storage.local.get({ settings: {} })).settings || {};
    await chrome.storage.local.set({ settings: { ...stored, ...patch } });
    s = merge({ ...stored, ...patch });
    $('saved').textContent = 'Saved.';
    health();
  }
  $('myHandles').addEventListener('change', () => save({ myHandles: $('myHandles').value.split(/[\s,]+/).map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean) }));
  $('linkedinMe').addEventListener('change', () => save({ linkedinMe: $('linkedinMe').value.trim().replace(/^.*\/in\//, '').replace(/\/.*$/, '') }));
  $('backendUrl').addEventListener('change', () => {
    const v = $('backendUrl').value.trim().replace(/\/$/, '');
    if (!isAllowedBackend(v)) { $('saved').textContent = 'Use https://supertweet-plum.vercel.app or a localhost URL.'; $('backendUrl').value = s.backendUrl; return; }
    save({ backendUrl: v });
  });

  async function health() {
    const h = await chrome.runtime.sendMessage({ type: 'health' });
    const ok = h.ok && h.data.has_key !== false && (h.data.connected !== false);
    $('dot').className = `dot ${ok ? 'ok' : 'bad'}`;
    $('open').hidden = ok;
    if (ok && h.data.hosted) { $('status').textContent = `Linked as @${h.data.user}`; $('detail').textContent = 'Grading through supertweet-plum.vercel.app'; }
    else if (ok) { $('status').textContent = 'Local grader running'; $('detail').textContent = `${h.data.model} · effort ${h.data.effort}`; }
    else if (h.data && h.data.has_key === false) { $('status').textContent = 'Grader has no API key'; $('detail').textContent = ''; }
    else { $('status').textContent = 'Not linked'; $('detail').textContent = h.error || 'Open Supertweet and connect X to link this browser.'; }
  }
  health();

  // Drafts parked by the heat check: re-read them after 24 hours, then post yourself.
  async function renderQueue() {
    const { queue } = await chrome.storage.local.get({ queue: [] });
    $('queueCard').hidden = !queue.length;
    $('queue').replaceChildren(...queue.map((q) => {
      const due = q.due <= Date.now();
      const d = document.createElement('div');
      d.className = 'qi';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = q.text;
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = `${q.platform === 'x' ? 'X' : 'LinkedIn'} · ${due ? 'ready to re-read' : `ready ${new Date(q.due).toLocaleString()}`}`;
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.disabled = !due;
      copy.addEventListener('click', () => navigator.clipboard.writeText(q.text));
      const rm = document.createElement('button');
      rm.textContent = 'Remove';
      rm.addEventListener('click', async () => { const { queue: all } = await chrome.storage.local.get({ queue: [] }); await chrome.storage.local.set({ queue: all.filter((x) => x.id !== q.id) }); renderQueue(); });
      d.append(t, meta, copy, rm);
      return d;
    }));
  }
  renderQueue();
})();
