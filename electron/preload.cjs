'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  getPrinters: () => ipcRenderer.invoke('get-printers'),

  rawPrint: (printerName, data, mode) =>
    ipcRenderer.invoke('raw-print', printerName, data, mode),

  pingPrinter: printerName =>
    ipcRenderer.invoke('ping-printer', printerName),

  getAppVersion: () => ipcRenderer.invoke('get-version'),

  showSaveDialog: options => ipcRenderer.invoke('show-save-dialog', options),

  openFolder: folderPath => ipcRenderer.invoke('open-folder', folderPath),

  installDriver: () => ipcRenderer.invoke('install-driver'),

  loadDatabase: () => ipcRenderer.invoke('load-database'),

  saveDatabase: data => ipcRenderer.invoke('save-database', data),

  getDataFolder: () => ipcRenderer.invoke('get-data-folder'),

  exportJsonBackup: data => ipcRenderer.invoke('export-json-backup', data),
});
