// Popup JS - Page Monitor
let monitors = [];
let changes = [];
let pickerMode = false;
let pickedData = null;
let editingId = null;

const CATEGORY_LABELS = {
  general: 'General', price: 'Price', job: 'Jobs', order: 'Orders', news: 'News'
};

const INTERVAL_LABELS = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 360: '6h', 1440: '24h'
};

// Init
document.addEventListener('DOMContentLoaded', async () => {
  await checkPickerResult();
  await checkPendingMonitor(); // Resume after permission grant closed popup
  await loadData();
  setupTabs();
  setupForm();
  setupListeners();
  await loadSettings();
  clearBadge();
});

// If user granted permission via dialog (which closed popup), finish saving on reopen
async function checkPendingMonitor() {
  const { pendingMonitor } = await chrome.storage.local.get('pendingMonitor');
  if (!pendingMonitor) return;
  await chrome.storage.local.remove('pendingMonitor');

  const { url, title, selector, intervalMinutes, category, initialValue, editingId: eid } = pendingMonitor;

  // Verify permission was actually granted
  try {
    const origin = new URL(url);
    const pattern = `${origin.protocol}//${origin.hostname}/*`;
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) {
      // User denied — restore form so they can try again
      document.getElementById('addForm').style.display = 'flex';
      document.getElementById('inputUrl').value = url;
      document.getElementById('inputTitle').value = title;
      document.getElementById('inputSelector').value = selector;
      document.getElementById('inputInterval').value = intervalMinutes;
      document.getElementById('inputCategory').value = category;
      return;
    }
  } catch { return; }

  // Permission granted — save monitor now
  let result;
  if (eid) {
    result = await sendMsg({
      type: 'UPDATE_MONITOR',
      id: eid,
      data: { title, url, selector, intervalMinutes, category }
    });
  } else {
    result = await sendMsg({
      type: 'ADD_MONITOR',
      data: { title, url, selector, intervalMinutes, category, initialValue }
    });
  }

  if (result && result.success) {
    // Show brief success flash then refresh
    const btn = document.getElementById('btnSave');
    if (btn) { btn.textContent = '✓ Saved!'; btn.style.background = '#34d399'; }
    setTimeout(() => loadData(), 600);
  }
}

// Called on popup open — check if content script saved a picker result via background
async function checkPickerResult() {
  const result = await sendMsg({ type: 'GET_PICKER_RESULT' });
  if (!result) return;
  if (result.type === 'ELEMENT_PICKED') {
    const d = result.data;
    pickedData = d;
    const { pendingFormState = {} } = await chrome.storage.local.get('pendingFormState');
    await chrome.storage.local.remove('pendingFormState');
    document.getElementById('addForm').style.display = 'flex';
    document.getElementById('inputUrl').value = d.url || pendingFormState.url || '';
    document.getElementById('inputTitle').value = pendingFormState.title || d.title || '';
    document.getElementById('inputSelector').value = d.selector || '';
    if (pendingFormState.interval) document.getElementById('inputInterval').value = pendingFormState.interval;
    if (pendingFormState.category) document.getElementById('inputCategory').value = pendingFormState.category;
    if (d.value) {
      document.getElementById('previewBox').style.display = 'block';
      document.getElementById('previewValue').textContent = d.value;
    }
  }
}

async function loadData() {
  monitors = await sendMsg({ type: 'GET_MONITORS' }) || [];
  changes = await sendMsg({ type: 'GET_CHANGES' }) || [];
  renderMonitors();
  renderChanges();
  updateChangeBadge();
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function setupForm() {
  const btnToggle = document.getElementById('btnToggleForm');
  const addForm = document.getElementById('addForm');
  const btnCancel = document.getElementById('btnCancel');
  const btnSave = document.getElementById('btnSave');
  const btnCurrentUrl = document.getElementById('btnCurrentUrl');
  const btnPick = document.getElementById('btnPick');
  const inputSelector = document.getElementById('inputSelector');

  btnToggle.addEventListener('click', () => {
    const visible = addForm.style.display !== 'none';
    addForm.style.display = visible ? 'none' : 'flex';
    if (!visible) {
      btnCurrentUrl.click(); // Auto-fill current URL
    }
  });

  btnCancel.addEventListener('click', () => {
    addForm.style.display = 'none';
    resetForm();
  });

  btnCurrentUrl.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      document.getElementById('inputUrl').value = tab.url;
      if (!document.getElementById('inputTitle').value) {
        document.getElementById('inputTitle').value = tab.title;
      }
    }
  });

  btnPick.addEventListener('click', async () => {
    if (pickerMode) {
      pickerMode = false;
      btnPick.classList.remove('active');
      document.getElementById('pickHint').style.display = 'none';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_PICKER' });
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Check it's a real page (not chrome:// etc)
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      alert('Please open a webpage before using this feature.');
      return;
    }

    pickerMode = true;
    btnPick.classList.add('active');
    document.getElementById('pickHint').style.display = 'block';

    // Inject content script if not already there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch {} // Already injected, ignore error

    chrome.tabs.sendMessage(tab.id, { type: 'START_PICKER' });
    // Save form state before popup closes
    await chrome.storage.local.set({ pendingFormState: {
      title: document.getElementById('inputTitle').value,
      url: document.getElementById('inputUrl').value,
      interval: document.getElementById('inputInterval').value,
      category: document.getElementById('inputCategory').value,
    }});
    await chrome.tabs.update(tab.id, { active: true });
    window.close();
  });

  inputSelector.addEventListener('blur', async () => {
    const selector = inputSelector.value.trim();
    const url = document.getElementById('inputUrl').value.trim();
    if (!selector || !url) return;
    await previewSelector(selector);
  });

  btnSave.addEventListener('click', saveMonitor);
}

