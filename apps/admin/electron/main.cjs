const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

// Generate or retrieve persistent Device ID
const deviceIdPath = path.join(app.getPath("userData"), "device_id.json");
let deviceId = "";

try {
  if (fs.existsSync(deviceIdPath)) {
    const data = JSON.parse(fs.readFileSync(deviceIdPath, "utf8"));
    deviceId = data.deviceId;
  } else {
    deviceId = crypto.randomUUID();
    fs.writeFileSync(deviceIdPath, JSON.stringify({ deviceId }));
  }
} catch (e) {
  console.error("Error managing device ID:", e);
  deviceId = crypto.randomUUID();
}

let mainWindow;
let tray = null;
let mainPrinterName = null;
let colorPrinterName = null;

// Persisted printer queue config (rehydrated on startup)
const printersConfigPath = path.join(app.getPath("userData"), "printers_config.json");
try {
  if (fs.existsSync(printersConfigPath)) {
    const saved = JSON.parse(fs.readFileSync(printersConfigPath, "utf8"));
    if (saved && typeof saved === "object") {
      mainPrinterName = typeof saved.mainPrinter === "string" ? saved.mainPrinter : null;
      colorPrinterName = typeof saved.colorPrinter === "string" ? saved.colorPrinter : null;
    }
  }
} catch (e) {
  console.error("Error loading printer config:", e);
}

const savePrintersConfig = () => {
  try {
    fs.writeFileSync(
      printersConfigPath,
      JSON.stringify({ mainPrinter: mainPrinterName, colorPrinter: colorPrinterName }),
    );
  } catch (e) {
    console.error("Error saving printer config:", e);
  }
};

// Non-empty, length-capped printer names (rejects garbage/oversized input)
const isValidPrinterName = (name) =>
  typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200;

const normalizePrinterName = (name) => (isValidPrinterName(name) ? name.trim() : null);

// Spool guardrails: 100MB cap + async writes
const MAX_SPOOL_BYTES = 100 * 1024 * 1024;

// Initialize secure spool directory
const spoolDir = path.join(app.getPath("temp"), "printalfa_spool");
try {
  if (!fs.existsSync(spoolDir)) {
    fs.mkdirSync(spoolDir, { recursive: true });
  }
} catch (e) {
  console.error("Could not create spool directory:", e);
}

function parsePageRanges(pageRangeStr) {
  if (
    !pageRangeStr ||
    typeof pageRangeStr !== "string" ||
    pageRangeStr.toUpperCase() === "ALL"
  ) {
    return undefined;
  }
  const ranges = [];
  const parts = pageRangeStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n.trim(), 10));
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        ranges.push({ from: start - 1, to: end - 1 });
      }
    } else {
      const page = parseInt(part, 10);
      if (!isNaN(page) && page > 0) {
        ranges.push({ from: page - 1, to: page - 1 });
      }
    }
  }
  return ranges.length > 0 ? ranges : undefined;
}

function printdropOrigins() {
  const trim = (v) => (v || "").replace(/\/$/, "");
  return {
    admin: trim(process.env.PRINTDROP_ADMIN_URL) || "http://localhost:3001",
    api: trim(process.env.PRINTDROP_API_URL) || "http://localhost:3000",
    realtime: trim(process.env.PRINTDROP_REALTIME_URL) || "http://localhost:8086",
  };
}

function wsOrigin(httpOrigin) {
  return httpOrigin.replace(/^http/, "ws");
}

