// Background service worker for Element Monitor extension

// Hidden tab for checking elements
let checkerTab = null;

// Lock to ensure only one task runs at a time
let isChecking = false;
const CHECK_DELAY_SECONDS = 5;

// i18n helper
const i18n = {
  get: (key, sub) => chrome.i18n.getMessage(key, sub) || key
};

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Element Monitor extension installed');

  // Initialize tasks in local storage if not exists
  const { tasks } = await chrome.storage.local.get('tasks');
  if (!tasks) {
    await chrome.storage.local.set({ tasks: [] });
    console.log('Initialized empty tasks array');
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
        files: ['content/code-editor.js', 'content/picker.js']
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
  console.log('Received message:', message.type, message);

  if (message.type === 'GET_DEBUG_INFO') {
    handleGetDebugInfo().then(sendResponse);
    return true; // Keep channel open for async response
  }

  // Handle async operations - fire and forget
  (async () => {
    try {
      switch (message.type) {
        case 'ADD_TASK':
          await handleAddTask(message.task);
          break;
        case 'SAVE_TASK':
          await handleSaveTask(message.task);
          break;
        case 'TOGGLE_TASK':
          await handleToggleTask(message.taskId, message.status);
          break;
        case 'UPDATE_INTERVAL':
          await handleUpdateInterval(message.taskId, message.interval, message.status);
          break;
        case 'CHECK_NOW':
          await handleCheckNow(message.taskId);
          break;
        case 'DELETE_TASK':
          await handleDeleteTask(message.taskId);
          break;
        case 'ELEMENT_VALUE':
          await handleElementValue(message);
          break;
        case 'ELEMENT_SELECTED':
          await handleElementSelected(message);
          break;
        case 'ELEMENT_PICK_CANCELLED':
          await handleElementPickCancelled();
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  })();

  sendResponse({ ok: true });
  return false;
});

// Handle get debug info
async function handleGetDebugInfo() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const alarms = await chrome.alarms.getAll();
  return {
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      interval: t.interval,
      lastCheck: t.lastCheck ? new Date(t.lastCheck).toISOString() : null
    })),
    alarms: alarms.map(a => ({
      name: a.name,
      scheduledTime: new Date(a.scheduledTime).toISOString(),
      periodInMinutes: a.periodInMinutes
    })),
  };
}

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Alarm triggered:', alarm.name, alarm.scheduledTime);
  if (alarm.name.startsWith('monitor_')) {
    const taskId = alarm.name.replace('monitor_', '');
    console.log(`Checking task: ${taskId}`);

    // Check if task exists before checking
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      console.log(`Task ${taskId} not found, clearing orphan alarm`);
      await chrome.alarms.clear(alarm.name);
      return;
    }

    // If another task is being checked, delay this one by 5 seconds
    if (isChecking) {
      console.log(`Another task is being checked, delaying task ${task.name} by ${CHECK_DELAY_SECONDS}s`);
      await chrome.alarms.create(alarm.name, {
        delayInMinutes: CHECK_DELAY_SECONDS / 60,
        periodInMinutes: task.interval / 60
      });
      return;
    }

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
  console.log('handleSaveTask called with:', taskData);

  const task = {
    id: `task_${Date.now()}`,
    url: taskData.url,
    selector: taskData.selector,
    interval: taskData.interval === 0 ? 0 : Math.max(60, taskData.interval),
    name: taskData.name || new URL(taskData.url).hostname,
    lastValue: null, // Initialize as null, first check will set the value
    lastCheck: null,
    lastChangedAt: null, // Will be set when content changes
    checkCount: 0, // Number of times this task has been checked
    userScript: taskData.userScript || null, // Custom JS code to execute before checking
    status: taskData.interval === 0 ? 'paused' : 'active',
    createdAt: Date.now()
  };

  console.log('Created task:', task);

  const { tasks = [] } = await chrome.storage.local.get('tasks');
  tasks.push(task);
  await chrome.storage.local.set({ tasks });

  console.log('Task saved to storage. Total tasks:', tasks.length);

  // Create alarm and do initial check if not manual
  if (task.interval > 0) {
    await createAlarmForTask(task);

    // Do initial check immediately
    console.log('Starting initial check for task:', task.id);
    checkTask(task.id).catch(err => console.error('Initial check error:', err));
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
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) return;

  if (status === 'active') {
    await createAlarmForTask(task);
  } else {
    await stopTaskScheduler(taskId);
  }
}

