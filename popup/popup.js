// Popup script for Element Monitor extension

let isPickingElement = false;
let currentPage = 1;
const pageSize = 10;
let editingTaskId = null;
let searchKeyword = '';
let allTasks = [];

// i18n helper
const i18n = {
  get: (key, sub) => chrome.i18n.getMessage(key, sub) || key,
  getIntervalOptions: () => [
    { value: 5, label: chrome.i18n.getMessage('interval5s') || '5 seconds' },
    { value: 10, label: chrome.i18n.getMessage('interval10s') || '10 seconds' },
    { value: 30, label: chrome.i18n.getMessage('interval30s') || '30 seconds' },
    { value: 60, label: chrome.i18n.getMessage('interval1m') || '1 minute' },
    { value: 180, label: chrome.i18n.getMessage('interval3m') || '3 minutes' },
    { value: 300, label: chrome.i18n.getMessage('interval5m') || '5 minutes' },
    { value: 600, label: chrome.i18n.getMessage('interval10m') || '10 minutes' },
    { value: 1800, label: chrome.i18n.getMessage('interval30m') || '30 minutes' },
    { value: 3600, label: chrome.i18n.getMessage('interval1h') || '1 hour' },
    { value: 21600, label: chrome.i18n.getMessage('interval6h') || '6 hours' },
    { value: 43200, label: chrome.i18n.getMessage('interval12h') || '12 hours' },
    { value: 86400, label: chrome.i18n.getMessage('interval1d') || '1 day' },
    { value: 604800, label: chrome.i18n.getMessage('interval1w') || '1 week' },
    { value: 2592000, label: chrome.i18n.getMessage('interval1M') || '1 month' },
    { value: 0, label: chrome.i18n.getMessage('intervalManual') || 'Manual' }
  ]
};

const intervalOptions = i18n.getIntervalOptions();

// SVG icons
const icons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'
};

document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  loadTasks();
  setupEventListeners();
  restorePickState();

  // Listen for storage changes to update the list
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.tasks) {
      loadTasks();
    }
  });
});

function initI18n() {
  // Set localized text
  document.getElementById('popupTitle').textContent = i18n.get('popupTitle');
  document.getElementById('searchInput').placeholder = i18n.get('searchPlaceholder');
  document.getElementById('pickElement').title = i18n.get('pickElementTitle');
  document.getElementById('emptyStateText').textContent = i18n.get('noTasks');
  document.getElementById('editModalTitle').textContent = i18n.get('editIntervalTitle');
  document.getElementById('intervalLabel').textContent = i18n.get('intervalLabel');
  document.getElementById('sliderMinLabel').textContent = i18n.get('interval5s');
  document.getElementById('sliderMaxLabel').textContent = i18n.get('intervalManual');
  document.getElementById('currentIntervalPrefix').textContent = i18n.get('currentInterval');
  document.getElementById('modalCancel').textContent = i18n.get('btnCancel');
  document.getElementById('modalSave').textContent = i18n.get('btnSave');
}

function setupEventListeners() {
  document.getElementById('pickElement').addEventListener('click', toggleElementPicker);
  document.getElementById('searchInput').addEventListener('input', handleSearch);

  document.getElementById('modalClose').addEventListener('click', closeEditModal);
  document.getElementById('modalCancel').addEventListener('click', closeEditModal);
  document.getElementById('modalSave').addEventListener('click', saveInterval);

  const editSlider = document.getElementById('editIntervalSlider');
  editSlider.addEventListener('input', () => {
    const option = intervalOptions[parseInt(editSlider.value, 10)];
    document.getElementById('editIntervalValue').textContent = option.label;
  });

  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
  });
}

async function restorePickState() {
  const { pickingState } = await chrome.storage.local.get('pickingState');
  if (pickingState) {
    isPickingElement = true;
    updatePickButton(true);
  }

  const { selectedElement } = await chrome.storage.local.get('selectedElement');
  if (selectedElement && Date.now() - selectedElement.timestamp < 60000) {
    document.getElementById('pickStatus').textContent = i18n.get('elementSelected');
    document.getElementById('pickStatus').className = 'pick-status success';
    await chrome.storage.local.remove('selectedElement');
  }
}

async function loadTasks() {
  // Try sync storage first, fallback to local for migration
  let { tasks = null } = await chrome.storage.sync.get('tasks');
  
  // If sync is empty, check local storage (migration case)
  if (!tasks || tasks.length === 0) {
    const localData = await chrome.storage.local.get('tasks');
    if (localData.tasks && localData.tasks.length > 0) {
      tasks = localData.tasks;
      // Migrate to sync storage
      await chrome.storage.sync.set({ tasks });
      console.log('Migrated tasks from local to sync storage');
    } else {
      tasks = [];
    }
  }

  // Store all tasks for filtering
  allTasks = tasks;

  // Sort tasks: changed tasks first, then by lastCheck time
  const sortedTasks = tasks.sort((a, b) => {
    if (a.hasChanged && !b.hasChanged) return -1;
    if (!a.hasChanged && b.hasChanged) return 1;
    return (b.lastCheck || 0) - (a.lastCheck || 0);
  });

  renderFilteredTasks();
  updateBadge(sortedTasks);
}

