const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getPrintersConfig: () => ipcRenderer.invoke('get-printers-config'),
  setPrintersConfig: (config) => ipcRenderer.invoke('set-printers-config', config),
  testPrint: (printerName) => ipcRenderer.invoke('test-print', { printerName }),
  printDocument: (payload) => ipcRenderer.invoke('print-document', payload),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  showOrderNotification: (order) => ipcRenderer.send('show-order-notification', { order }),
  sendOrderActionResult: (orderId, action) => ipcRenderer.send('order-action-result', { orderId, action }),
  onOrderActionResult: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('order-action-result', handler);
    // Return unsubscribe so StrictMode effect cleanup removes the listener.
    return () => ipcRenderer.removeListener('order-action-result', handler);
  },
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  getDeviceName: () => ipcRenderer.invoke('get-device-name'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