// Handle update interval
async function handleUpdateInterval(taskId, interval, status, userScript) {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) return;

  // Update userScript if provided
  if (userScript !== undefined) {
    task.userScript = userScript || null;
  }

  // Clear existing scheduler
  await stopTaskScheduler(taskId);

  // Create new scheduler if active and interval > 0
  if (status === 'active' && interval > 0) {
    task.interval = interval;
    await createAlarmForTask(task);
  }

  // Save updated task
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    tasks[taskIndex] = task;
    await chrome.storage.local.set({ tasks });
  }
}

// Handle check now
async function handleCheckNow(taskId) {
  console.log(`handleCheckNow called for task: ${taskId}`);

  // If another task is being checked, delay this one by 5 seconds
  if (isChecking) {
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      console.log(`Another task is being checked, delaying check-now for ${task.name} by ${CHECK_DELAY_SECONDS}s`);
      await chrome.alarms.create(`monitor_${taskId}`, {
        delayInMinutes: CHECK_DELAY_SECONDS / 60,
        periodInMinutes: task.interval / 60
      });
    }
    return;
  }

  try {
    await checkTask(taskId);
    console.log(`handleCheckNow completed for task: ${taskId}`);
  } catch (error) {
    console.error(`handleCheckNow error for task ${taskId}:`, error);
  }
}

