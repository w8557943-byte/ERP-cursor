const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  relaunchApp: () => ipcRenderer.invoke('app-relaunch'),
  downloadAndSave: (payload) => ipcRenderer.invoke('download-and-save', payload),
  generateQuoteXlsx: (payload) => ipcRenderer.invoke('generate-quote-xlsx', payload),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('show-item-in-folder', targetPath),
  reportRasp: (payload) => ipcRenderer.invoke('rasp-report', payload)
})
