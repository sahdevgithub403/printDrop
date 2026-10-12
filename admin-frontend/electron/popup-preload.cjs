// Minimal preload for the order notification popup window.
// Exposes ONLY what popup content needs: order actions + dismiss.
// No printer, device, or order-queue APIs are available to popup content.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  sendOrderActionResult: (orderId, action) => ipcRenderer.send('order-action-result', { orderId, action }),
  // Dismiss closes the popup WITHOUT declining/cancelling the order.
  dismissPopup: () => ipcRenderer.send('dismiss-popup'),
});
