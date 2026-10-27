// background.js - yt-callstack Service Worker
// Manages badge depth indicator, global hotkeys, and cross-tab state synchronization.

const STORAGE_KEY = 'ytCallStack';
const RESTORE_KEY = 'ytPendingPopRestore';

/**
 * Updates the extension toolbar badge to reflect current stack depth.
 * @param {Array} stack - Current call stack array
 */
function updateBadge(stack) {
  const depth = Array.isArray(stack) ? stack.length : 0;
  if (depth > 0) {
    chrome.action.setBadgeText({ text: String(depth) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0033' });
    chrome.action.setBadgeTextColor ? chrome.action.setBadgeTextColor({ color: '#FFFFFF' }) : null;
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Initializes badge state from local storage.
 */
async function initializeBadge() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    updateBadge(data[STORAGE_KEY] || []);
  } catch (error) {
    console.warn('[yt-callstack] Notice initializing badge:', error);
  }
}

// React to storage changes (cross-tab synchronization)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY]) {
    updateBadge(changes[STORAGE_KEY].newValue || []);
  }
});

// React to keyboard shortcuts defined in manifest.json
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'pop-stack') {
    await handlePopCommand();
  } else if (command === 'push-active-video') {
    await handlePushCommand();
  }
});

/**
 * Executes a push operation on the active YouTube tab.
 */
async function handlePushCommand() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id || !activeTab.url || !activeTab.url.includes('youtube.com')) return;

    try {
      await chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_PUSH' });
    } catch (err) {
      console.warn('[yt-callstack] Content script not reachable for push command:', err);
    }
  } catch (error) {
    console.warn('[yt-callstack] Notice during handlePushCommand:', error);
  }
}

/**
 * Executes a pop operation when triggered by keyboard command or message.
 */
async function handlePopCommand() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stack = data[STORAGE_KEY] || [];
    if (!stack.length) {
      console.log('[yt-callstack] Pop requested but stack is empty.');
      return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) return;

    // Check if the tab is on YouTube and send a message to content script
    if (activeTab.url && activeTab.url.includes('youtube.com')) {
      try {
        const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_POP' });
        if (response && response.handled) {
          return;
        }
      } catch (err) {
        // Tab might not have content script ready; fallback to background pop execution
      }
    }

    // Fallback: Perform pop directly from background worker
    const poppedFrame = stack[0];
    const remainingStack = stack.slice(1);
    const targetTimestamp = Math.max(0, (poppedFrame.savedTimestamp || 0) - 3);

    await chrome.storage.local.set({
      [STORAGE_KEY]: remainingStack,
      [RESTORE_KEY]: {
        videoId: poppedFrame.videoId,
        savedTimestamp: poppedFrame.savedTimestamp,
        playbackRate: poppedFrame.playbackRate || 1,
        title: poppedFrame.title,
        isPopping: true,
        timestampSetAt: Date.now()
      }
    });

    const targetUrl = new URL(poppedFrame.url);
    targetUrl.searchParams.set('t', `${Math.floor(targetTimestamp)}s`);

    await chrome.tabs.update(activeTab.id, { url: targetUrl.toString() });
  } catch (error) {
    console.warn('[yt-callstack] Notice during handlePopCommand:', error);
  }
}

// Handle runtime messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'POP_TOP_FRAME') {
    handlePopCommand().then(() => sendResponse({ success: true }));
    return true; // Keep message channel open for async response
  }
});

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(() => {
  initializeBadge();
});

chrome.runtime.onStartup.addListener(() => {
  initializeBadge();
});

// Run immediate initialization
initializeBadge();