// Handle delete task
async function handleDeleteTask(taskId) {
  await stopTaskScheduler(taskId);
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
// If the task has a lastCheck, schedule the first fire based on remaining time
async function createAlarmForTask(task) {
  const alarmName = `monitor_${task.id}`;
  const intervalSeconds = task.interval;
  const intervalMinutes = intervalSeconds / 60;

  console.log(`Creating alarm for task ${task.name}: interval=${intervalSeconds}s (${intervalMinutes} minutes)`);

  // Calculate first fire time based on lastCheck
  let alarmInfo;
  if (task.lastCheck && task.interval > 0) {
    const nextCheckTime = task.lastCheck + task.interval * 1000;
    const now = Date.now();
    if (nextCheckTime > now) {
      // Not yet time to check, schedule at the calculated time
      const delayMinutes = (nextCheckTime - now) / 60000;
      alarmInfo = {
        when: nextCheckTime,
        periodInMinutes: intervalMinutes
      };
      console.log(`Scheduling first fire at ${new Date(nextCheckTime).toISOString()} (in ${delayMinutes.toFixed(1)} minutes)`);
    } else {
      // Already past the scheduled time, fire soon then repeat
      alarmInfo = {
        delayInMinutes: 0.01,
        periodInMinutes: intervalMinutes
      };
      console.log(`Past scheduled time, firing soon then every ${intervalMinutes} minutes`);
    }
  } else {
    // No lastCheck (new task or never checked), use periodInMinutes only
    alarmInfo = {
      periodInMinutes: intervalMinutes
    };
    console.log(`No lastCheck, starting with periodInMinutes=${intervalMinutes}`);
  }

  await chrome.alarms.create(alarmName, alarmInfo);

  // Verify alarm was created
  const alarm = await chrome.alarms.get(alarmName);
  console.log(`Alarm created: ${alarmName}`, alarm);
}

// Stop alarm for a task
async function stopTaskScheduler(taskId) {
  const alarmName = `monitor_${taskId}`;
  await chrome.alarms.clear(alarmName);
  console.log(`Alarm cleared for task: ${taskId}`);
}

// Check a task
async function checkTask(taskId, closeAfterCheck = false) {
  console.log(`checkTask called for ${taskId}`);

  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    console.log(`Task ${taskId} not found`);
    return;
  }

  console.log(`Found task: ${task.name}, url: ${task.url}`);

  // Set lock - only one task can be checked at a time
  isChecking = true;
  let tab = null;

  try {
    // Check if we have a reusable checker tab
    if (checkerTab) {
      try {
        await chrome.tabs.get(checkerTab.id);
        tab = checkerTab;
        console.log(`Reusing existing checker tab: ${tab.id}`);
      } catch (e) {
        console.log('Checker tab no longer exists, creating new one');
        checkerTab = null;
      }
    }

    // Create a new tab if needed
    if (!tab) {
      console.log(`Creating new tab for URL: ${task.url}`);
      tab = await chrome.tabs.create({
        url: task.url,
        active: false,
        pinned: false
      });
      checkerTab = tab;
      console.log(`Created tab: ${tab.id}`);
    } else {
      console.log(`Updating tab ${tab.id} to URL: ${task.url}`);
      await chrome.tabs.update(tab.id, { url: task.url });
    }

    // Wait for the tab to load completely
    console.log(`Waiting for tab ${tab.id} to load...`);
    await waitForTabLoad(tab.id);
    console.log(`Tab ${tab.id} loaded`);

    // Wait additional time for dynamic content
    console.log('Waiting 2s for dynamic content...');
    await sleep(2000);

    // Execute user script if defined
    if (task.userScript) {
      console.log(`Executing user script for task: ${task.name}`);
      try {
        // Inject jQuery if not already present on the page
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            if (typeof window.jQuery === 'undefined' && typeof window.$ === 'undefined') {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
              script.id = '__element_monitor_jquery__';
              document.head.appendChild(script);
            }
          }
        });

        // Wait for jQuery to load
        await sleep(1000);

        // Execute user script with jQuery available as $ and jQuery
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: (scriptContent) => {
            try {
              const fn = new Function('$', 'jQuery', scriptContent);
              const jq = window.jQuery || window.$;
              fn(jq, jq);
            } catch (e) {
              console.error('User script error:', e);
            }
          },
          args: [task.userScript]
        });
        // Wait for user script to take effect
        await sleep(1000);
        console.log('User script executed successfully');
      } catch (error) {
        console.error('Failed to execute user script:', error);
      }
    }

    // Execute script to get element value with retry
    console.log(`Getting element value for selector: ${task.selector}`);
    const currentValue = await getElementWithRetry(tab.id, task.selector, 3);
    console.log(`Element value obtained: ${currentValue ? 'success' : 'null'}`);

    // Increment check count regardless of whether element was found
    task.checkCount = (task.checkCount || 0) + 1;
    task.lastCheck = Date.now();

    // Process the result
    if (currentValue !== null) {
      await processElementValue(task, currentValue, tasks);
    } else {
      console.warn(`Element not found: ${task.selector} on ${task.url}`);
      // Still need to save the updated checkCount and lastCheck
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        tasks[taskIndex] = task;
        await chrome.storage.local.set({ tasks });
      }
    }
  } catch (error) {
    console.error('Error checking task:', error);
  } finally {
    // Always close the checker tab after check
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
        console.log('Checker tab closed');
      } catch (e) {
        console.warn('Failed to close tab:', e);
      }
      checkerTab = null;
    }

    // Rebuild alarm for next check
    if (task.status === 'active' && task.interval > 0) {
      await createAlarmForTask(task);
    }

    // Release lock
    isChecking = false;
    console.log(`Task ${task.name} check completed, lock released`);
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

  console.log(`Processing task ${task.name}: previousValue=${previousValue ? 'exists' : 'null'}, currentValue=${currentValue ? 'exists' : 'null'}`);

  // Update lastValue (checkCount and lastCheck are already updated in checkTask)
  task.lastValue = currentValue;

  // Detect change: value differs from previous (skip first check when previousValue is null)
  const hasChanged = previousValue !== null && previousValue !== currentValue;

  console.log(`hasChanged=${hasChanged}, comparison: previousValue !== null = ${previousValue !== null}, previousValue !== currentValue = ${previousValue !== currentValue}`);

  if (hasChanged) {
    task.hasChanged = true;
    task.lastChangedAt = Date.now(); // Record the time when data changed
    console.log(`Element changed for task: ${task.name}, setting lastChangedAt to ${task.lastChangedAt}`);
    await sendChangeNotification(task, currentValue);
  }

  const taskIndex = tasks.findIndex(t => t.id === task.id);
  if (taskIndex !== -1) {
    tasks[taskIndex] = task;
    await chrome.storage.local.set({ tasks });
  }

  if (hasChanged) {
    await updateBadge();
  }
}

