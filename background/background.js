// Background service worker for Element Monitor extension

// Hidden tab for checking elements
let checkerTab = null;

// i18n helper
const i18n = {
  get: (key, sub) => chrome.i18n.getMessage(key, sub) || key
};

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Element Monitor extension installed');

  // Try sync storage first, migrate from local if needed
  let { tasks = null } = await chrome.storage.sync.get('tasks');
  
  if (!tasks) {
    // Check local storage for migration
    const localData = await chrome.storage.local.get('tasks');
    if (localData.tasks && localData.tasks.length > 0) {
      tasks = localData.tasks;
      await chrome.storage.sync.set({ tasks });
      console.log('Migrated tasks from local to sync storage');
    } else {
      tasks = [];
      await chrome.storage.sync.set({ tasks });
    }
  }

  // Create context menu
  chrome.contextMenus.create({
    id: 'monitor-element',
    title: i18n.get('contextMenuSelectElement'),
    contexts: ['all']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'monitor-element') {
    try {
      // Inject picker script (same as popup button)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/picker.js']
      });

      // Send message to start picking
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PICKING' });
    } catch (error) {
      console.error('Error starting picker:', error);
      await chrome.notifications.create('picker-error', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: i18n.get('errorTitle'),
        message: i18n.get('errorPickerFailed') + error.message,
        priority: 1
      });
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ADD_TASK':
      handleAddTask(message.task);
      break;
    case 'SAVE_TASK':
      handleSaveTask(message.task);
      break;
    case 'TOGGLE_TASK':
      handleToggleTask(message.taskId, message.status);
      break;
    case 'UPDATE_INTERVAL':
      handleUpdateInterval(message.taskId, message.interval, message.status);
      break;
    case 'CHECK_NOW':
      handleCheckNow(message.taskId);
      break;
    case 'DELETE_TASK':
      handleDeleteTask(message.taskId);
      break;
    case 'ELEMENT_VALUE':
      handleElementValue(message);
      break;
    case 'ELEMENT_SELECTED':
      handleElementSelected(message);
      break;
    case 'ELEMENT_PICK_CANCELLED':
      handleElementPickCancelled();
      break;
  }
  
  return false;
});

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('monitor_')) {
    const taskId = alarm.name.replace('monitor_', '');
    await checkTask(taskId);
  }
});

// Handle add task
async function handleAddTask(task) {
  // Create alarm for this task
  await createAlarmForTask(task);

  // Do initial check
  await checkTask(task.id);
}

// Handle save task from picker dialog
async function handleSaveTask(taskData) {
  const task = {
    id: `task_${Date.now()}`,
    url: taskData.url,
    selector: taskData.selector,
    interval: taskData.interval === 0 ? 0 : Math.max(5, taskData.interval),
    name: taskData.name || new URL(taskData.url).hostname,
    lastValue: null,
    lastCheck: null,
    status: taskData.interval === 0 ? 'paused' : 'active',
    createdAt: Date.now()
  };

  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  tasks.push(task);
  await chrome.storage.sync.set({ tasks });

  // Create alarm if not manual
  if (task.interval > 0) {
    await createAlarmForTask(task);
    await checkTask(task.id);
  }

  // Show success notification
  const statusText = task.interval === 0 
    ? i18n.get('notificationTaskCreatedManual')
    : i18n.get('notificationTaskStarted');
  
  await chrome.notifications.create('task-saved', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: i18n.get('notificationTaskSaved'),
    message: `"${task.name}" ${statusText}`,
    priority: 2
  });
}

// Handle toggle task
async function handleToggleTask(taskId, status) {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) return;

  if (status === 'active') {
    await createAlarmForTask(task);
  } else {
    await chrome.alarms.clear(`monitor_${taskId}`);
  }
}

// Handle update interval
async function handleUpdateInterval(taskId, interval, status) {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) return;

  // Clear existing alarm
  await chrome.alarms.clear(`monitor_${taskId}`);

  // Create new alarm if active and interval > 0
  if (status === 'active' && interval > 0) {
    task.interval = interval;
    await createAlarmForTask(task);
  }
}

// Handle check now
async function handleCheckNow(taskId) {
  await checkTask(taskId);
}

// Handle delete task
async function handleDeleteTask(taskId) {
  await chrome.alarms.clear(`monitor_${taskId}`);
}

// Handle element selected from picker
async function handleElementSelected(message) {
  // Clear picking state
  await chrome.storage.local.remove('pickingState');

  // Store selected element
  await chrome.storage.local.set({
    selectedElement: {
      selector: message.selector,
      url: message.url,
      tagName: message.tagName,
      text: message.text,
      timestamp: Date.now()
    }
  });

  // Notify user to click extension icon
  await chrome.notifications.create('element-selected', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: i18n.get('notificationTitle'),
    message: i18n.get('notificationClickToAdd') + message.selector,
    priority: 2
  });
}

// Handle element pick cancelled
async function handleElementPickCancelled() {
  await chrome.storage.local.remove('pickingState');
}

// Create alarm for a task
async function createAlarmForTask(task) {
  const alarmName = `monitor_${task.id}`;
  const intervalMinutes = Math.max(task.interval / 60, 0.1);

  await chrome.alarms.create(alarmName, {
    periodInMinutes: intervalMinutes
  });
}