function handleSearch(e) {
  searchKeyword = e.target.value.trim().toLowerCase();
  currentPage = 1;
  renderFilteredTasks();
}

function renderFilteredTasks() {
  let filteredTasks = allTasks;

  // Filter by search keyword
  if (searchKeyword) {
    filteredTasks = allTasks.filter(task => 
      (task.name || '').toLowerCase().includes(searchKeyword)
    );
  }

  // Sort: changed tasks first, then by lastCheck time
  const sortedTasks = filteredTasks.sort((a, b) => {
    if (a.hasChanged && !b.hasChanged) return -1;
    if (!a.hasChanged && b.hasChanged) return 1;
    return (b.lastCheck || 0) - (a.lastCheck || 0);
  });

  renderTasks(sortedTasks);
  renderPagination(sortedTasks.length);
}

function updateBadge(tasks) {
  const changedCount = tasks.filter(t => t.hasChanged).length;
  if (changedCount > 0) {
    chrome.action.setBadgeText({ text: changedCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function renderTasks(tasks) {
  const taskList = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');

  if (tasks.length === 0) {
    taskList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageTasks = tasks.slice(startIndex, endIndex);

  taskList.innerHTML = pageTasks.map(task => createTaskHTML(task)).join('');

  pageTasks.forEach(task => {
    const taskEl = document.getElementById(`task-${task.id}`);
    taskEl.querySelector('.task-name').addEventListener('click', () => openUrl(task.id));
    taskEl.querySelector('.btn-toggle')?.addEventListener('click', () => toggleTask(task.id));
    taskEl.querySelector('.btn-check')?.addEventListener('click', () => checkNow(task.id));
    taskEl.querySelector('.btn-edit')?.addEventListener('click', () => openEditModal(task.id));
    taskEl.querySelector('.btn-delete')?.addEventListener('click', () => deleteTask(task.id));
  });
}

async function openUrl(taskId) {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // Clear changed flag
  if (task.hasChanged) {
    task.hasChanged = false;
    await chrome.storage.sync.set({ tasks });
    loadTasks();
  }

  chrome.tabs.create({ url: task.url });
}

function renderPagination(totalItems) {
  const pagination = document.getElementById('pagination');
  const totalPages = Math.ceil(totalItems / pageSize);

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  pagination.innerHTML = `
    <button class="pagination-btn" id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>${i18n.get('prevPage')}</button>
    <span class="pagination-info">${currentPage}/${totalPages}</span>
    <button class="pagination-btn" id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>${i18n.get('nextPage')}</button>
  `;

  document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadTasks(); }
  });

  document.getElementById('nextPage').addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; loadTasks(); }
  });
}

function formatInterval(seconds) {
  const option = intervalOptions.find(o => o.value === seconds);
  return option ? option.label : i18n.get('intervalManual');
}

