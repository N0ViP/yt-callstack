// popup.js - yt-callstack Extension Popup Logic

const STORAGE_KEY = 'ytCallStack';
const RESTORE_KEY = 'ytPendingPopRestore';

let currentStack = [];

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Loads stack data from chrome.storage.local and renders the UI.
 */
async function loadAndRender() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    currentStack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    render();
  } catch (err) {
    console.warn('[yt-callstack] Notice loading popup stack:', err);
  }
}

/**
 * Renders the stack list and header depth indicator.
 */
function render() {
  const depthBadge = document.getElementById('depth-badge');
  const btnPopTop = document.getElementById('btn-pop-top');
  const btnClearAll = document.getElementById('btn-clear-all');
  const container = document.getElementById('stack-container');

  const depth = currentStack.length;

  depthBadge.textContent = String(depth);
  depthBadge.classList.toggle('has-items', depth > 0);

  btnPopTop.disabled = depth === 0;
  btnClearAll.disabled = depth === 0;

  if (depth === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
        </div>
        <div class="empty-title">Your Call Stack is empty</div>
        <div class="empty-desc">
          Save running videos with Alt+Click or Alt+S before diving into rabbit holes.
        </div>
      </div>
    `;
    return;
  }

  let html = '';
  currentStack.forEach((frame, index) => {
    const isTop = index === 0;
    const savedTime = formatTimestamp(frame.savedTimestamp);
    const speed = frame.playbackRate || 1;

    html += `
      <div class="frame-card ${isTop ? 'is-top' : ''}" data-index="${index}">
        <div class="frame-thumb-box">
          <img class="frame-thumb" src="${frame.thumbnail}" alt="" />
          <span class="frame-time-pill">${savedTime}</span>
        </div>
        <div class="frame-details">
          <div class="frame-title" title="${escapeHtml(frame.title)}">${escapeHtml(frame.title)}</div>
          <div class="frame-meta">
            <span>${savedTime}</span>
            ${speed !== 1 ? `<span>• ${speed}x</span>` : ''}
          </div>
        </div>
        <div class="frame-actions">
          <button class="btn-action-icon" data-action="resume" data-index="${index}" title="Return to this video">
            <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
          </button>
          <button class="btn-action-icon" data-action="delete" data-index="${index}" title="Remove from stack">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  const cards = container.querySelectorAll('.frame-card');
  cards.forEach((card) => {
    const idx = parseInt(card.getAttribute('data-index'), 10);

    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete"]')) return;
      unwindAndResume(idx);
    });

    const delBtn = card.querySelector('[data-action="delete"]');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteFrame(idx);
      });
    }
  });
}

/**
 * Unwinds the stack to the target index and navigates active tab to that video.
 * @param {number} targetIndex - Index to resume (0 = top)
 */
async function unwindAndResume(targetIndex = 0) {
  if (targetIndex < 0 || targetIndex >= currentStack.length) return;

  const targetFrame = currentStack[targetIndex];
  const remainingStack = currentStack.slice(targetIndex + 1);
  const targetTimestamp = Math.max(0, (targetFrame.savedTimestamp || 0) - 3);

  await chrome.storage.local.set({
    [STORAGE_KEY]: remainingStack,
    [RESTORE_KEY]: {
      videoId: targetFrame.videoId,
      savedTimestamp: targetFrame.savedTimestamp,
      playbackRate: targetFrame.playbackRate || 1,
      title: targetFrame.title,
      isPopping: true,
      timestampSetAt: Date.now()
    }
  });

  const targetUrl = new URL(targetFrame.url);
  targetUrl.searchParams.set('t', `${Math.floor(targetTimestamp)}s`);

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id && activeTab.url && activeTab.url.includes('youtube.com')) {
    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_POP', index: targetIndex });
      if (res && res.handled) {
        window.close();
        return;
      }
    } catch (e) {}
  }

  if (activeTab && activeTab.id) {
    await chrome.tabs.update(activeTab.id, { url: targetUrl.toString() });
  } else {
    await chrome.tabs.create({ url: targetUrl.toString() });
  }

  window.close();
}

/**
 * Removes a single frame from the stack without navigating.
 * @param {number} indexToRemove
 */
async function deleteFrame(indexToRemove) {
  if (indexToRemove < 0 || indexToRemove >= currentStack.length) return;
  const updated = currentStack.filter((_, idx) => idx !== indexToRemove);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  currentStack = updated;
  render();
}

/**
 * Clears all frames from storage.
 */
async function clearAll() {
  if (confirm('Clear Call Stack?')) {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    currentStack = [];
    render();
  }
}

/**
 * Inspects current active tab to show active video context if available.
 */
async function checkActiveTabVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
      return;
    }

    const banner = document.getElementById('active-video-banner');
    const titleEl = document.getElementById('active-video-title');
    const btnPush = document.getElementById('btn-push-active');

    banner.style.display = 'flex';
    titleEl.textContent = tab.title ? tab.title.replace(/ - YouTube$/, '') : 'YouTube Video';

    btnPush.addEventListener('click', async () => {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_PUSH' });
        if (response && response.success) {
          btnPush.textContent = 'Saved';
          setTimeout(() => {
            btnPush.textContent = 'Push';
          }, 1500);
          await loadAndRender();
          return;
        }
      } catch (e) {
        // Fallback
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
            const videoId = new URL(window.location.href).searchParams.get('v');
            if (!videoId || !video) return;

            const titleEl = document.querySelector('ytd-watch-metadata #title h1 yt-formatted-string') ||
                            document.querySelector('h1.ytd-watch-metadata') ||
                            document.querySelector('h1.title yt-formatted-string');
            const channelEl = document.querySelector('ytd-watch-metadata #channel-name a') ||
                              document.querySelector('#owner-name a');

            const frame = {
              videoId: videoId,
              url: window.location.href,
              title: titleEl ? titleEl.textContent.trim() : document.title.replace(/ - YouTube$/, '').trim(),
              channelName: channelEl ? channelEl.textContent.trim() : 'YouTube Channel',
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              savedTimestamp: Math.round((video.currentTime || 0) * 10) / 10,
              playbackRate: video.playbackRate || 1,
              pushedAt: Date.now()
            };

            chrome.storage.local.get('ytCallStack', (data) => {
              const stack = Array.isArray(data.ytCallStack) ? data.ytCallStack : [];
              const filteredStack = stack.filter(item => item.videoId !== videoId);
              chrome.storage.local.set({ ytCallStack: [frame, ...filteredStack] });
            });
          }
        });
        btnPush.textContent = 'Saved';
        setTimeout(() => {
          btnPush.textContent = 'Push';
        }, 1500);
        setTimeout(loadAndRender, 150);
      } catch (e) {
        console.warn('[yt-callstack] Could not execute push on active tab:', e);
      }
    });
  } catch (err) {
    console.warn('[yt-callstack] Active tab check failed:', err);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY]) {
    currentStack = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
    render();
  }
});

document.getElementById('btn-pop-top').addEventListener('click', () => {
  unwindAndResume(0);
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
  clearAll();
});

// Initialization
loadAndRender();
checkActiveTabVideo();
