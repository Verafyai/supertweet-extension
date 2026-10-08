// Options: edit objectives (validated, applied without reload) and the private terms list (local only).
(async () => {
  const { validateObjectives, nameOf } = globalThis.SupertweetObjectives;
  const $ = (id) => document.getElementById(id);
  const bundled = await (await fetch(chrome.runtime.getURL('config/objectives.json'))).json();
  const st = await chrome.storage.local.get({ objectivesOverride: null, privateTerms: [], algoSync: null });
  let current = st.objectivesOverride || bundled;
  $('json').value = JSON.stringify(current, null, 2);
  $('private').value = (st.privateTerms || []).join('\n');
  $('status').textContent = st.objectivesOverride ? 'Using your edited objectives.' : 'Using the bundled objectives.json.';
  if (st.algoSync && st.algoSync.checkedAt) $('syncStatus').textContent = `Last checked ${new Date(st.algoSync.checkedAt).toLocaleString()}.`;

  function summary(doc) {
    $('summary').replaceChildren(...doc.objectives.map((o) => {
      const d = document.createElement('div');
      d.className = 'obj';
      const b = document.createElement('b');
      b.textContent = `${nameOf(o)} · ${o.primary_platform === 'both' ? 'X and LinkedIn' : o.primary_platform === 'x' ? 'X' : 'LinkedIn'}`;
      d.append(b, o.statement);
      return d;
    }));
  }
  summary(current);

  $('save').addEventListener('click', async () => {
    let doc;
    try { doc = JSON.parse($('json').value); } catch (e) { $('errors').textContent = `Not valid JSON: ${e.message}`; return; }
    const errors = validateObjectives(doc);
    $('errors').textContent = errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''}:\n${errors.join('\n')}` : '';
    if (errors.length) { $('status').textContent = 'Not saved.'; return; }
    await chrome.storage.local.set({ objectivesOverride: doc });
    current = doc; summary(doc);
    $('status').textContent = 'Saved. Open tabs picked it up.';
  });
  $('reset').addEventListener('click', async () => {
    await chrome.storage.local.remove('objectivesOverride');
    current = bundled; $('json').value = JSON.stringify(bundled, null, 2); $('errors').textContent = ''; summary(bundled);
    $('status').textContent = 'Back to the bundled file.';
  });
  $('savePrivate').addEventListener('click', async () => {
    const terms = [...new Set($('private').value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))];
    await chrome.storage.local.set({ privateTerms: terms });
    $('privateStatus').textContent = `Saved ${terms.length} term${terms.length === 1 ? '' : 's'}, on this device only.`;
  });
  $('syncNow').addEventListener('click', async () => {
    $('syncStatus').textContent = 'Checking…';
    const r = await chrome.runtime.sendMessage({ type: 'sync-now' });
    $('syncStatus').textContent = r.ok ? `Checked. ${r.data.changed.length} weight change${r.data.changed.length === 1 ? '' : 's'}, ${r.data.added.length + r.data.removed.length} to review.` : `Couldn't check: ${r.error}`;
  });
})();
