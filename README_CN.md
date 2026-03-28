# 网页监听器 (Element Monitor)

一款 Chrome/Edge 浏览器扩展，用于监听指定网页元素的变化，并在检测到变化时发送系统通知。

## 功能特性

- **元素选择** - 类似 DevTools 的页面元素选择器，或通过右键菜单选择
- **定时监听** - 支持 5秒 ~ 1月 的轮询间隔，或仅手动检查
- **变化通知** - 系统通知 + 扩展图标 Badge 显示变化数量
- **数据同步** - 同一账号下多设备数据自动同步
- **任务搜索** - 实时搜索筛选任务

## 截图展示

|            弹窗界面             |             元素选择器             |             保存对话框             |
| :-----------------------------: | :--------------------------------: | :--------------------------------: |
| ![弹窗](./screenshot/popup.jpg) | ![选择器](./screenshot/picker.jpg) | ![对话框](./screenshot/dialog.jpg) |

## 快速使用

1. 点击扩展图标，再点击元素选择按钮
2. 在页面上点击要监听的元素
3. 设置任务名称和轮询间隔，保存
4. 元素变化时会收到系统通知

## 轮询间隔选项

5秒、10秒、30秒、1分钟、3分钟、5分钟、10分钟、30分钟、1小时、6小时、12小时、1天、1周、1月、手动

## 项目结构

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

## 主要 API

| API                  | 用途                       |
| -------------------- | -------------------------- |
| chrome.storage.sync  | 任务数据存储（跨设备同步） |
| chrome.alarms        | 定时任务调度               |
| chrome.notifications | 系统通知                   |
| chrome.tabs          | 标签页管理                 |
| chrome.scripting     | 脚本注入                   |
| chrome.contextMenus  | 右键菜单                   |

## 数据结构

```javascript
{
  id: "task_xxx",
  url: "https://example.com",
  selector: "#content",
  name: "任务名称",
  interval: 300,
  lastValue: "<p>...</p>",
  lastCheck: 1234567890,
  status: "active",
  hasChanged: false,
  createdAt: 1234567890
}
```

## 兼容性

- Chrome / Edge 浏览器
- Manifest V3
- Windows / macOS / Linux

---

[English Documentation](./README.md)