function createWindow() {
  const isDev = process.env.NODE_ENV === "development";
  const origins = printdropOrigins();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev,
      preload: path.join(__dirname, "preload.cjs"),
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, "printalfa.ico"),
  });

  // Renderer must never navigate the app window or pop unrestricted windows:
  // external https links open in the OS browser, everything else is denied.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Migrated: the dashboard is served by the admin Next.js origin
    // (local-first default http://localhost:3001); file:// no longer used.
    const allowed =
      url.startsWith(origins.admin + "/") ||
      url === origins.admin ||
      (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url));
    if (!allowed) {
      event.preventDefault();
    }
  });

  // Migrated from Vite dist/: the Next.js admin origin serves the UI in
  // both dev and production (local-first). Override with
  // PRINTDROP_ADMIN_URL when the admin UI is hosted elsewhere.
  mainWindow.loadURL(origins.admin);
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("close", function (event) {
    // Hide-to-tray only when the tray icon exists; otherwise let the window
    // close normally so the app can never strand itself invisible.
    if (!app.isQuiting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  // Bundle the existing printalfa.ico; if it is missing, skip hide-to-tray
  // entirely (tray stays null) instead of crashing on a bad icon path.
  const trayIcon = path.join(__dirname, "printalfa.ico");
  if (!fs.existsSync(trayIcon)) {
    console.warn("Tray icon missing, hide-to-tray disabled.");
    tray = null;
    return;
  }
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        mainWindow.show();
      },
    },
    { type: "separator" },
    { label: "Client Status: Connected", enabled: false },
    { label: "Printer Status: Ready", enabled: false },
    { type: "separator" },
    {
      label: "Exit PrintAlfa",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("PrintAlfa Admin Client");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  const { session } = require("electron");
  const isDev = process.env.NODE_ENV === "development";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Migrated CSP: dashboard/API/realtime origins follow the configured
    // PrintDrop origins (local-first defaults); qrserver kept for QR art.
    // Downloads stream through the API Route Handler, so no object-store
    // host is allowlisted here.
    const origins = printdropOrigins();
    const api = origins.api;
    const rt = origins.realtime;
    const wsRt = wsOrigin(rt);
    let csp =
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      "img-src 'self' data: blob: file: https://api.qrserver.com; " +
      `connect-src 'self' ${api} ${rt} ${wsRt} https://api.qrserver.com;`;
    if (isDev) {
      csp =
        "default-src 'self'; " +
        `script-src 'self' 'unsafe-inline' ${origins.admin}; ` +
        `style-src 'self' 'unsafe-inline' ${origins.admin}; ` +
        `font-src 'self' data: ${origins.admin}; ` +
        `img-src 'self' data: blob: file: https://api.qrserver.com ${origins.admin}; ` +
        `connect-src 'self' ${api} ${rt} ${wsRt} ${origins.admin} ${wsOrigin(origins.admin)};`;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  createWindow();
  try {
    createTray();
  } catch (e) {
    console.error("Tray icon failed to load, missing icon?", e);
  }

  // Set App User Model ID for Windows Notifications (stable appId)
  app.setAppUserModelId("com.printalfa.admin");

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Auto-start is opt-in (default off). Toggle via settings IPC below.
// app.setLoginItemSettings({ openAtLogin: true }) removed; enable only on request.
ipcMain.handle("get-auto-start", () => {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return false;
  }
});
ipcMain.handle("set-auto-start", (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: app.getPath("exe") });
  return Boolean(enabled);
});

// ==================== DEVICE APIs ====================
ipcMain.handle("get-device-id", () => deviceId);
ipcMain.handle("get-device-name", () => os.hostname());
ipcMain.handle("get-app-version", () => app.getVersion());

// ==================== IPC HANDLERS FOR PRINTING ====================

// 1. Get list of installed Windows printers
ipcMain.handle("get-printers", async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || "",
        status: p.status,
        isDefault: p.isDefault,
      }));
    }
    return [];
  } catch (err) {
    console.error("Failed to query printers:", err);
    return [];
  }
});

// 2. Selected printers persistence
ipcMain.handle("get-printers-config", async () => {
  return { mainPrinter: mainPrinterName, colorPrinter: colorPrinterName };
});

