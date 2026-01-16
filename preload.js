const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('imsExamPCTU', {
  requestExit: (password) => {
    return ipcRenderer.send('request-exit', password);
  },
  isRunning: () => {
    return true;
  },
  closeWindow: () => {
    return ipcRenderer.send('close-exam-window');
  }
});

// Expose electron API for exam window
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, ...args) => {
      return ipcRenderer.send(channel, ...args);
    },
    on: (channel, func) => {
      const subscription = (event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  }
});

// Disable context menu in renderer
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
});

// Disable certain keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Block F12
  if (e.key === 'F12') {
    e.preventDefault();
    return false;
  }

  // Block Ctrl+Shift+I (DevTools)
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    e.preventDefault();
    return false;
  }

  // Block Ctrl+Shift+J (DevTools Console)
  if (e.ctrlKey && e.shiftKey && e.key === 'J') {
    e.preventDefault();
    return false;
  }

  // Block Ctrl+U (View Source)
  if (e.ctrlKey && e.key === 'U') {
    e.preventDefault();
    return false;
  }

  // Block Print Screen
  if (e.key === 'PrintScreen') {
    e.preventDefault();
    return false;
  }

  // Block Alt+Tab (though this should be handled by main process)
  if (e.altKey && e.key === 'Tab') {
    e.preventDefault();
    return false;
  }

  // Block Windows key combinations
  if (e.metaKey) {
    e.preventDefault();
    return false;
  }
}, true);

// Prevent drag and drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  return false;
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  return false;
});

