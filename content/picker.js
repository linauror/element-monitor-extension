// Element Picker - Similar to DevTools inspector
// This script is injected when user wants to pick an element

(function() {
  const instanceId = Date.now();

  // i18n helper
  const i18n = {
    get: (key) => chrome.i18n.getMessage(key) || key
  };

  // Interval options for slider
  const intervalOptions = [
    { value: 60, label: i18n.get('interval1m') },
    { value: 300, label: i18n.get('interval5m') },
    { value: 600, label: i18n.get('interval10m') },
    { value: 1800, label: i18n.get('interval30m') },
    { value: 3600, label: i18n.get('interval1h') },
    { value: 21600, label: i18n.get('interval6h') },
    { value: 43200, label: i18n.get('interval12h') },
    { value: 86400, label: i18n.get('interval1d') },
    { value: 604800, label: i18n.get('interval1w') },
    { value: 0, label: i18n.get('intervalManual') }
  ];

  let highlightedElement = null;
  let overlay = null;
  let tooltip = null;
  let banner = null;
  let isPickerActive = false;

  // Create overlay and tooltip
  function createUI() {
    removeExistingUI();

    overlay = document.createElement('div');
    overlay.id = '__element_picker_overlay__';
    overlay.dataset.instance = instanceId;
    overlay.style.cssText = `
      position: fixed;
      border: 2px solid #1976d2;
      background: rgba(25, 118, 210, 0.1);
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.1s ease;
      box-sizing: border-box;
    `;
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.id = '__element_picker_tooltip__';
    tooltip.dataset.instance = instanceId;
    tooltip.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      background: #1976d2;
      color: white;
      padding: 8px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      z-index: 2147483647;
      pointer-events: none;
      border-radius: 4px;
      max-width: 400px;
      word-break: break-all;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(tooltip);

    banner = document.createElement('div');
    banner.id = '__element_picker_banner__';
    banner.dataset.instance = instanceId;
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #ff5722;
      color: white;
      padding: 10px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    banner.innerHTML = `
      <span style="margin-right: 10px;">${i18n.get('pickBannerText')}</span>
      <span style="opacity: 0.8; font-size: 12px;">${i18n.get('pickBannerHint')}</span>
    `;
    document.body.appendChild(banner);
  }

  function removeExistingUI() {
    const existingOverlay = document.getElementById('__element_picker_overlay__');
    const existingTooltip = document.getElementById('__element_picker_tooltip__');
    const existingBanner = document.getElementById('__element_picker_banner__');
    const existingDialog = document.getElementById('__element_picker_dialog__');

    if (existingOverlay) existingOverlay.remove();
    if (existingTooltip) existingTooltip.remove();
    if (existingBanner) existingBanner.remove();
    if (existingDialog) existingDialog.remove();
  }

  function generateSelector(element) {
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const selector = '.' + classes.map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      if (index > 1 || current.nextElementSibling) {
        selector += `:nth-child(${index})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  function updateOverlay(element) {
    if (!overlay) return;
    const rect = element.getBoundingClientRect();
    overlay.style.top = rect.top + window.scrollY + 'px';
    overlay.style.left = rect.left + window.scrollX + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function updateTooltip(element, selector) {
    if (!tooltip) return;
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className && typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(c => c).map(c => `.${c}`).join('')
      : '';

    tooltip.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">${tagName}${id}${classes}</div>
      <div style="font-family: monospace; font-size: 11px; opacity: 0.9;">${selector}</div>
    `;

    const rect = element.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 5;
    let left = rect.left + window.scrollX;

    if (top + 60 > window.innerHeight + window.scrollY) {
      top = rect.top + window.scrollY - 60;
    }
    if (left + 400 > window.innerWidth) {
      left = window.innerWidth - 410;
    }

    tooltip.style.top = Math.max(50, top) + 'px';
    tooltip.style.left = Math.max(0, left) + 'px';
  }

  function onMouseOver(e) {
    const dialog = document.getElementById('__element_picker_dialog__');
    if (!overlay || !tooltip) return;
    if (e.target === overlay || e.target === tooltip || e.target === banner || (dialog && dialog.contains(e.target))) {
      return;
    }

    highlightedElement = e.target;
    const selector = generateSelector(highlightedElement);
    updateOverlay(highlightedElement);
    updateTooltip(highlightedElement, selector);
    highlightedElement.__generatedSelector = selector;
  }

  function onClick(e) {
    const dialog = document.getElementById('__element_picker_dialog__');
    if (!overlay || !tooltip) return;
    if (e.target === overlay || e.target === tooltip || e.target === banner || (dialog && dialog.contains(e.target))) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const selector = element.__generatedSelector || generateSelector(element);

    removePickerListeners();
    showSaveDialog(element, selector);
  }

  function removePickerListeners() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
  }

  function showSaveDialog(element, selector) {
    if (overlay) overlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    if (banner) banner.remove();

    const previewContent = element.textContent ? element.textContent.trim().substring(0, 200) : i18n.get('emptyPreview');

    const existingDialog = document.getElementById('__element_picker_dialog__');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.id = '__element_picker_dialog__';
    dialog.dataset.instance = instanceId;
    
    const dialogStyles = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      zIndex: '2147483647',
      width: '400px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
      fontSize: '13px',
      lineHeight: '1.4',
      color: '#333',
      boxSizing: 'border-box',
      padding: '0',
      margin: '0'
    };
    Object.assign(dialog.style, dialogStyles);

    const sliderId = `__dialog_interval_slider_${instanceId}__`;
    const displayId = `__dialog_interval_display_${instanceId}__`;
    const nameId = `__dialog_name_${instanceId}__`;

    const container = document.createElement('div');
    Object.assign(container.style, {
      padding: '16px',
      display: 'block',
      width: '100%',
      boxSizing: 'border-box'
    });

    // Header row
    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      margin: '0 0 14px 0',
      width: '100%'
    });

    const title = document.createElement('h2');
    title.textContent = i18n.get('saveDialogTitle');
    Object.assign(title.style, {
      fontSize: '16px',
      color: '#333',
      fontWeight: '600',
      margin: '0',
      padding: '0'
    });

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      fontSize: '22px',
      cursor: 'pointer',
      color: '#999',
      lineHeight: '1',
      padding: '0',
      margin: '0'
    });

    headerRow.appendChild(title);
    headerRow.appendChild(closeBtn);
    container.appendChild(headerRow);

    // Helper to create form group
    function createFormGroup(labelText, inputElement) {
      const group = document.createElement('div');
      Object.assign(group.style, {
        marginBottom: '12px',
        display: 'block',
        width: '100%',
        boxSizing: 'border-box'
      });

      const label = document.createElement('label');
      label.textContent = labelText;
      Object.assign(label.style, {
        display: 'block',
        fontSize: '12px',
        color: '#666',
        margin: '0 0 4px 0',
        padding: '0'
      });

      group.appendChild(label);
      group.appendChild(inputElement);
      return group;
    }

    // Helper to create text input
    function createTextInput(value, isReadOnly = false) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      Object.assign(input.style, {
        display: 'block',
        width: '100%',
        padding: '8px 10px',
        margin: '0',
        border: '1px solid #ddd',
        borderRadius: '4px',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#333',
        background: isReadOnly ? '#f5f5f5' : '#fff',
        outline: 'none',
        boxSizing: 'border-box'
      });
      if (isReadOnly) {
        input.readOnly = true;
      }
      return input;
    }

    // Task name input
    const nameInput = createTextInput(document.title || i18n.get('untitledTask'));
    nameInput.id = nameId;
    container.appendChild(createFormGroup(i18n.get('taskNameLabel'), nameInput));

    // URL input
    const urlInput = createTextInput(window.location.href, true);
    container.appendChild(createFormGroup(i18n.get('pageUrlLabel'), urlInput));

    // Selector input
    const selectorInput = createTextInput(selector, true);
    container.appendChild(createFormGroup(i18n.get('selectorLabel'), selectorInput));

    // Preview div
    const previewGroup = document.createElement('div');
    Object.assign(previewGroup.style, {
      marginBottom: '12px',
      display: 'block',
      width: '100%',
      boxSizing: 'border-box'
    });
    const previewLabel = document.createElement('label');
    previewLabel.textContent = i18n.get('previewLabel');
    Object.assign(previewLabel.style, {
      display: 'block',
      fontSize: '12px',
      color: '#666',
      margin: '0 0 4px 0'
    });
    const previewDiv = document.createElement('div');
    previewDiv.textContent = previewContent;
    Object.assign(previewDiv.style, {
      display: 'block',
      width: '100%',
      padding: '8px 10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      background: '#fafafa',
      fontSize: '12px',
      maxHeight: '60px',
      overflowY: 'auto',
      wordBreak: 'break-all',
      color: '#555',
      boxSizing: 'border-box'
    });
    previewGroup.appendChild(previewLabel);
    previewGroup.appendChild(previewDiv);
    container.appendChild(previewGroup);

    // Interval slider group
    const intervalGroup = document.createElement('div');
    Object.assign(intervalGroup.style, {
      marginBottom: '12px',
      display: 'block',
      width: '100%',
      boxSizing: 'border-box'
    });
    const intervalLabel = document.createElement('label');
    intervalLabel.textContent = i18n.get('intervalSliderLabel');
    Object.assign(intervalLabel.style, {
      display: 'block',
      fontSize: '12px',
      color: '#666',
      margin: '0 0 4px 0'
    });
    intervalGroup.appendChild(intervalLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = sliderId;
    slider.min = '0';
    slider.max = String(intervalOptions.length - 1);
    slider.value = '2';
    slider.step = '1';
    Object.assign(slider.style, {
      display: 'block',
      width: '100%',
      height: '6px',
      margin: '0',
      padding: '0',
      borderRadius: '3px',
      background: '#e0e0e0',
      outline: 'none',
      WebkitAppearance: 'none',
      boxSizing: 'border-box'
    });
    intervalGroup.appendChild(slider);

    const sliderLabels = document.createElement('div');
    sliderLabels.innerHTML = `<span>${i18n.get('interval1m')}</span><span>${i18n.get('intervalManual')}</span>`;
    Object.assign(sliderLabels.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '11px',
      color: '#999',
      marginTop: '2px',
      width: '100%'
    });
    intervalGroup.appendChild(sliderLabels);

    const displayWrapper = document.createElement('div');
    Object.assign(displayWrapper.style, {
      textAlign: 'center',
      margin: '6px 0 0 0',
      width: '100%'
    });
    const display = document.createElement('span');
    display.id = displayId;
    display.textContent = intervalOptions[2].label;
    Object.assign(display.style, {
      fontSize: '14px',
      fontWeight: '600',
      color: '#1976d2'
    });
    displayWrapper.appendChild(display);
    intervalGroup.appendChild(displayWrapper);
    container.appendChild(intervalGroup);

    // Button row
    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, {
      display: 'flex',
      gap: '10px',
      marginTop: '16px',
      width: '100%'
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = i18n.get('btnCancel');
    Object.assign(cancelBtn.style, {
      flex: '1',
      padding: '10px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      background: '#fff',
      color: '#333',
      fontSize: '13px',
      cursor: 'pointer',
      boxSizing: 'border-box'
    });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = i18n.get('btnSaveTask');
    Object.assign(saveBtn.style, {
      flex: '1',
      padding: '10px',
      border: 'none',
      borderRadius: '4px',
      background: '#1976d2',
      color: '#fff',
      fontSize: '13px',
      cursor: 'pointer',
      boxSizing: 'border-box'
    });

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    container.appendChild(buttonRow);

    dialog.appendChild(container);
    document.body.appendChild(dialog);

    slider.addEventListener('input', () => {
      const option = intervalOptions[parseInt(slider.value, 10)];
      display.textContent = option.label;
    });

    closeBtn.addEventListener('click', () => {
      dialog.remove();
      cleanup();
    });

    cancelBtn.addEventListener('click', () => {
      dialog.remove();
      cleanup();
    });

    saveBtn.addEventListener('click', () => {
      const option = intervalOptions[parseInt(slider.value, 10)];

      chrome.runtime.sendMessage({
        type: 'SAVE_TASK',
        task: {
          url: window.location.href,
          selector: selector,
          name: nameInput.value || document.title || i18n.get('untitledTask'),
          interval: option.value,
          preview: previewContent
        }
      });

      dialog.remove();
      cleanup();
    });

    const dialogKeyHandler = (e) => {
      if (e.key === 'Escape') {
        dialog.remove();
        cleanup();
        document.removeEventListener('keydown', dialogKeyHandler, true);
      }
    };
    document.addEventListener('keydown', dialogKeyHandler, true);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({
        type: 'ELEMENT_PICK_CANCELLED'
      });
      cleanup();
    }
  }

  function cleanup() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    if (overlay && overlay.parentNode) overlay.remove();
    if (tooltip && tooltip.parentNode) tooltip.remove();
    if (banner && banner.parentNode) banner.remove();

    const dialog = document.getElementById('__element_picker_dialog__');
    if (dialog && dialog.parentNode) dialog.remove();

    overlay = null;
    tooltip = null;
    banner = null;
    isPickerActive = false;
  }

  function startPicking() {
    if (isPickerActive) {
      cleanup();
    }

    isPickerActive = true;
    createUI();

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_PICKING') {
      startPicking();
    } else if (message.type === 'STOP_PICKING') {
      cleanup();
    }
  });
})();