ipcMain.handle(
  "set-printers-config",
  async (event, { mainPrinter, colorPrinter }) => {
    if (mainPrinter !== undefined) {
      mainPrinterName = mainPrinter ? normalizePrinterName(mainPrinter) : null;
    }
    if (colorPrinter !== undefined) {
      colorPrinterName = colorPrinter ? normalizePrinterName(colorPrinter) : null;
    }
    savePrintersConfig();
    return {
      success: true,
      mainPrinter: mainPrinterName,
      colorPrinter: colorPrinterName,
    };
  },
);

// 3. Test Print
ipcMain.handle("test-print", async (event, { printerName }) => {
  const targetPrinter = normalizePrinterName(printerName);
  if (!targetPrinter) {
    throw new Error(
      "No printer selected. Please select a Windows printer in Settings.",
    );
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>PrintAlfa Test Page</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #111; line-height: 1.6; }
        .header { border-bottom: 3px solid #111; padding-bottom: 15px; margin-bottom: 25px; }
        h1 { margin: 0; font-size: 26px; font-weight: bold; }
        .details { font-size: 14px; margin-bottom: 20px; }
        .box { border: 2px dashed #444; padding: 20px; background: #f4f4f4; border-radius: 8px; }
        .success-badge { display: inline-block; padding: 6px 12px; background: #10b981; color: #fff; font-weight: bold; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>PrintAlfa — Windows Print Client Test Page</h1>
        <p>Real Physical Printing Verification</p>
      </div>
      <div class="details">
        <p><strong>Target Printer:</strong> ${targetPrinter}</p>
        <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Hostname:</strong> ${os.hostname()}</p>
        <p><strong>Operating System:</strong> ${os.type()} ${os.release()} (${process.arch})</p>
      </div>
      <div class="box">
        <span class="success-badge">PASSED</span>
        <p>✓ The PrintAlfa Windows Print Client successfully routed this test document through the local Windows Print Spooler to your physical printer.</p>
      </div>
    </body>
    </html>
  `;

  try {
    return await new Promise((resolve, reject) => {
      printWindow.webContents.on("did-finish-load", () => {
        setTimeout(() => {
          if (printWindow.isDestroyed()) return;
          printWindow.webContents.print(
            {
              silent: true,
              deviceName: targetPrinter,
              printBackground: true,
            },
            (success, errorType) => {
              if (!printWindow.isDestroyed()) printWindow.destroy();
              if (!success) {
                reject(
                  new Error(
                    `Print job cancelled or failed by Windows spooler. Reason: ${errorType || "Unknown error"}`,
                  ),
                );
              } else {
                resolve({
                  success: true,
                  message: `Test page sent to ${targetPrinter}`,
                });
              }
            },
          );
        }, 500);
      });

      printWindow
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`)
        .catch((err) => {
          if (!printWindow.isDestroyed()) printWindow.destroy();
          reject(err);
        });
    });
  } catch (err) {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    throw err;
  }
});