// Update extension badge with changed count
async function updateBadge(taskList) {
  let tasks = taskList;
  if (!tasks) {
    const stored = await chrome.storage.local.get('tasks');
    tasks = stored.tasks || [];
  }

  const changedCount = tasks.filter(t => t.hasChanged).length;

  console.log(`updateBadge: ${changedCount} changed tasks`);

  try {
    if (changedCount > 0) {
      await chrome.action.setBadgeText({ text: changedCount.toString() });
      await chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
    console.log('Badge updated successfully');
  } catch (error) {
    console.error('Failed to update badge:', error);
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

  // Store notification data for click handling BEFORE creating notification
  // This ensures data is available when user clicks the notification
  await chrome.storage.local.set({
    [`notification_${notificationId}`]: {
      taskId: task.id,
      taskUrl: task.url
    }
  });

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
    // Clean up stored data if notification creation failed
    chrome.storage.local.remove(`notification_${notificationId}`);
  }
}

// Handle notification click
chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log('Notification clicked:', notificationId);

  const data = await chrome.storage.local.get(`notification_${notificationId}`);
  const notifyData = data[`notification_${notificationId}`];

  console.log('Notification data:', notifyData);

  if (notifyData && notifyData.taskId) {
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const taskIndex = tasks.findIndex(t => t.id === notifyData.taskId);

    if (taskIndex !== -1) {
      tasks[taskIndex].hasChanged = false;
      await chrome.storage.local.set({ tasks });
      await updateBadge(tasks);
      console.log('Task marked as read:', notifyData.taskId);
    }

    chrome.tabs.create({ url: notifyData.taskUrl });
    chrome.notifications.clear(notificationId);
    chrome.storage.local.remove(`notification_${notificationId}`);
  } else {
    console.warn('No notification data found for:', notificationId);
  }
});

// Handle notification button click
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  console.log('Notification button clicked:', notificationId, buttonIndex);

  const data = await chrome.storage.local.get(`notification_${notificationId}`);
  const notifyData = data[`notification_${notificationId}`];

  if (buttonIndex === 0 && notifyData && notifyData.taskId) {
    const { tasks = [] } = await chrome.storage.local.get('tasks');
    const taskIndex = tasks.findIndex(t => t.id === notifyData.taskId);

    if (taskIndex !== -1) {
      tasks[taskIndex].hasChanged = false;
      await chrome.storage.local.set({ tasks });
      await updateBadge(tasks);
      console.log('Task marked as read:', notifyData.taskId);
    }

    chrome.tabs.create({ url: notifyData.taskUrl });
  }
  chrome.notifications.clear(notificationId);
  chrome.storage.local.remove(`notification_${notificationId}`);
});

// Restore alarms - only create missing alarms, don't reset existing ones
async function restoreAlarms() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const taskIds = new Set(tasks.map(t => t.id));
  console.log(`Found ${tasks.length} tasks, ${tasks.filter(t => t.status === 'active').length} active`);

  // Get existing alarms
  const allAlarms = await chrome.alarms.getAll();
  const alarmNames = new Set(allAlarms.map(a => a.name));

  // Clear orphan alarms (alarms for tasks that no longer exist)
  for (const alarm of allAlarms) {
    if (alarm.name.startsWith('monitor_')) {
      const taskId = alarm.name.replace('monitor_', '');
      if (!taskIds.has(taskId)) {
        console.log(`Clearing orphan alarm: ${alarm.name}`);
        await chrome.alarms.clear(alarm.name);
      }
    }
  }

  // Only create alarms for active tasks that don't have one yet
  for (const task of tasks) {
    if (task.status === 'active') {
      const alarmName = `monitor_${task.id}`;
      if (!alarmNames.has(alarmName)) {
        console.log(`Creating missing alarm for task: ${task.name} (interval: ${task.interval}s)`);
        await createAlarmForTask(task);
      } else {
        console.log(`Alarm already exists for task: ${task.name}, skipping`);
      }
    }
  }

  // List all alarms for debugging
  const remainingAlarms = await chrome.alarms.getAll();
  console.log('All alarms after restore:', remainingAlarms);

  updateBadge(tasks);
}

// Restore alarms on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup - restoring schedulers');
  await restoreAlarms();
});

// Also restore alarms when service worker starts (for MV3)
(async () => {
  console.log('Service worker starting - restoring schedulers');
  await restoreAlarms();
})();