// Check a task
async function checkTask(taskId) {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) return;

  let tab = null;
  
  try {
    // Check if we have a reusable checker tab
    if (checkerTab) {
      try {
        await chrome.tabs.get(checkerTab.id);
        tab = checkerTab;
      } catch (e) {
        checkerTab = null;
      }
    }
    
    // Create a new tab if needed
    if (!tab) {
      tab = await chrome.tabs.create({
        url: task.url,
        active: false
      });
      checkerTab = tab;
    } else {
      await chrome.tabs.update(tab.id, { url: task.url });
    }

    // Wait for the tab to load completely
    await waitForTabLoad(tab.id);

    // Wait additional time for dynamic content
    await sleep(2000);

    // Execute script to get element value with retry
    const currentValue = await getElementWithRetry(tab.id, task.selector, 3);

    // Process the result
    if (currentValue !== null) {
      await processElementValue(task, currentValue, tasks);
    } else {
      console.warn(`Element not found: ${task.selector} on ${task.url}`);
    }
  } catch (error) {
    console.error('Error checking task:', error);
  }
}

// Wait for tab to load
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;

    const listener = (changedTabId, changeInfo) => {
      if (changedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 60000);
  });
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get element with retry
async function getElementWithRetry(tabId, selector, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: getElementValue,
        args: [selector]
      });

      if (results && results[0] && results[0].result !== null) {
        return results[0].result;
      }

      if (i < maxRetries - 1) {
        console.log(`Element not found, retrying... (${i + 1}/${maxRetries})`);
        await sleep(1500);
      }
    } catch (error) {
      console.error(`Error getting element (attempt ${i + 1}):`, error);
      if (i < maxRetries - 1) {
        await sleep(1500);
      }
    }
  }
  return null;
}

// Function to be executed in the target page
function getElementValue(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    return null;
  }
  return element.innerHTML;
}

// Process element value
async function processElementValue(task, currentValue, tasks) {
  const previousValue = task.lastValue;

  task.lastCheck = Date.now();
  task.lastValue = currentValue;

  const hasChanged = previousValue !== null && previousValue !== currentValue;
  if (hasChanged) {
    task.hasChanged = true;
  }

  const taskIndex = tasks.findIndex(t => t.id === task.id);
  if (taskIndex !== -1) {
    tasks[taskIndex] = task;
    await chrome.storage.sync.set({ tasks });
  }

  if (hasChanged) {
    console.log(`Element changed for task: ${task.name}`);
    await sendChangeNotification(task, currentValue);
    await updateBadge();
  }
}

// Update extension badge with changed count
async function updateBadge(taskList) {
  let tasks = taskList;
  if (!tasks) {
    const stored = await chrome.storage.sync.get('tasks');
    tasks = stored.tasks || [];
  }
  
  const changedCount = tasks.filter(t => t.hasChanged).length;

  if (changedCount > 0) {
    chrome.action.setBadgeText({ text: changedCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Send change notification
async function sendChangeNotification(task, currentValue) {
  const truncate = (str, len = 80) => {
    const cleaned = str ? str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : i18n.get('emptyPreview');
    return cleaned.length > len ? cleaned.substring(0, len) + '...' : cleaned;
  };

  const currText = truncate(currentValue);
  const notificationId = `change_${task.id}_${Date.now()}`;
  
  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: task.name,
      message: currText,
      priority: 2,
      silent: false
    });
    console.log('Notification created successfully:', notificationId);
  } catch (error) {
    console.error('Failed to create notification:', error);
  }

  // Store notification data for click handling
  await chrome.storage.local.set({
    [`notification_${notificationId}`]: {
      taskId: task.id,
      taskUrl: task.url
    }
  });
}

// Handle notification click
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const data = await chrome.storage.local.get(`notification_${notificationId}`);
  const notifyData = data[`notification_${notificationId}`];

  if (notifyData) {
    if (notifyData.taskId) {
      const { tasks = [] } = await chrome.storage.sync.get('tasks');
      const task = tasks.find(t => t.id === notifyData.taskId);
      if (task) {
        task.hasChanged = false;
        await chrome.storage.sync.set({ tasks });
        await updateBadge();
      }
    }

    chrome.tabs.create({ url: notifyData.taskUrl });
    chrome.notifications.clear(notificationId);
    chrome.storage.local.remove(`notification_${notificationId}`);
  }
});

// Handle notification button click
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const data = await chrome.storage.local.get(`notification_${notificationId}`);
  const notifyData = data[`notification_${notificationId}`];

  if (buttonIndex === 0 && notifyData) {
    if (notifyData.taskId) {
      const { tasks = [] } = await chrome.storage.sync.get('tasks');
      const task = tasks.find(t => t.id === notifyData.taskId);
      if (task) {
        task.hasChanged = false;
        await chrome.storage.sync.set({ tasks });
        await updateBadge();
      }
    }

    chrome.tabs.create({ url: notifyData.taskUrl });
  }
  chrome.notifications.clear(notificationId);
  chrome.storage.local.remove(`notification_${notificationId}`);
});

// Restore alarms on startup
chrome.runtime.onStartup.addListener(async () => {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');

  for (const task of tasks) {
    if (task.status === 'active') {
      await createAlarmForTask(task);
    }
  }

  updateBadge(tasks);
});

// Also restore alarms when service worker starts (for MV3)
(async () => {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');

  for (const task of tasks) {
    if (task.status === 'active') {
      const existingAlarm = await chrome.alarms.get(`monitor_${task.id}`);
      if (!existingAlarm) {
        await createAlarmForTask(task);
      }
    }
  }

  updateBadge(tasks);
})();
