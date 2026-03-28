# Element Monitor

A Chrome/Edge browser extension that monitors web page element changes and sends system notifications when changes are detected.

## Features

- **Element Selection** - DevTools-like page element picker, or select via right-click context menu
- **Scheduled Monitoring** - Polling intervals from 5 seconds to 1 month, or manual check only
- **Change Notifications** - System notifications + extension badge showing change count
- **Data Sync** - Automatic data sync across devices with the same account
- **Task Search** - Real-time search and filter tasks

## Screenshots

|         Popup Interface          |           Element Picker           |            Save Dialog             |
| :------------------------------: | :--------------------------------: | :--------------------------------: |
| ![Popup](./screenshot/popup.jpg) | ![Picker](./screenshot/picker.jpg) | ![Dialog](./screenshot/dialog.jpg) |

## Quick Start

1. Click the extension icon, then click the element picker button
2. Click on the element you want to monitor on the page
3. Set task name and polling interval, then save
4. You'll receive a system notification when the element changes

## Polling Intervals

5s, 10s, 30s, 1m, 3m, 5m, 10m, 30m, 1h, 6h, 12h, 1d, 1w, 1M, Manual

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
│   ├── content.js
│   └── picker.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Main APIs

| API                  | Usage                                 |
| -------------------- | ------------------------------------- |
| chrome.storage.sync  | Task data storage (cross-device sync) |
| chrome.alarms        | Scheduled task management             |
| chrome.notifications | System notifications                  |
| chrome.tabs          | Tab management                        |
| chrome.scripting     | Script injection                      |
| chrome.contextMenus  | Right-click context menu              |

## Data Structure

```javascript
{
  id: "task_xxx",
  url: "https://example.com",
  selector: "#content",
  name: "Task Name",
  interval: 300,
  lastValue: "<p>...</p>",
  lastCheck: 1234567890,
  status: "active",
  hasChanged: false,
  createdAt: 1234567890
}
```

## Compatibility

- Chrome / Edge browser
- Manifest V3
- Windows / macOS / Linux

---

[中文文档](./README_CN.md)