// 4. Print actual customer document
ipcMain.handle(
  "print-document",
  async (
    event,
    { base64Data, originalFileName, contentType, printSettings },
  ) => {
    const isColorOrPhoto =
      printSettings?.colorMode === "COLOR" ||
      printSettings?.printType === "PASSPORT_PHOTO" ||
      printSettings?.printType === "PHOTO";
    const targetPrinter = normalizePrinterName(isColorOrPhoto ? colorPrinterName : mainPrinterName);

    if (!targetPrinter) {
      throw new Error(
        isColorOrPhoto
          ? "Color/Photo printer unavailable."
          : "Main printer unavailable.",
      );
    }

    if (!base64Data) {
      throw new Error("Document data is missing or empty.");
    }

    // Chromium can only render PDF and images. Office formats would print
    // blank/garbage, so fail loudly instead of silently misprinting.
    const printableType =
      contentType === "application/pdf" ||
      (typeof contentType === "string" && contentType.startsWith("image/")) ||
      [".pdf", ".png", ".jpg", ".jpeg"].includes(
        path.extname(originalFileName || "").toLowerCase(),
      );
    if (!printableType) {
      throw new Error(
        `Unsupported print format "${path.extname(originalFileName || "") || contentType || "unknown"}": only PDF and images can be printed directly. Convert the document to PDF and retry.`,
      );
    }

    const ext =
      path.extname(originalFileName || "").toLowerCase() ||
      (contentType === "application/pdf" ? ".pdf" : ".dat");
    const tempFileName = `spool_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const tempFilePath = path.join(spoolDir, tempFileName);

    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > MAX_SPOOL_BYTES) {
      throw new Error("Document exceeds the 100MB spool limit.");
    }
    await fs.promises.writeFile(tempFilePath, buffer);

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    // Copies clamped to the server-side maximum (backend MAX_COPIES_PER_ITEM=100);
    // guards against NaN and crafted payloads spooling arbitrary copy counts.
    const parsedCopies = parseInt(printSettings?.copies || 1, 10);
    const copies = Math.min(
      100,
      Math.max(1, Number.isFinite(parsedCopies) ? parsedCopies : 1),
    );
    const isColor = printSettings?.colorMode === "COLOR";
    const isDoubleSided = printSettings?.printSide === "DOUBLE";
    const duplexMode = isDoubleSided ? "longEdge" : "simplex";
    const pageSize =
      (printSettings?.paperSize || "A4").toUpperCase() === "A3" ? "A3" : "A4";
    const pageRanges = parsePageRanges(printSettings?.pageRange);

    const printOptions = {
      silent: true,
      deviceName: targetPrinter,
      copies: copies,
      color: isColor,
      duplexMode: duplexMode,
      pageSize: pageSize,
      printBackground: true,
    };

    if (pageRanges && pageRanges.length > 0) {
      printOptions.pageRanges = pageRanges;
    }

    try {
      return await new Promise((resolve, reject) => {
        printWindow.webContents.on("did-finish-load", () => {
          setTimeout(() => {
            if (printWindow.isDestroyed()) return;
            printWindow.webContents.print(
              printOptions,
              (success, errorType) => {
                try {
                  if (!printWindow.isDestroyed()) printWindow.destroy();
                  if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (e) {
                  console.warn("Spool cleanup warning:", e);
                }

                if (!success) {
                  reject(
                    new Error(
                      `Print job cancelled by Windows spooler. Reason: ${errorType || "Unknown error"}`,
                    ),
                  );
                } else {
                  resolve({
                    success: true,
                    message: `Document printed to ${targetPrinter}`,
                  });
                }
              },
            );
          }, 800);
        });

        let loadPromise;
        if (contentType === "application/pdf" || ext === ".pdf") {
          loadPromise = printWindow.loadURL(
            `file://${tempFilePath.replace(/\\/g, "/")}`,
          );
        } else if (contentType && contentType.startsWith("image/")) {
          const imgHtml = `
          <!DOCTYPE html>
          <html>
          <head><style>body { margin: 0; display: flex; justify-content: center; align-items: center; } img { max-width: 100%; height: auto; }</style></head>
          <body><img src="file://${tempFilePath.replace(/\\/g, "/")}" /></body>
          </html>
        `;
          loadPromise = printWindow.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(imgHtml)}`,
          );
        } else {
          loadPromise = printWindow.loadURL(
            `file://${tempFilePath.replace(/\\/g, "/")}`,
          );
        }

        loadPromise.catch((err) => {
          try {
            if (!printWindow.isDestroyed()) printWindow.destroy();
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          } catch (e) {}
          reject(err);
        });
      });
    } catch (err) {
      try {
        if (!printWindow.isDestroyed()) printWindow.destroy();
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (e) {}
      throw err;
    }
  },
);

// Notifications
let notificationWindow = null;
let notificationOrderId = null;

