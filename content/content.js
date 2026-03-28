// Content script for Element Monitor extension
// This script runs on all pages and can respond to element value requests

// Track the last element that was right-clicked
document.addEventListener('contextmenu', (event) => {
  window.__lastContextMenuElement = event.target;
}, true);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ELEMENT_VALUE') {
    const element = document.querySelector(message.selector);
    if (element) {
      sendResponse({
        success: true,
        value: element.innerHTML
      });
    } else {
      sendResponse({
        success: false,
        error: 'Element not found'
      });
    }
  }
  return true; // Required for async sendResponse
});

// Utility function to get element info (can be used for debugging)
function getElementInfo(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    return null;
  }

  return {
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    innerHTML: element.innerHTML,
    textContent: element.textContent,
    rect: element.getBoundingClientRect()
  };
}
