English Documentation | [中文文档](./README_CN.md)

# Element Monitor

A Chrome/Edge browser extension that monitors web page element changes and sends system notifications when changes are detected.

## Features

- **Element Selection** - DevTools-like page element picker, or select via right-click context menu
- **Scheduled Monitoring** - Polling intervals from 1 minute to 1 week, custom minute input, or manual check only
- **Change Notifications** - System notifications + extension badge showing unread change count
- **Notification Click** - Click notification to mark as read, badge count decrements automatically
- **Task Metrics** - Check count, last check time, last changed time per task
- **Smart Scheduling** - Task queue with exclusive lock to prevent concurrent checks; delayed execution when busy
- **User Script** - Custom JavaScript code executed before each check, with built-in jQuery support
- **Task Search** - Real-time search and filter tasks
- **Task Sorting** - Tasks with recent changes shown first, sorted by last changed time

## Screenshots

|         Popup Interface          |           Element Picker           |            Save Dialog             |
| :------------------------------: | :--------------------------------: | :--------------------------------: |
| ![Popup](./screenshot/popup.jpg) | ![Picker](./screenshot/picker.jpg) | ![Dialog](./screenshot/dialog.jpg) |

## Quick Start

1. Click the extension icon, then click the element picker button
2. Click on the element you want to monitor on the page
3. Set task name and polling interval, then save
4. You'll receive a system notification when the element changes
5. Click the notification to open the page and mark the task as read

## Polling Intervals

### Quick Select

1m, 5m, 10m, 30m, 1h, 6h, 12h, 1d, 1w, Manual

### Custom Interval

Enter any number of minutes (1 ~ 525600) with a readable display (e.g., 70 minutes shows "1 hour 10 minutes").

## User Script

Each task can optionally include custom JavaScript code that runs on the target page before the element value is read. Common use cases include:

- Clicking a button to expand hidden content
- Dismissing popups or cookie banners
- Scrolling to load lazy-loaded content
- Waiting for AJAX content to render

### jQuery Support

User scripts have jQuery available automatically. If the target page doesn't already have jQuery, it is injected from CDN before the script runs. Use `$` or `jQuery` directly:

```javascript
// Dismiss a cookie banner
$('.cookie-banner .accept-btn').click();

// Scroll to bottom to trigger lazy loading
$('html, body').scrollTop($(document).height());

// Click a "Load more" button
$('#load-more').click();
```

### Code Editor

The built-in code editor provides:

- **Line numbers** - Synced with scroll position
- **Syntax highlighting** - Keywords, strings, comments, numbers (One Dark theme)
- **Format button** - Auto-indent JavaScript code
- **Tab support** - Tab key inserts 2 spaces

## Task Scheduling

- Uses `chrome.alarms` API for reliable periodic scheduling (minimum 1 minute)
- Service Worker startup only creates missing alarms, preserving existing schedules
- First fire time calculated from `lastCheck` + `interval` to avoid unnecessary waits
- After each check, alarm is rebuilt with accurate next fire time based on `lastCheck`
- Only one task runs at a time; if another task is being checked, the new one is delayed by 5 seconds

## Project Structure

```
element-monitor-extension/
├── manifest.json
├── _locales/
│   ├── en/messages.json
│   └── zh_CN/messages.json
├── background/
│   └── background.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   ├── code-editor.js
│   ├── content.js
│   └── picker.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Main APIs

| API                  | Usage                              |
| -------------------- | ---------------------------------- |
| chrome.storage.local | Task data storage                  |
| chrome.alarms        | Scheduled task management          |
| chrome.notifications | System notifications               |
| chrome.tabs          | Tab management                     |
| chrome.scripting     | Script injection                   |
| chrome.contextMenus  | Right-click context menu           |

## Data Structure

```javascript
{
  id: "task_xxx",
  url: "https://example.com",
  selector: "#content",
  name: "Task Name",
  interval: 300,           // seconds, minimum 60
  lastValue: "<p>...</p>", // innerHTML of the monitored element
  lastCheck: 1234567890,   // timestamp of last check
  lastChangedAt: null,     // timestamp of last content change
  checkCount: 0,           // total number of checks performed
  userScript: null,         // custom JS code (jQuery supported)
  status: "active",        // "active" or "paused"
  hasChanged: false,       // whether unread change exists
  createdAt: 1234567890
}
```

## Compatibility

- Chrome / Edge browser
- Manifest V3
- Windows / macOS / Linux