async function previewSelector(selector) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT', selector });
    if (result && result.value) {
      document.getElementById('previewBox').style.display = 'block';
      document.getElementById('previewValue').textContent = result.value;
      return result.value;
    }
  } catch {}
  document.getElementById('previewBox').style.display = 'none';
  return null;
}

async function saveMonitor() {
  const title = document.getElementById('inputTitle').value.trim();
  const url = document.getElementById('inputUrl').value.trim();
  const selector = document.getElementById('inputSelector').value.trim();
  const intervalMinutes = parseInt(document.getElementById('inputInterval').value);
  const category = document.getElementById('inputCategory').value;

  if (!url || !selector) {
    alert('Please enter a URL and CSS Selector');
    return;
  }

  // Check if we already have permission
  let pattern;
  try {
    const origin = new URL(url);
    pattern = `${origin.protocol}//${origin.hostname}/*`;
  } catch {
    alert('Invalid URL.');
    return;
  }

  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (!already) {
    // Save entire form to storage BEFORE requesting — because the permission
    // dialog closes the popup, so we resume on next popup open
    await chrome.storage.local.set({
      pendingMonitor: {
        title, url, selector, intervalMinutes, category,
        initialValue: pickedData ? pickedData.value : null,
        editingId: editingId || null
      }
    });
    // This closes the popup — code below never runs
    await chrome.permissions.request({ origins: [pattern] });
    return;
  }

  const btnSave = document.getElementById('btnSave');
  btnSave.disabled = true;
  btnSave.textContent = 'Saving...';

  // Get initial value
  const initialValue = pickedData ? pickedData.value : await previewSelector(selector);

  let result;
  if (editingId) {
    result = await sendMsg({
      type: 'UPDATE_MONITOR',
      id: editingId,
      data: { title: title || url, url, selector, intervalMinutes, category }
    });
  } else {
    result = await sendMsg({
      type: 'ADD_MONITOR',
      data: { title: title || url, url, selector, intervalMinutes, category, initialValue }
    });
  }

  if (result && result.success) {
    document.getElementById('addForm').style.display = 'none';
    resetForm();
    await loadData();
  }

  btnSave.disabled = false;
  btnSave.textContent = editingId ? 'Update' : 'Save Monitor';
  editingId = null;
  pickedData = null;
}

function resetForm() {
  document.getElementById('inputTitle').value = '';
  document.getElementById('inputUrl').value = '';
  document.getElementById('inputSelector').value = '';
  document.getElementById('inputInterval').value = '5';
  document.getElementById('inputCategory').value = 'general';
  document.getElementById('previewBox').style.display = 'none';
  document.getElementById('pickHint').style.display = 'none';
  pickerMode = false;
  pickedData = null;
  document.getElementById('btnPick').classList.remove('active');
  document.getElementById('btnSave').textContent = 'Save Monitor';
  editingId = null;
}

function setupListeners() {
  document.getElementById('monitorList').addEventListener('click', async (e) => {
    const link = e.target.closest('.open-tab-link');
    if (!link) return;
    e.preventDefault();
    link.textContent = 'Opening...';
    await sendMsg({ type: 'OPEN_AND_CHECK', id: link.dataset.id, url: link.dataset.url });
    await loadData();
  });

  // Clear changes
  document.getElementById('btnClearAll').addEventListener('click', async () => {
    if (confirm('Clear all change history?')) {
      await sendMsg({ type: 'CLEAR_CHANGES' });
      changes = [];
      renderChanges();
      updateChangeBadge();
    }
  });
}

