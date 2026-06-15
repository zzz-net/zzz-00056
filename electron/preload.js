const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getData: () => ipcRenderer.invoke('getData'),
  saveData: (data) => ipcRenderer.invoke('saveData', data),
  exportCSV: (content, defaultName) => ipcRenderer.invoke('exportCSV', content, defaultName),
})
