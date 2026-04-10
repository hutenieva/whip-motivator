const toggle = document.getElementById('whipToggle');
const modesGrid = document.querySelector('.modes');
const sectionLabel = document.querySelector('.section-label');
const modeBtns = document.querySelectorAll('.mode-btn');

// Load saved state
chrome.storage.local.get(['whipEnabled', 'whipMode'], (data) => {
  const enabled = data.whipEnabled || false;
  const mode = data.whipMode || 'neutral';
  toggle.checked = enabled;
  setActiveMode(mode);
  updateDisabledState(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ whipEnabled: enabled });
  updateDisabledState(enabled);
  sendToTab({ action: 'toggle', enabled });
});

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    chrome.storage.local.set({ whipMode: mode });
    setActiveMode(mode);
    sendToTab({ action: 'setMode', mode });
  });
});

function setActiveMode(mode) {
  modeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function updateDisabledState(enabled) {
  modesGrid.classList.toggle('disabled', !enabled);
  sectionLabel.classList.toggle('disabled', !enabled);
}

function sendToTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url?.includes('meet.google.com')) {
      chrome.tabs.sendMessage(tabs[0].id, msg);
    }
  });
}
