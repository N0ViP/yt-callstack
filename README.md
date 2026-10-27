# yt-callstack

> **LIFO (Last-In, First-Out) Call-Stack Video Manager for YouTube**  
> Built for deep-dive technical learning, tutorials, and research rabbit holes.

`yt-callstack` treats your YouTube exploration like a programmer's execution call stack. When watching a technical talk or tutorial and you encounter an unfamiliar topic, **push** the current video to your stack and branch into the rabbit hole. When the rabbit hole video ends (or whenever you decide), **pop** the stack to return to your parent video exactly where you left off, preserving your playback speed and mental context.

---

## Key Features

### 1. Pushing to the Stack (Branching into Rabbit Holes)
- **`Alt + Click` Running Video (Save Before Searching)**: Hold `Alt` and click the video player (or video title) of the video you are currently watching. It pauses playback and immediately pushes your current video with timestamp and playback rate to your Call Stack without navigating away. You are now free to use YouTube's search bar to look up any topic without losing your running video!
- **Floating Call Stack Dock**: A sleek, high-performance pill sits at the bottom-right corner of the screen. Click **Save** anytime to push the running video, or click the pill to view your entire call stack.
- **Keyboard Shortcut (`Alt + S` or `Alt + C`)**: Press `Alt + S` on any YouTube page to push the current video without touching the mouse.
- **Linux-Friendly (`Shift + Click`)**: On Linux desktop environments where `Alt + Left Click` is grabbed by the window manager to move windows, `Shift + Click` directly on the player is also supported out-of-the-box!
- **Automatic Deduplication**: If you push the running video multiple times (e.g. as you watch further), the extension updates your saved timestamp and playback position while ensuring the video appears in the stack **only one time**—no clutter or duplicate frames.
- **`Alt + Click` Video Link & Thumbnail Interceptor**: Hold `Alt` and click any video link or thumbnail. The extension immediately captures your current running video, pushes it to your Call Stack, and opens the new video instantly via YouTube's client-side SPA router (zero page reload!).

### 2. Popping the Stack (Returning to Parent Context)
- **Instant Client-Side SPA Navigation**: Pop transitions via YouTube's internal router in ~50-100ms. It **never performs a full browser page reload** (`window.location.href`), eliminating frozen tabs and spinning loaders.
- **Auto-Pop on Video End**: When a video finishes, a clean YouTube-native card appears:
  > *"Next in Call Stack: [Parent Video Title] • [MM:SS] in 3s... [Pop Now] [Stay]"*
- **Global Hotkeys**:
  - `Alt + P` or `Alt + Backspace`: Instantly pops the top frame and returns to your previous video.
- **Context Preservation**:
  - Automatically seeks to `savedTimestamp - 3s` (a 3-second rewind buffer to restore mental focus).
  - Restores your exact playback speed (e.g. `1.25x`, `1.5x`, `2.0x`).

### 3. Encapsulated Shadow DOM Architecture (Zero Performance Impact)
- **100% Shadow DOM**: The extension's UI is completely isolated inside a Shadow Root.
- **Zero Layout Thrashing**: Does NOT inject elements into YouTube's internal `#secondary` or flex containers, eliminating all sticky-sidebar layout recomputations and scroll lag.
- **Zero Full-DOM Mutation Observers**: Operates purely on YouTube's native lifecycle events (`yt-navigate-finish`, `yt-page-data-updated`).
- **Collapsible Dock**: Takes up minimal screen space when collapsed; expands on click to reveal stack frames, timestamps, and quick actions.

### 4. Extension Popup & Toolbar Badge
- Real-time stack depth badge on the extension icon in Chrome's toolbar.
- Clean popup interface showing current stack frames, active video details, manual push button, and hotkeys reference.

---

## Installation Instructions

This extension is built with **Manifest V3** and vanilla modern JavaScript (ES6+) with zero build steps or external dependencies.

1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the project directory:
   ```
   /home/n0vip/Desktop/projects/yt-callstack
   ```
6. The `yt-callstack` extension is now installed and active! Pin it to your Chrome toolbar for quick access.

> [!IMPORTANT]
> **After code updates or reloading**:
> 1. Go to `chrome://extensions`, click the **Reload** icon (🔄) on the `yt-callstack` card.
> 2. If an "Errors" button appears from an old session, click the trash can icon (🗑️) to clear the historical log.
> 3. **Hard-refresh any open YouTube tabs** (`Ctrl + Shift + R` or `F5`) so the new content script runs.

---

## Keyboard & UI Shortcuts Reference

| Shortcut / Control | Action | Scope |
| :--- | :--- | :--- |
| **Player Control Bar Button** | Push running video to Call Stack without navigating | YouTube player bottom bar |
| `Alt` + `S` or `Alt` + `C` | Push running video to Call Stack without navigating | YouTube tab & Chrome Command |
| `Alt` + **Click** (Running Video) | Push/update running video to stack (deduplicated) | YouTube player / watch page |
| `Shift` + **Click** (Running Video)| Alternative for Linux (avoids OS window-drag conflict) | YouTube player / watch page |
| `Alt` + **Click** (Video Link) | Intercept video link, push current video, and branch | Any YouTube link |
| `Alt` + `P` | Pop top video from stack and return with -3s buffer | YouTube tab & Global Chrome Command |
| `Alt` + `Backspace` | Pop top video from stack and return with -3s buffer | YouTube tab |

---

## File Architecture

```
yt-callstack/
├── manifest.json       # Manifest V3 configuration, permissions, content scripts & commands
├── background.js      # Service worker for cross-tab sync, badge depth counter & hotkeys
├── content.js         # Injected script: SPA observer, player controller, widget & toast UI
├── styles.css         # YouTube-native dark theme styles, animations, and responsive layout
├── popup.html         # Toolbar popup interface
├── popup.js           # Toolbar popup controller and active-tab video management
├── icons/             # Clean pixel-aligned extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # Documentation and reference guide
```

---

## 🔬 SPA & Edge Case Engineering

- **Polymer SPA Transitions**: Rather than relying on static `window.onload`, the extension listens to YouTube's native `yt-navigate-finish`, `yt-page-data-updated`, and `popstate` events.
- **Asynchronous Element Injection**: Employs efficient DOM `MutationObserver` throttling with `requestAnimationFrame` to detect and mount into `#secondary #secondary-inner` without DOM thrashing or layout shifts.
- **Player Resume Clashing**: YouTube often restores playback position asynchronously from its internal history after `loadedmetadata`. The extension applies dual-layer seeking (HTML5 Video Element + `movie_player.seekTo`) and guards the timestamp for the first 1.5 seconds of playback to ensure the user's -3s context position sticks.
