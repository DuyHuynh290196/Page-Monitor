// Background Service Worker - Page Monitor
const CHECK_ALARM_PREFIX = 'monitor_check_';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ monitors: [], changes: [], badgeCount: 0 });
  setupAlarms();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ELEMENT_PICKED') {
    chrome.storage.local.set({ pickerResult: { type: 'ELEMENT_PICKED', data: msg.data } });
    chrome.action.openPopup().catch(() => {});
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'PICKER_CANCELLED') {
    chrome.storage.local.set({ pickerResult: { type: 'PICKER_CANCELLED' } });
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'GET_PICKER_RESULT') {
    chrome.storage.local.get('pickerResult').then(({ pickerResult }) => {
      chrome.storage.local.remove('pickerResult');
      sendResponse(pickerResult || null);
    });
    return true;
  }
  if (msg.type === 'ADD_MONITOR') {
    addMonitor(msg.data).then(sendResponse);
    return true;
  }
  if (msg.type === 'UPDATE_MONITOR') {
    updateMonitor(msg.id, msg.data).then(sendResponse);
    return true;
  }
  if (msg.type === 'REMOVE_MONITOR') {
    removeMonitor(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_MONITORS') {
    getMonitors().then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_CHANGES') {
    getChanges().then(sendResponse);
    return true;
  }
  if (msg.type === 'CLEAR_BADGE') {
    clearBadge().then(sendResponse);
    return true;
  }
  if (msg.type === 'TOGGLE_MONITOR') {
    toggleMonitor(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === 'CHECK_NOW') {
    checkMonitor(msg.id).then(sendResponse);
    return true;
  }
  if (msg.type === 'OPEN_AND_CHECK') {
    openTabAndCheck(msg.id, msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === 'CLEAR_CHANGES') {
    clearChanges(msg.monitorId).then(sendResponse);
    return true;
  }
  // Dynamic permission helpers — must be called from popup (user gesture context)
  if (msg.type === 'REQUEST_HOST_PERMISSION') {
    requestHostPermission(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === 'CHECK_HOST_PERMISSION') {
    checkHostPermission(msg.url).then(sendResponse);
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(CHECK_ALARM_PREFIX)) {
    const monitorId = alarm.name.replace(CHECK_ALARM_PREFIX, '');
    await checkMonitor(monitorId);
  }
});

async function setupAlarms() {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  for (const monitor of monitors) {
    if (monitor.active) createAlarm(monitor);
  }
}

function createAlarm(monitor) {
  chrome.alarms.create(CHECK_ALARM_PREFIX + monitor.id, {
    periodInMinutes: monitor.intervalMinutes
  });
}

// Convert URL → origin pattern e.g. "https://shopee.vn/*"
function urlToOrigin(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch { return null; }
}

async function checkHostPermission(url) {
  const origin = urlToOrigin(url);
  if (!origin) return { granted: false };
  const granted = await chrome.permissions.contains({ origins: [origin] });
  return { granted, origin };
}

// NOTE: chrome.permissions.request() must be called from a user-gesture context (popup)
// Background cannot call it directly — popup calls REQUEST_HOST_PERMISSION which triggers from popup context
async function requestHostPermission(url) {
  const origin = urlToOrigin(url);
  if (!origin) return { granted: false };
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    return { granted, origin };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}

async function addMonitor(data) {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const newMonitor = {
    id: Date.now().toString(),
    url: data.url,
    title: data.title || data.url,
    selector: data.selector,
    selectorType: data.selectorType || 'css',
    intervalMinutes: data.intervalMinutes || 5,
    active: true,
    lastValue: data.initialValue || null,
    lastChecked: null,
    createdAt: new Date().toISOString(),
    changeCount: 0,
    category: data.category || 'general'
  };
  monitors.push(newMonitor);
  await chrome.storage.local.set({ monitors });
  createAlarm(newMonitor);
  return { success: true, monitor: newMonitor };
}

async function updateMonitor(id, data) {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const idx = monitors.findIndex(m => m.id === id);
  if (idx === -1) return { success: false };
  monitors[idx] = { ...monitors[idx], ...data };
  await chrome.storage.local.set({ monitors });
  chrome.alarms.clear(CHECK_ALARM_PREFIX + id);
  if (monitors[idx].active) createAlarm(monitors[idx]);
  return { success: true };
}

async function removeMonitor(id) {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const updated = monitors.filter(m => m.id !== id);
  await chrome.storage.local.set({ monitors: updated });
  chrome.alarms.clear(CHECK_ALARM_PREFIX + id);
  return { success: true };
}

async function toggleMonitor(id) {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const idx = monitors.findIndex(m => m.id === id);
  if (idx === -1) return { success: false };
  monitors[idx].active = !monitors[idx].active;
  await chrome.storage.local.set({ monitors });
  if (monitors[idx].active) {
    createAlarm(monitors[idx]);
  } else {
    chrome.alarms.clear(CHECK_ALARM_PREFIX + id);
  }
  return { success: true, active: monitors[idx].active };
}

async function getMonitors() {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  return monitors;
}

async function getChanges() {
  const { changes = [] } = await chrome.storage.local.get('changes');
  return changes;
}

async function clearChanges(monitorId) {
  const { changes = [] } = await chrome.storage.local.get('changes');
  const updated = monitorId ? changes.filter(c => c.monitorId !== monitorId) : [];
  await chrome.storage.local.set({ changes: updated });
  return { success: true };
}

async function openTabAndCheck(monitorId, url) {
  const tab = await chrome.tabs.create({ url, active: true });
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 15000);
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500);
      }
    });
  });
  await checkMonitor(monitorId);
  return { success: true };
}

