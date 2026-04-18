// Content Script - Element Picker
let pickerActive = false;
let highlightedEl = null;
let overlay = null;
let tooltip = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_PICKER') {
    startPicker();
    sendResponse({ success: true });
  }
  if (msg.type === 'STOP_PICKER') {
    stopPicker();
    sendResponse({ success: true });
  }
  if (msg.type === 'GET_CONTENT') {
    const el = document.querySelector(msg.selector);
    sendResponse({ value: el ? el.textContent.trim() : null });
  }
});

function startPicker() {
  if (pickerActive) return;
  pickerActive = true;

  // Overlay
  overlay = document.createElement('div');
  overlay.id = '__pm_overlay__';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483646; cursor: crosshair; pointer-events: all;
  `;
  document.body.appendChild(overlay);

  // Tooltip
  tooltip = document.createElement('div');
  tooltip.id = '__pm_tooltip__';
  tooltip.style.cssText = `
    position: fixed; z-index: 2147483647; padding: 6px 12px;
    background: #0f172a; color: #38bdf8; font-family: monospace;
    font-size: 12px; border-radius: 6px; pointer-events: none;
    white-space: nowrap; max-width: 400px; overflow: hidden;
    text-overflow: ellipsis; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    border: 1px solid #38bdf8; display: none;
  `;
  document.body.appendChild(tooltip);

  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('click', onMouseClick);
  document.addEventListener('keydown', onKeyDown);
}

function stopPicker() {
  if (!pickerActive) return;
  pickerActive = false;
  if (overlay) overlay.remove();
  if (tooltip) tooltip.remove();
  removeHighlight();
  overlay = null;
  tooltip = null;
}

function onMouseMove(e) {
  overlay.style.pointerEvents = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  overlay.style.pointerEvents = 'all';

  if (!el || el === overlay || el === tooltip) return;

  highlightElement(el);

  const selector = getSelector(el);
  const content = el.textContent.trim().substring(0, 60);
  tooltip.textContent = `${selector} → "${content}${content.length >= 60 ? '...' : ''}"`;
  tooltip.style.display = 'block';
  tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 420) + 'px';
  tooltip.style.top = Math.min(e.clientY + 12, window.innerHeight - 60) + 'px';
}

function onMouseClick(e) {
  e.preventDefault();
  e.stopPropagation();

  overlay.style.pointerEvents = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  overlay.style.pointerEvents = 'all';

  if (!el || el === overlay) return;

  const selector = getSelector(el);
  const value = el.textContent.trim();
  const title = document.title;
  const url = window.location.href;

  chrome.runtime.sendMessage({
    type: 'ELEMENT_PICKED',
    data: { selector, value, title, url }
  });

  stopPicker();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' });
    stopPicker();
  }
}

function highlightElement(el) {
  removeHighlight();
  highlightedEl = el;
  el.dataset.__pmPrevOutline = el.style.outline;
  el.dataset.__pmPrevBg = el.style.backgroundColor;
  el.style.outline = '2px solid #38bdf8';
  el.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
}

function removeHighlight() {
  if (highlightedEl) {
    highlightedEl.style.outline = highlightedEl.dataset.__pmPrevOutline || '';
    highlightedEl.style.backgroundColor = highlightedEl.dataset.__pmPrevBg || '';
    delete highlightedEl.dataset.__pmPrevOutline;
    delete highlightedEl.dataset.__pmPrevBg;
    highlightedEl = null;
  }
}

function getSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  
  const path = [];
  let current = el;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.className) {
      const classes = Array.from(current.classList)
        .filter(c => !c.startsWith('__pm'))
        .slice(0, 2)
        .join('.');
      if (classes) selector += '.' + classes;
    }
    
    // Add nth-child if needed
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    
    path.unshift(selector);
    current = current.parentElement;
    
    if (path.length >= 4) break;
  }
  
  return path.join(' > ');
}
