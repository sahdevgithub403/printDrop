"use client";

// Typings for the Electron preload bridge (window.electronAPI) exposed by
// electron/preload.cjs. Everything is optional so the same code runs in a
// plain browser tab (dev) where the bridge does not exist.
interface ElectronAPI {
  isElectron?: boolean;
  getDeviceId?: () => Promise<string>;
  getDeviceName?: () => Promise<string>;
  getAppVersion?: () => Promise<string>;
  getPrinters?: () => Promise<any>;
  getPrintersConfig?: () => Promise<{ mainPrinter?: string; colorPrinter?: string }>;
  setPrintersConfig?: (config: { mainPrinter?: string | null; colorPrinter?: string | null }) => Promise<void>;
  printDocument?: (job: {
    base64Data: string;
    originalFileName: string;
    contentType: string;
    printSettings: Record<string, unknown>;
  }) => Promise<unknown>;
  testPrint?: (printerName: string) => Promise<any>;
  showNotification?: (title: string, body: string) => void;
  showOrderNotification?: (order: unknown) => void;
  onOrderActionResult?: (
    listener: (result: { orderId: string; action: string }) => void,
  ) => () => void;
  sendOrderActionResult?: (orderId: string, action: string) => void;
  dismissPopup?: () => void;
  [key: string]: any;
}

interface Window {
  electronAPI?: ElectronAPI;
}

// mammoth ships no TypeScript declarations; the runtime import is untyped.
declare module "mammoth";
