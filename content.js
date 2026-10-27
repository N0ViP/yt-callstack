// content.js - yt-callstack (Ultra-High Performance Architecture)
// 100% Shadow DOM Encapsulation + YouTube Native Client-Side SPA Navigation
// Zero forced reflows, zero full-DOM MutationObservers, zero full-page reloads.

(() => {
  const STORAGE_KEY = 'ytCallStack';
  const RESTORE_KEY = 'ytPendingPopRestore';
  const DOCK_COLLAPSED_KEY = 'ytCallStackDockCollapsed';

  let currentStack = [];
  let isDockCollapsed = true;
  let activeVideoEl = null;
  let autopopTimer = null;
  let autopopInterval = null;
  let isPushLocked = false;
  let shadowRoot = null;
  let hostEl = null;

  /* ==========================================================================
     1. Lightweight Helpers
     ========================================================================== */

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

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

  function getCurrentVideoId() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('v')) return url.searchParams.get('v');
      const match = url.pathname.match(/\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  function extractVideoId(urlStr) {
    try {
      const url = new URL(urlStr, window.location.origin);
      if (url.searchParams.has('v')) return url.searchParams.get('v');
      const match = url.pathname.match(/\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  function getVideoElement() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function getCurrentVideoTitle() {
    const el = document.querySelector('ytd-watch-metadata #title h1 yt-formatted-string') ||
               document.querySelector('h1.ytd-watch-metadata') ||
               document.querySelector('h1.title yt-formatted-string');
    if (el && el.textContent.trim()) return el.textContent.trim();
    return document.title.replace(/ - YouTube$/, '').trim() || 'YouTube Video';
  }

  function getCurrentChannelName() {
    const el = document.querySelector('ytd-watch-metadata #channel-name a') ||
               document.querySelector('ytd-channel-name yt-formatted-string a') ||
               document.querySelector('#owner-name a') ||
               document.querySelector('ytd-video-owner-renderer #channel-name');
    return el ? el.textContent.trim() : 'YouTube Channel';
  }

  function isWatchPage() {
    return window.location.pathname.startsWith('/watch') || !!getCurrentVideoId();
  }

  /* ==========================================================================
     2. Instant Client-Side SPA Navigation (Zero Full-Page Reloads)
     ========================================================================== */

  function triggerSpaNavigate(url) {
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    const clickEvt = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false
    });
    a.dispatchEvent(clickEvt);
    a.remove();
  }

  /* ==========================================================================
     3. State & Storage (Synchronous In-Memory + Async Local Storage)
     ========================================================================== */

  async function loadState() {
    if (!isExtensionValid()) return;
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, DOCK_COLLAPSED_KEY]);
      currentStack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      isDockCollapsed = data[DOCK_COLLAPSED_KEY] !== undefined ? Boolean(data[DOCK_COLLAPSED_KEY]) : true;
      renderDock();
    } catch (e) {}
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes[STORAGE_KEY]) {
        currentStack = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
        renderDock();
      }
      if (changes[DOCK_COLLAPSED_KEY]) {
        isDockCollapsed = Boolean(changes[DOCK_COLLAPSED_KEY].newValue);
        renderDock();
      }
    }
  });

  /* ==========================================================================
     4. Push Mechanics (Strict Deduplication & Fast Execution)
     ========================================================================== */

  async function pushActiveVideo({ pause = true, showNotification = true } = {}) {
    if (!isExtensionValid()) return;
    if (isPushLocked) return;

    const vidId = getCurrentVideoId();
    const video = getVideoElement();
    if (!vidId || !video) return;

    isPushLocked = true;
    try {
      if (pause && !video.paused) {
        try { video.pause(); } catch (e) {}
      }

      const savedTime = Math.round((video.currentTime || 0) * 10) / 10;
      const frame = {
        videoId: vidId,
        url: window.location.href,
        title: getCurrentVideoTitle(),
        channelName: getCurrentChannelName(),
        thumbnail: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        savedTimestamp: savedTime,
        playbackRate: video.playbackRate || 1,
        pushedAt: Date.now()
      };

      const data = await chrome.storage.local.get(STORAGE_KEY);
      const stack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      const alreadyIn = stack.some(item => item.videoId === vidId);

      // Strict Deduplication: video appears at most once in stack
      const filtered = stack.filter(item => item.videoId !== vidId);
      const newStack = [frame, ...filtered];

      await chrome.storage.local.set({ [STORAGE_KEY]: newStack });
      currentStack = newStack;

      if (showNotification) {
        showToast(
          alreadyIn ? `Updated in stack • ${formatTimestamp(savedTime)}` : `Saved to stack • ${formatTimestamp(savedTime)}`,
          'POP',
          () => popTopFrame(0)
        );
      }

      renderDock();
    } catch (e) {
    } finally {
      setTimeout(() => { isPushLocked = false; }, 200);
    }
  }

  /* ==========================================================================
     5. Pop Mechanics (Instant SPA Transition)
     ========================================================================== */

  async function popTopFrame(index = 0) {
    if (!isExtensionValid()) return;
    dismissAutopop();

    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const stack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      if (!stack.length || index >= stack.length) return;

      const targetFrame = stack[index];
      const remaining = stack.filter((_, idx) => idx !== index);
      const targetTime = Math.max(0, (targetFrame.savedTimestamp || 0) - 3);

      await chrome.storage.local.set({
        [STORAGE_KEY]: remaining,
        [RESTORE_KEY]: {
          videoId: targetFrame.videoId,
          savedTimestamp: targetFrame.savedTimestamp,
          playbackRate: targetFrame.playbackRate || 1,
          title: targetFrame.title,
          isPopping: true,
          timestampSetAt: Date.now()
        }
      });

      currentStack = remaining;
      renderDock();

      const currentVidId = getCurrentVideoId();
      if (currentVidId === targetFrame.videoId) {
        // Same video: seek immediately in 0ms without any network transition
        applyRestore(targetTime, targetFrame.playbackRate || 1);
        showToast(`Resumed at ${formatTimestamp(targetTime + 3)}`);
      } else {
        // Different video: navigate via YouTube's native SPA router in 50-100ms
        triggerSpaNavigate(`/watch?v=${targetFrame.videoId}&t=${Math.floor(targetTime)}s`);
      }
    } catch (e) {}
  }

  async function removeFrame(index) {
    if (!isExtensionValid()) return;
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const stack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      if (index < 0 || index >= stack.length) return;

      const newStack = stack.filter((_, idx) => idx !== index);
      await chrome.storage.local.set({ [STORAGE_KEY]: newStack });
      currentStack = newStack;
      renderDock();
    } catch (e) {}
  }

  async function clearStack() {
    if (!isExtensionValid()) return;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
      currentStack = [];
      renderDock();
    } catch (e) {}
  }

  /* ==========================================================================
     6. Event-Driven Playback Restoration
     ========================================================================== */

  function applyRestore(targetTime, playbackRate) {
    const video = getVideoElement();
    if (!video) return;

    try {
      video.currentTime = targetTime;
      video.playbackRate = playbackRate;
    } catch (e) {}

    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer && typeof moviePlayer.seekTo === 'function') {
      try {
        moviePlayer.seekTo(targetTime, true);
        if (typeof moviePlayer.setPlaybackRate === 'function') {
          moviePlayer.setPlaybackRate(playbackRate);
        }
      } catch (e) {}
    }
  }

  async function checkAndApplyPendingRestore() {
    if (!isExtensionValid()) return;
    try {
      const data = await chrome.storage.local.get(RESTORE_KEY);
      const pending = data[RESTORE_KEY];
      if (!pending || !pending.isPopping) return;

      if (Date.now() - (pending.timestampSetAt || 0) > 60000) {
        await chrome.storage.local.remove(RESTORE_KEY);
        return;
      }

      const currentVidId = getCurrentVideoId();
      if (!currentVidId || currentVidId !== pending.videoId) return;

      await chrome.storage.local.remove(RESTORE_KEY);

      const targetTime = Math.max(0, (pending.savedTimestamp || 0) - 3);
      const targetRate = pending.playbackRate || 1;

      const video = getVideoElement();
      if (video) {
        if (video.readyState >= 1) {
          applyRestore(targetTime, targetRate);
        } else {
          video.addEventListener('loadedmetadata', () => applyRestore(targetTime, targetRate), { once: true });
        }
        showToast(`Resumed from stack • ${formatTimestamp(targetTime + 3)}`);
      }
    } catch (e) {}
  }

  function attachVideoEvents() {
    const video = getVideoElement();
    if (!video || activeVideoEl === video) return;
    activeVideoEl = video;

    video.addEventListener('ended', async () => {
      if (!isExtensionValid()) return;
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        const stack = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
        if (stack.length > 0) {
          showAutopopCard(stack[0]);
        }
      } catch (e) {}
    });

    video.addEventListener('play', dismissAutopop);
  }

  /* ==========================================================================
     7. Zero-Cost Event Delegation (Alt+Click & Hotkeys)
     ========================================================================== */

  function isVideoTarget(target) {
    if (!target) return false;
    if (target.closest('input, textarea, [contenteditable="true"], .ytp-settings-menu, .ytp-contextmenu')) {
      return false;
    }
    return Boolean(
      target.closest('video') ||
      target.closest('#movie_player') ||
      target.closest('.html5-video-player') ||
      target.closest('ytd-player') ||
      target.closest('#player-container') ||
      target.closest('ytd-watch-metadata #title') ||
      target.closest('h1.ytd-watch-metadata')
    );
  }

  function handleDocumentClick(e) {
    // 0ms Fast bailout: If neither Alt nor Shift is held, return immediately
    if (!e.altKey && !e.shiftKey) return;
    if (e.button !== 0) return;

    // Ignore clicks inside our own Shadow Root
    if (hostEl && (e.target === hostEl || hostEl.contains(e.target))) return;

    const isAlt = e.altKey;
    const isShiftOnly = e.shiftKey && !e.altKey && !e.ctrlKey;
    const currentVidId = getCurrentVideoId();

    // 1. Alt+Clicking a video link/thumbnail:
    if (isAlt) {
      const link = e.target.closest('a[href*="/watch"], a[href*="/shorts/"], a[href*="/live/"]');
      if (link && link.href) {
        const targetId = extractVideoId(link.href);
        if (targetId && targetId !== currentVidId) {
          // Prevent Chrome from triggering native "Download link destination (watch.html)"
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          pushActiveVideo({ pause: true, showNotification: false });

          // Dispatch clean synthetic click on the link without Alt modifier so YouTube routes via SPA
          const clickEvt = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false
          });
          link.dispatchEvent(clickEvt);
          return;
        }
      }
    }

    // 2. Alt+Click or Shift+Click on the running video player:
    if ((isAlt || isShiftOnly) && isWatchPage()) {
      if (isVideoTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        pushActiveVideo({ pause: true, showNotification: true });
      }
    }
  }

  function handleDocumentKeydown(e) {
    if (!e.altKey) return;

    const target = e.target;
    const tag = (target && target.tagName ? target.tagName.toLowerCase() : '');
    if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) {
      return;
    }

    if (e.key === 'p' || e.key === 'P' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      popTopFrame(0);
      return;
    }

    if (e.key === 's' || e.key === 'S' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      e.stopPropagation();
      pushActiveVideo({ pause: true, showNotification: true });
      return;
    }
  }

  /* ==========================================================================
     8. Encapsulated Shadow DOM UI (Zero Global CSS & Zero Layout Thrashing)
     ========================================================================== */

  function ensureShadowRoot() {
    if (shadowRoot && hostEl && hostEl.isConnected) return shadowRoot;

    const existing = document.getElementById('yt-callstack-host');
    if (existing) existing.remove();

    hostEl = document.createElement('div');
    hostEl.id = 'yt-callstack-host';
    hostEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      pointer-events: auto;
      font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      line-height: 1.4;
      color: #f1f1f1;
    `;

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* Floating Dock Pill */
      .ytcs-dock-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #0f0f0f;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 4px 10px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        user-select: none;
        transition: transform 0.15s ease, border-color 0.15s ease;
      }
      .ytcs-dock-pill:hover {
        border-color: rgba(255, 255, 255, 0.3);
      }

      .ytcs-pill-title-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: none;
        color: #f1f1f1;
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        padding: 4px 2px;
      }
      .ytcs-pill-title-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }

      .ytcs-depth-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 6px;
        background: rgba(255, 255, 255, 0.12);
        color: #aaaaaa;
        border-radius: 9px;
        font-size: 11px;
        font-weight: 600;
      }
      .ytcs-depth-chip.has-items {
        background: #3ea6ff;
        color: #0f0f0f;
      }

      .ytcs-pill-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: rgba(255, 255, 255, 0.08);
        border: none;
        border-radius: 12px;
        color: #f1f1f1;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.12s ease;
      }
      .ytcs-pill-action:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
      }
      .ytcs-pill-action:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .ytcs-pill-action svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
      }

      /* Expanded Panel */
      .ytcs-panel {
        width: 320px;
        max-height: 480px;
        background: #0f0f0f;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.75);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: ytcs-panel-appear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes ytcs-panel-appear {
        from { opacity: 0; transform: translateY(10px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .ytcs-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #181818;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .ytcs-panel-header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: #f1f1f1;
      }
      .ytcs-panel-header-title svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }

      .ytcs-panel-header-btns {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ytcs-icon-btn {
        background: transparent;
        border: none;
        color: #aaaaaa;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s ease, color 0.12s ease;
      }
      .ytcs-icon-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
      .ytcs-icon-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }

      /* Actions Bar */
      .ytcs-panel-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #121212;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .ytcs-panel-action-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 14px;
        color: #f1f1f1;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .ytcs-panel-action-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
      }
      .ytcs-panel-action-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }
      .ytcs-panel-action-btn svg {
        width: 13px;
        height: 13px;
        fill: currentColor;
      }

      /* Frame List */
      .ytcs-panel-body {
        padding: 6px;
        overflow-y: auto;
        max-height: 340px;
      }

      .ytcs-empty {
        text-align: center;
        padding: 24px 16px;
        color: #aaaaaa;
      }
      .ytcs-empty-icon {
        width: 28px;
        height: 28px;
        margin: 0 auto 8px;
        color: #717171;
      }
      .ytcs-empty-icon svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }
      .ytcs-empty-title {
        font-size: 12px;
        font-weight: 500;
        color: #f1f1f1;
        margin-bottom: 4px;
      }
      .ytcs-empty-desc {
        font-size: 11px;
        line-height: 1.4;
      }

      .ytcs-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s ease;
        margin-bottom: 2px;
      }
      .ytcs-item:hover {
        background: #212121;
      }
      .ytcs-item.is-top {
        background: rgba(255, 255, 255, 0.04);
        border-left: 2px solid #3ea6ff;
      }

      .ytcs-item-thumb-box {
        position: relative;
        width: 64px;
        height: 36px;
        border-radius: 4px;
        overflow: hidden;
        background: #000;
        flex-shrink: 0;
      }
      .ytcs-item-thumb {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .ytcs-item-time {
        position: absolute;
        bottom: 2px;
        right: 2px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        font-size: 9px;
        font-weight: 500;
        padding: 1px 3px;
        border-radius: 2px;
      }

      .ytcs-item-info {
        flex: 1;
        min-width: 0;
      }
      .ytcs-item-title {
        font-size: 11px;
        font-weight: 400;
        color: #f1f1f1;
        line-height: 1.3;
        max-height: 2.6em;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        margin-bottom: 2px;
      }
      .ytcs-item-meta {
        font-size: 10px;
        color: #aaaaaa;
      }

      .ytcs-item-del-btn {
        background: transparent;
        border: none;
        color: #717171;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.12s ease;
        flex-shrink: 0;
      }
      .ytcs-item-del-btn:hover {
        color: #ff4e4e;
      }
      .ytcs-item-del-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }

      /* Toast Notification */
      .ytcs-toast {
        position: fixed;
        bottom: 24px;
        left: 24px;
        background: #0f0f0f;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 10px 14px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 340px;
        animation: ytcs-panel-appear 0.18s ease;
      }
      .ytcs-toast-text {
        font-size: 12px;
        color: #f1f1f1;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ytcs-toast-btn {
        background: transparent;
        border: none;
        color: #3ea6ff;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-transform: uppercase;
        padding: 0;
      }
      .ytcs-toast-btn:hover {
        color: #60b4ff;
      }

      /* Autopop Card */
      .ytcs-autopop {
        position: fixed;
        bottom: 74px;
        right: 24px;
        width: 300px;
        background: #0f0f0f;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.7);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        animation: ytcs-panel-appear 0.2s ease;
      }
      .ytcs-autopop-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #aaaaaa;
        font-weight: 600;
      }
      .ytcs-autopop-title {
        font-size: 12px;
        color: #f1f1f1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ytcs-autopop-bar {
        width: 100%;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 1.5px;
        overflow: hidden;
      }
      .ytcs-autopop-fill {
        height: 100%;
        width: 100%;
        background: #3ea6ff;
        transition: width 0.05s linear;
      }
      .ytcs-autopop-btns {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .ytcs-btn-subtle {
        background: transparent;
        border: none;
        color: #aaaaaa;
        font-family: inherit;
        font-size: 11px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 12px;
      }
      .ytcs-btn-subtle:hover { color: #ffffff; }
      .ytcs-btn-solid {
        background: #f1f1f1;
        color: #0f0f0f;
        border: none;
        border-radius: 12px;
        padding: 4px 10px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .ytcs-btn-solid:hover { background: #ffffff; }
    `;

    shadowRoot.appendChild(style);

    const uiContainer = document.createElement('div');
    uiContainer.id = 'ytcs-ui-root';
    shadowRoot.appendChild(uiContainer);

    document.body.appendChild(hostEl);
    return shadowRoot;
  }

  function renderDock() {
    ensureShadowRoot();
    const uiRoot = shadowRoot.getElementById('ytcs-ui-root');
    if (!uiRoot) return;

    const depth = currentStack.length;

    if (isDockCollapsed) {
      uiRoot.innerHTML = `
        <div class="ytcs-dock-pill">
          <button class="ytcs-pill-title-btn" id="ytcs-toggle-expand" title="Open YouTube Call Stack">
            <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
            <span>Stack</span>
            <span class="ytcs-depth-chip ${depth > 0 ? 'has-items' : ''}">${depth}</span>
          </button>
          <button class="ytcs-pill-action" id="ytcs-quick-push" title="Push running video to stack (Alt+S)">
            <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>Save</span>
          </button>
          <button class="ytcs-pill-action" id="ytcs-quick-pop" ${depth === 0 ? 'disabled' : ''} title="Pop top video and return (Alt+P)">
            <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            <span>Pop</span>
          </button>
        </div>
      `;

      shadowRoot.getElementById('ytcs-toggle-expand').addEventListener('click', () => {
        isDockCollapsed = false;
        chrome.storage.local.set({ [DOCK_COLLAPSED_KEY]: false });
        renderDock();
      });

      shadowRoot.getElementById('ytcs-quick-push').addEventListener('click', () => {
        pushActiveVideo({ pause: true, showNotification: true });
      });

      const popBtn = shadowRoot.getElementById('ytcs-quick-pop');
      if (popBtn && depth > 0) {
        popBtn.addEventListener('click', () => popTopFrame(0));
      }
      return;
    }

    // Expanded View
    let itemsHtml = '';
    if (depth === 0) {
      itemsHtml = `
        <div class="ytcs-empty">
          <div class="ytcs-empty-icon">
            <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
          </div>
          <div class="ytcs-empty-title">Call Stack is empty</div>
          <div class="ytcs-empty-desc">
            Save running video with <kbd style="background:rgba(255,255,255,0.1); padding:1px 4px; border-radius:3px;">Alt+Click</kbd> or <kbd style="background:rgba(255,255,255,0.1); padding:1px 4px; border-radius:3px;">Alt+S</kbd> before exploring new topics.
          </div>
        </div>
      `;
    } else {
      currentStack.forEach((frame, idx) => {
        const isTop = idx === 0;
        const timeStr = formatTimestamp(frame.savedTimestamp);
        const speed = frame.playbackRate || 1;

        itemsHtml += `
          <div class="ytcs-item ${isTop ? 'is-top' : ''}" data-index="${idx}" title="Click to resume this video">
            <div class="ytcs-item-thumb-box">
              <img class="ytcs-item-thumb" src="${frame.thumbnail}" alt="" loading="lazy" />
              <span class="ytcs-item-time">${timeStr}</span>
            </div>
            <div class="ytcs-item-info">
              <div class="ytcs-item-title">${escapeHtml(frame.title)}</div>
              <div class="ytcs-item-meta">${timeStr} ${speed !== 1 ? `• ${speed}x` : ''}</div>
            </div>
            <button class="ytcs-item-del-btn" data-action="delete" data-index="${idx}" title="Remove from stack">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
      });
    }

    uiRoot.innerHTML = `
      <div class="ytcs-panel">
        <div class="ytcs-panel-header">
          <div class="ytcs-panel-header-title">
            <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
            <span>Call Stack</span>
            <span class="ytcs-depth-chip ${depth > 0 ? 'has-items' : ''}">${depth}</span>
          </div>
          <div class="ytcs-panel-header-btns">
            ${depth > 0 ? `<button class="ytcs-icon-btn" id="ytcs-btn-clear" title="Clear all frames"><svg viewBox="0 0 24 24"><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg></button>` : ''}
            <button class="ytcs-icon-btn" id="ytcs-btn-minimize" title="Collapse"><svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg></button>
          </div>
        </div>
        <div class="ytcs-panel-actions">
          <button class="ytcs-panel-action-btn" id="ytcs-panel-push" title="Push running video (Alt+S)">
            <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>Save Video</span>
          </button>
          <button class="ytcs-panel-action-btn" id="ytcs-panel-pop" ${depth === 0 ? 'disabled' : ''} title="Pop top video (Alt+P)">
            <svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            <span>Pop Top</span>
          </button>
        </div>
        <div class="ytcs-panel-body">${itemsHtml}</div>
      </div>
    `;

    shadowRoot.getElementById('ytcs-btn-minimize').addEventListener('click', () => {
      isDockCollapsed = true;
      chrome.storage.local.set({ [DOCK_COLLAPSED_KEY]: true });
      renderDock();
    });

    const clearBtn = shadowRoot.getElementById('ytcs-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear Call Stack?')) clearStack();
      });
    }

    shadowRoot.getElementById('ytcs-panel-push').addEventListener('click', () => {
      pushActiveVideo({ pause: true, showNotification: true });
    });

    const popTopBtn = shadowRoot.getElementById('ytcs-panel-pop');
    if (popTopBtn && depth > 0) {
      popTopBtn.addEventListener('click', () => popTopFrame(0));
    }

    const items = shadowRoot.querySelectorAll('.ytcs-item');
    items.forEach((item) => {
      const idx = parseInt(item.getAttribute('data-index'), 10);
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete"]')) return;
        popTopFrame(idx);
      });

      const delBtn = item.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeFrame(idx);
        });
      }
    });
  }

  /* ==========================================================================
     9. Feedback Toast & Autopop Inside Shadow DOM
     ========================================================================== */

  let toastDismissTimer = null;

  function showToast(text, actionText = null, actionCallback = null) {
    ensureShadowRoot();
    const existing = shadowRoot.getElementById('ytcs-toast');
    if (existing) existing.remove();

    if (toastDismissTimer) clearTimeout(toastDismissTimer);

    const toast = document.createElement('div');
    toast.id = 'ytcs-toast';
    toast.className = 'ytcs-toast';

    let btnHtml = '';
    if (actionText && actionCallback) {
      btnHtml = `<button class="ytcs-toast-btn" id="ytcs-toast-act">${escapeHtml(actionText)}</button>`;
    }

    toast.innerHTML = `
      <span class="ytcs-toast-text">${escapeHtml(text)}</span>
      ${btnHtml}
    `;

    shadowRoot.appendChild(toast);

    if (actionText && actionCallback) {
      const btn = toast.querySelector('#ytcs-toast-act');
      if (btn) {
        btn.addEventListener('click', () => {
          toast.remove();
          actionCallback();
        });
      }
    }

    toastDismissTimer = setTimeout(() => {
      if (toast && toast.parentNode) toast.remove();
      toastDismissTimer = null;
    }, 3200);
  }

  function showAutopopCard(targetFrame) {
    dismissAutopop();
    ensureShadowRoot();

    const card = document.createElement('div');
    card.id = 'ytcs-autopop';
    card.className = 'ytcs-autopop';

    const timeStr = formatTimestamp(targetFrame.savedTimestamp);

    card.innerHTML = `
      <div class="ytcs-autopop-label">Next in Call Stack</div>
      <div class="ytcs-autopop-title">${escapeHtml(targetFrame.title)} • ${timeStr}</div>
      <div class="ytcs-autopop-bar">
        <div id="ytcs-autopop-bar-fill" class="ytcs-autopop-fill"></div>
      </div>
      <div class="ytcs-autopop-btns">
        <button id="ytcs-autopop-stay" class="ytcs-btn-subtle">Stay</button>
        <button id="ytcs-autopop-now" class="ytcs-btn-solid">Pop Now</button>
      </div>
    `;

    shadowRoot.appendChild(card);

    const nowBtn = card.querySelector('#ytcs-autopop-now');
    const stayBtn = card.querySelector('#ytcs-autopop-stay');
    const barFill = card.querySelector('#ytcs-autopop-bar-fill');

    nowBtn.addEventListener('click', () => popTopFrame(0));
    stayBtn.addEventListener('click', dismissAutopop);

    const duration = 3000;
    const start = Date.now();

    autopopInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, duration - elapsed);
      if (barFill) {
        barFill.style.width = `${(remaining / duration) * 100}%`;
      }
      if (remaining <= 0) {
        dismissAutopop();
        popTopFrame(0);
      }
    }, 50);
  }

  function dismissAutopop() {
    if (autopopInterval) {
      clearInterval(autopopInterval);
      autopopInterval = null;
    }
    if (shadowRoot) {
      const card = shadowRoot.getElementById('ytcs-autopop');
      if (card) card.remove();
    }
  }

  /* ==========================================================================
     10. Lifecycle & Clean Hooks (Zero Polling Loops)
     ========================================================================== */

  function onPageTransition() {
    dismissAutopop();
    attachVideoEvents();
    checkAndApplyPendingRestore();
    renderDock();
  }

  // Hook YouTube's native client-side SPA navigation events
  window.addEventListener('yt-navigate-finish', onPageTransition);
  window.addEventListener('yt-page-data-updated', onPageTransition);
  window.addEventListener('popstate', onPageTransition);

  // Fast event delegation
  document.addEventListener('click', handleDocumentClick, true);
  window.addEventListener('keydown', handleDocumentKeydown, true);

  // Cross-context messaging
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TRIGGER_POP') {
      popTopFrame(0).then(() => sendResponse({ handled: true }));
      return true;
    }
    if (message.action === 'TRIGGER_PUSH') {
      pushActiveVideo({ pause: true, showNotification: true }).then(() => sendResponse({ success: true }));
      return true;
    }
  });

  // Initial load
  loadState();
  onPageTransition();
})();