ipcMain.on("show-notification", (event, { title, body }) => {
  // Type/length-guard renderer-supplied notification text.
  const safeTitle = typeof title === "string" ? title.slice(0, 120) : "PrintAlfa";
  const safeBody = typeof body === "string" ? body.slice(0, 500) : "";
  const iconPath = path.join(__dirname, "printalfa.ico");
  new Notification({
    title: safeTitle,
    body: safeBody,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
  }).show();
});

ipcMain.on("show-order-notification", (event, payload) => {
  const order = payload?.order || payload;
  // Log ids only — never full order PII.
  console.log("[PrintAlfa IPC] show-order-notification received, orderId:", order?.id, "orderNumber:", order?.orderNumber);

  if (!order) {
    console.error("[PrintAlfa IPC] No order payload provided to show-order-notification");
    return;
  }

  // Same-order duplicate event: focus the existing popup instead of
  // rebuilding (prevents flicker + duplicate windows for one order).
  if (notificationWindow && !notificationWindow.isDestroyed()
      && notificationOrderId && order.id && notificationOrderId === order.id) {
    try {
      notificationWindow.show();
    } catch (e) {}
    return;
  }

  if (notificationWindow) {
    try {
      notificationWindow.destroy();
    } catch (e) {}
    notificationWindow = null;
    notificationOrderId = null;
  }

  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const popupWidth = 400;
  const popupHeight = 470;

  console.log("[PrintAlfa IPC] creating notification window");
  notificationOrderId = order.id || null;
  notificationWindow = new BrowserWindow({
    width: popupWidth,
    height: popupHeight,
    x: width - popupWidth - 20,
    y: height - popupHeight - 20,
    frame: false,
    transparent: false,
    backgroundColor: "#0b0d10",
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: true,
    movable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "popup-preload.cjs"),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Notification-level pinning: above the dashboard but below system UI.
  notificationWindow.setAlwaysOnTop(true, "pop-up-menu");

  const orderHash = `/notification?order=${encodeURIComponent(JSON.stringify(order))}`;
  // Migrated: popups load the admin Next.js origin hash route (the
  // #/notification route is preserved in the port).
  notificationWindow.loadURL(`${printdropOrigins().admin}/#${orderHash}`);

  notificationWindow.webContents.on("did-finish-load", () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.show();
    }
  });

  const destroyPopup = (reason) => {
    try {
      if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.destroy();
      }
    } catch (e) {}
    notificationWindow = null;
    notificationOrderId = null;
    if (reason) {
      console.log("[PrintAlfa IPC] notification window closed:", reason);
    }
  };

  notificationWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error(
      "[PrintAlfa IPC] notification window failed:",
      errorCode,
      errorDescription
    );
    // Never leave a blank zombie on screen.
    destroyPopup("load-failed");
  });

  notificationWindow.webContents.on("render-process-gone", (event, details) => {
    console.error("[PrintAlfa IPC] notification renderer gone:", details && details.reason);
    destroyPopup("renderer-gone");
  });

  notificationWindow.on("closed", () => {
    notificationWindow = null;
    notificationOrderId = null;
  });
});

// Dismiss closes the popup only — the order stays in the dashboard queue.
// (DECLINE is a separate explicit action via order-action-result.)
ipcMain.on("dismiss-popup", () => {
  try {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.destroy();
    }
  } catch (e) {}
  notificationWindow = null;
  notificationOrderId = null;
});

const ORDER_POPUP_ACTIONS = new Set(["ACCEPT_AND_PRINT", "DECLINE"]);

ipcMain.on("order-action-result", (event, { orderId, action }) => {
  // Allowlist popup actions; ignore malformed/forged payloads.
  if (typeof orderId !== "string" || !ORDER_POPUP_ACTIONS.has(action)) {
    return;
  }
  if (notificationWindow) {
    notificationWindow.destroy();
    notificationWindow = null;
    notificationOrderId = null;
  }
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("order-action-result", { orderId, action });
  }
});