async function checkMonitor(monitorId) {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const monitor = monitors.find(m => m.id === monitorId);
  if (!monitor || !monitor.active) return;

  const idx = monitors.findIndex(m => m.id === monitorId);

  try {
    // Check if we have host permission for this URL
    const origin = urlToOrigin(monitor.url);
    if (origin) {
      const hasPermission = await chrome.permissions.contains({ origins: [origin] });
      if (!hasPermission) {
        if (idx !== -1) {
          monitors[idx].lastChecked = new Date().toISOString();
          monitors[idx].lastError = 'no_permission';
          await chrome.storage.local.set({ monitors });
        }
        return;
      }
    }

    const tabs = await chrome.tabs.query({ url: monitor.url });

    if (tabs.length === 0) {
      const wasAlreadyClosed = monitor.lastError === 'tab_closed';
      if (idx !== -1) {
        monitors[idx].lastChecked = new Date().toISOString();
        monitors[idx].lastError = 'tab_closed';
        await chrome.storage.local.set({ monitors });
      }
      if (!wasAlreadyClosed) {
        const { settings = {} } = await chrome.storage.local.get('settings');
        if (settings.badge !== false) {
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
        }
        if (settings.notify !== false) {
          chrome.notifications.create(`tab_closed_${monitorId}_${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: `Page Monitor: ${monitor.title}`,
            message: 'Tab đã bị đóng, không thể theo dõi. Vui lòng mở lại trang.',
            priority: 1
          });
        }
        if (settings.sound !== false) await playSound();
      }
      return;
    }

    const tabId = tabs[0].id;

    // Clear tab_closed error if tab is back
    if (idx !== -1 && monitor.lastError === 'tab_closed') {
      delete monitors[idx].lastError;
      const { badgeCount = 0 } = await chrome.storage.local.get('badgeCount');
      chrome.action.setBadgeText({ text: badgeCount > 0 ? badgeCount.toString() : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
    }

    // Inject content script dynamically (no need for broad content_scripts in manifest)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).catch(() => {}); // Already injected is fine

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractContent,
      args: [monitor.selector, monitor.selectorType]
    });

    if (results && results[0] && results[0].result !== null) {
      await processChange(monitor, results[0].result, monitors);
    }
  } catch (err) {
    console.error('Check error:', err);
    if (idx !== -1) {
      monitors[idx].lastChecked = new Date().toISOString();
      monitors[idx].lastError = err.message;
      await chrome.storage.local.set({ monitors });
    }
  }
}

async function processChange(monitor, currentValue, monitors) {
  const idx = monitors.findIndex(m => m.id === monitor.id);
  const now = new Date().toISOString();

  if (monitor.lastValue !== null && currentValue !== monitor.lastValue) {
    const { changes = [], badgeCount = 0 } = await chrome.storage.local.get(['changes', 'badgeCount']);

    const change = {
      id: Date.now().toString(),
      monitorId: monitor.id,
      monitorTitle: monitor.title,
      url: monitor.url,
      oldValue: monitor.lastValue,
      newValue: currentValue,
      detectedAt: now,
      read: false
    };

    changes.unshift(change);
    if (changes.length > 100) changes.pop();

    const newBadgeCount = badgeCount + 1;
    const { settings = {} } = await chrome.storage.local.get('settings');

    if (settings.badge !== false) {
      chrome.action.setBadgeText({ text: newBadgeCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
    }

    if (settings.notify !== false) {
      chrome.notifications.create(`change_${monitor.id}_${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: `Page Monitor: ${monitor.title}`,
        message: `Nội dung đã thay đổi!\nCũ: ${(monitor.lastValue || '').substring(0, 60)}\nMới: ${currentValue.substring(0, 60)}`,
        priority: 2
      });
    }

    if (settings.sound !== false) await playSound();

    monitors[idx].changeCount = (monitors[idx].changeCount || 0) + 1;
    await chrome.storage.local.set({ changes, badgeCount: newBadgeCount });
  }

  if (idx !== -1) {
    monitors[idx].lastValue = currentValue;
    monitors[idx].lastChecked = now;
    delete monitors[idx].lastError;
    await chrome.storage.local.set({ monitors });
  }
}

function extractContent(selector, selectorType) {
  try {
    let el = null;
    if (selectorType === 'xpath') {
      const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      el = result.singleNodeValue;
    } else {
      el = document.querySelector(selector);
    }
    return el ? el.textContent.trim() : null;
  } catch { return null; }
}

async function playSound() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play change alert sound'
    });
  }
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND' });
}

async function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
  await chrome.storage.local.set({ badgeCount: 0 });
  const { changes = [] } = await chrome.storage.local.get('changes');
  changes.forEach(c => c.read = true);
  await chrome.storage.local.set({ changes });
  return { success: true };
}