function renderMonitors() {
  const list = document.getElementById('monitorList');
  const empty = document.getElementById('emptyState');

  if (monitors.length === 0) {
    if (empty) empty.style.display = 'flex';
    // Remove only monitor cards, keep emptyState
    list.querySelectorAll('.monitor-card').forEach(c => c.remove());
    return;
  }

  if (empty) empty.style.display = 'none';
  list.querySelectorAll('.monitor-card').forEach(c => c.remove());

  monitors.forEach(m => {
    const card = document.createElement('div');
    card.className = `monitor-card${m.active ? '' : ' inactive'}`;
    card.dataset.id = m.id;

    const lastChecked = m.lastChecked
      ? `Checked ${formatTime(m.lastChecked)}`
      : 'Not checked yet';

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title cat-${m.category}">${escHtml(m.title)}</div>
        <div class="card-actions">
          <button class="btn-icon success" title="Check now" data-action="check">↺</button>
          <button class="btn-icon" title="Edit" data-action="edit">✎</button>
          <button class="btn-icon danger" title="Delete" data-action="delete">✕</button>
          <label class="toggle" title="${m.active ? 'Active' : 'Inactive'}">
            <input type="checkbox" ${m.active ? 'checked' : ''} data-action="toggle">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="card-meta">
        <span class="meta-tag category">${CATEGORY_LABELS[m.category] || m.category}</span>
        <span class="meta-tag interval">⏱ ${INTERVAL_LABELS[m.intervalMinutes] || m.intervalMinutes + 'm'}</span>
      </div>
      <div class="card-selector">${escHtml(m.selector)}</div>
      <div class="card-status">
        <div class="status-dot ${m.active ? (m.lastError ? 'error' : 'active') : 'inactive'}"></div>
        <span class="status-text">${m.lastError === 'tab_closed' ? `⚠ Tab closed — <a class="open-tab-link" href="#" data-url="${escHtml(m.url)}" data-id="${m.id}">Reopen</a>` : lastChecked}</span>
        ${m.changeCount > 0 ? `<span class="change-count">${m.changeCount} changes</span>` : ''}
      </div>
    `;

    // Events
    card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (confirm(`Delete monitor "${m.title}"?`)) {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        await new Promise(r => setTimeout(r, 300));
        await sendMsg({ type: 'REMOVE_MONITOR', id: m.id });
        await loadData();
      }
    });

    card.querySelector('[data-action="toggle"]').addEventListener('change', async () => {
      await sendMsg({ type: 'TOGGLE_MONITOR', id: m.id });
      await loadData();
    });

    card.querySelector('[data-action="check"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.textContent = '...';
      btn.disabled = true;
      await sendMsg({ type: 'CHECK_NOW', id: m.id });
      setTimeout(async () => { await loadData(); }, 1500);
    });

    card.querySelector('[data-action="edit"]').addEventListener('click', () => {
      editingId = m.id;
      document.getElementById('inputTitle').value = m.title;
      document.getElementById('inputUrl').value = m.url;
      document.getElementById('inputSelector').value = m.selector;
      document.getElementById('inputInterval').value = m.intervalMinutes;
      document.getElementById('inputCategory').value = m.category;
      document.getElementById('previewBox').style.display = 'none';
      document.getElementById('addForm').style.display = 'flex';
      document.getElementById('btnSave').textContent = 'Update';
      document.getElementById('addForm').scrollIntoView({ behavior: 'smooth' });
    });

    list.appendChild(card);
  });
}

function renderChanges() {
  const list = document.getElementById('changesList');
  const count = document.getElementById('changesCount');

  count.textContent = `${changes.length} change${changes.length !== 1 ? 's' : ''}`;

  if (changes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>No changes yet</p>
        <span>Detected changes will appear here</span>
      </div>`;
    return;
  }

  list.innerHTML = '';
  changes.forEach(c => {
    const card = document.createElement('div');
    card.className = `change-card${c.read ? ' read' : ''}`;

    card.innerHTML = `
      <div class="change-header">
        <div class="change-title">${escHtml(c.monitorTitle)}</div>
        <div class="change-time">${formatTime(c.detectedAt)}</div>
      </div>
      <div class="change-diff">
        <div class="diff-row">
          <span class="diff-label old">OLD</span>
          <span class="diff-value">${escHtml((c.oldValue || '').substring(0, 80))}</span>
        </div>
        <div class="diff-row">
          <span class="diff-label new">NEW</span>
          <span class="diff-value">${escHtml((c.newValue || '').substring(0, 80))}</span>
        </div>
      </div>
      <div class="change-url" data-url="${escHtml(c.url)}">${escHtml(c.url)}</div>
    `;

    card.querySelector('.change-url').addEventListener('click', (e) => {
      chrome.tabs.create({ url: e.currentTarget.dataset.url });
    });

    list.appendChild(card);
  });
}

function updateChangeBadge() {
  const unread = changes.filter(c => !c.read).length;
  const badge = document.getElementById('changeBadge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

async function clearBadge() {
  await sendMsg({ type: 'CLEAR_BADGE' });
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  document.getElementById('settingBadge').checked = settings.badge !== false;
  document.getElementById('settingNotify').checked = settings.notify !== false;
  document.getElementById('settingSound').checked = settings.sound !== false;

  document.getElementById('settingBadge').addEventListener('change', saveSettings);
  document.getElementById('settingNotify').addEventListener('change', saveSettings);
  document.getElementById('settingSound').addEventListener('change', saveSettings);
}

async function saveSettings() {
  const settings = {
    badge: document.getElementById('settingBadge').checked,
    notify: document.getElementById('settingNotify').checked,
    sound: document.getElementById('settingSound').checked,
  };
  await chrome.storage.local.set({ settings });
}

function sendMsg(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => null);
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
  return d.toLocaleDateString('en-US');
}