function formatLastCheck(timestamp) {
  if (!timestamp) return i18n.get('never');
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return i18n.get('justNow');
  if (diff < 3600000) return `${Math.floor(diff / 60000)} ${i18n.get('minutesAgo')}`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ${i18n.get('hoursAgo')}`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} ${i18n.get('daysAgo')}`;

  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function truncateText(text, maxLen = 50) {
  if (!text) return i18n.get('emptyPreview');
  const cleaned = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.substring(0, maxLen) + '...' : cleaned;
}

function createTaskHTML(task) {
  const statusClass = task.status === 'active' ? 'active' : 'paused';
  const statusText = task.status === 'active' ? i18n.get('statusRunning') : i18n.get('statusPaused');
  const toggleIcon = task.status === 'active' ? icons.pause : icons.play;
  const toggleClass = task.status === 'active' ? 'pause' : 'play';
  const lastValue = task.lastValue ? truncateText(task.lastValue, 50) : i18n.get('emptyPreview');

  // Changed state - highlight entire task item
  const itemChangedClass = task.hasChanged ? 'changed' : '';
  const statusDisplayText = task.hasChanged ? i18n.get('statusChanged') : statusText;

  return `
    <div id="task-${task.id}" class="task-item ${task.status === 'paused' ? 'paused' : ''} ${itemChangedClass}">
      <div class="task-row1">
        <span class="task-name" title="${i18n.get('btnOpenPage')}">${escapeHtml(task.name || i18n.get('untitledTask'))}</span>
        <span class="task-status ${statusClass}">${statusDisplayText}</span>
        <div class="task-actions">
          <button class="btn-icon ${toggleClass} btn-toggle" title="${task.status === 'active' ? i18n.get('btnPause') : i18n.get('btnStart')}">${toggleIcon}</button>
          <button class="btn-icon check btn-check" title="${i18n.get('btnCheckNow')}">${icons.check}</button>
          <button class="btn-icon edit btn-edit" title="${i18n.get('btnEditInterval')}">${icons.edit}</button>
          <button class="btn-icon delete btn-delete" title="${i18n.get('btnDelete')}">${icons.delete}</button>
        </div>
      </div>
      <div class="task-row2">
        <span class="task-preview">${escapeHtml(lastValue)}</span>
        <div class="task-meta">
          <span class="task-meta-item interval" title="${i18n.get('intervalLabel')}">${formatInterval(task.interval)}</span>
          <span class="task-meta-item lastcheck" title="${i18n.get('lastCheck', 'Last check')}">${formatLastCheck(task.lastCheck)}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function toggleTask(taskId) {
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  task.status = task.status === 'active' ? 'paused' : 'active';
  await chrome.storage.sync.set({ tasks });

  chrome.runtime.sendMessage({ type: 'TOGGLE_TASK', taskId, status: task.status });
  loadTasks();
}

async function checkNow(taskId) {
  chrome.runtime.sendMessage({ type: 'CHECK_NOW', taskId });

  const taskEl = document.getElementById(`task-${taskId}`);
  const btn = taskEl.querySelector('.btn-check');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 2000);
}

function openEditModal(taskId) {
  editingTaskId = taskId;

  chrome.storage.sync.get('tasks').then(({ tasks = [] }) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const sliderIndex = intervalOptions.findIndex(opt => opt.value === task.interval);
    const editSlider = document.getElementById('editIntervalSlider');
    editSlider.value = sliderIndex >= 0 ? sliderIndex : 2;

    const option = intervalOptions[parseInt(editSlider.value, 10)];
    document.getElementById('editIntervalValue').textContent = option.label;

    document.getElementById('editModal').classList.add('show');
  });
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('show');
  editingTaskId = null;
}

async function saveInterval() {
  if (!editingTaskId) return;

  const editSlider = document.getElementById('editIntervalSlider');
  const option = intervalOptions[parseInt(editSlider.value, 10)];

  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find(t => t.id === editingTaskId);
  if (!task) return;

  task.interval = option.value;
  if (option.value === 0 && task.status === 'active') {
    task.status = 'paused';
  }

  await chrome.storage.sync.set({ tasks });

  chrome.runtime.sendMessage({
    type: 'UPDATE_INTERVAL',
    taskId: editingTaskId,
    interval: option.value,
    status: task.status
  });

  closeEditModal();
  loadTasks();
}

async function deleteTask(taskId) {
  if (!confirm(i18n.get('confirmDelete'))) return;

  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const filteredTasks = tasks.filter(t => t.id !== taskId);
  await chrome.storage.sync.set({ tasks: filteredTasks });

  chrome.runtime.sendMessage({ type: 'DELETE_TASK', taskId });

  const totalPages = Math.ceil(filteredTasks.length / pageSize);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

  loadTasks();
}

async function toggleElementPicker() {
  isPickingElement = !isPickingElement;
  const pickBtn = document.getElementById('pickElement');
  const pickStatus = document.getElementById('pickStatus');

  if (isPickingElement) {
    updatePickButton(true);
    pickStatus.textContent = '';
    pickStatus.className = 'pick-status';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      pickStatus.textContent = i18n.get('errorNoActiveTab');
      pickStatus.className = 'pick-status error';
      updatePickButton(false);
      isPickingElement = false;
      return;
    }

    await chrome.storage.local.set({ pickingState: { tabId: tab.id } });

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/picker.js']
      });

      await chrome.tabs.sendMessage(tab.id, { type: 'START_PICKING' });
      window.close();
    } catch (error) {
      pickStatus.textContent = i18n.get('errorCannotAccess');
      pickStatus.className = 'pick-status error';
      updatePickButton(false);
      isPickingElement = false;
      await chrome.storage.local.remove('pickingState');
    }
  } else {
    updatePickButton(false);
    pickStatus.textContent = '';
    isPickingElement = false;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'STOP_PICKING' }).catch(() => {});
    }
    await chrome.storage.local.remove('pickingState');
  }
}

function updatePickButton(active) {
  const pickBtn = document.getElementById('pickElement');
  if (active) {
    pickBtn.classList.add('active');
  } else {
    pickBtn.classList.remove('active');
  }
}
