import { api } from "../api";
import { getNotifPref } from "./notifyPrefs";

class PrintClient {
  constructor() {
    this.mainPrinter = localStorage.getItem("main_printer_name") || null;
    this.colorPrinter = localStorage.getItem("color_printer_name") || null;
    this.activeJobs = new Set();
    this.jobProgress = new Map();
    this.listeners = new Set();
    this.logs = [];
    this.status = "IDLE"; // "IDLE" | "PRINTING" | "ERROR"

    // Synchronize with Electron on startup if available (read-only: never
    // auto-claim/push local printer names into the agent config).
    // NOTE: the order-notification popup uses a minimal preload surface that
    // does not expose printer APIs — calling an undefined bridge method throws
    // synchronously and would blank the popup, so check the method exists.
    if (window.electronAPI && typeof window.electronAPI.getPrintersConfig === "function") {
      try {
        window.electronAPI.getPrintersConfig().then((config) => {
          if (config && config.mainPrinter) {
            this.mainPrinter = config.mainPrinter;
          }
          if (config && config.colorPrinter) {
            this.colorPrinter = config.colorPrinter;
          }
          this.notify();
        }).catch(() => {});
      } catch {
        // Non-Electron or minimal-preload context: keep localStorage values.
      }
    }
  }

  addLog(message, type = "info") {
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };
    this.logs = [logEntry, ...this.logs.slice(0, 49)];
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        console.error("PrintClient listener error:", e);
      }
    }
  }

  getState() {
    return {
      mainPrinter: this.mainPrinter,
      colorPrinter: this.colorPrinter,
      status: this.status,
      activeJobsCount: this.activeJobs.size,
      jobProgress: Object.fromEntries(this.jobProgress.entries()),
      logs: this.logs,
      isElectron: Boolean(window.electronAPI?.isElectron),
    };
  }

  async setPrintersConfig({ mainPrinter, colorPrinter }) {
    if (mainPrinter !== undefined) {
      this.mainPrinter = mainPrinter;
      if (mainPrinter) localStorage.setItem("main_printer_name", mainPrinter);
      else localStorage.removeItem("main_printer_name");
    }
    
    if (colorPrinter !== undefined) {
      this.colorPrinter = colorPrinter;
      if (colorPrinter) localStorage.setItem("color_printer_name", colorPrinter);
      else localStorage.removeItem("color_printer_name");
    }

    if (window.electronAPI?.setPrintersConfig) {
      await window.electronAPI.setPrintersConfig({ mainPrinter: this.mainPrinter, colorPrinter: this.colorPrinter });
    }
    this.addLog(`Printers updated - Main: ${this.mainPrinter || "None"}, Color: ${this.colorPrinter || "None"}`, "info");
    this.notify();
  }

  async executePrintJob(job, customItems = null, onItemStatus = null) {
    const jobId = job.id || job.jobId; // Allow accepting direct order object
    this.activeJobs.add(jobId);
    this.status = "PRINTING";

    const allItems = job.items && job.items.length > 0
      ? job.items
      : job.order?.items && job.order.items.length > 0
      ? job.order.items
      : [
          {
            id: job.id,
            document: job.document || job.order?.document,
            printType: job.printType || job.order?.printType || "PRINT",
            colorMode: job.colorMode || job.order?.colorMode || "BW",
            paperSize: job.paperSize || job.order?.paperSize || "A4",
            printSide: job.printSide || job.order?.printSide || "SINGLE",
            copies: job.copies || job.order?.copies || 1,
            pageRange: job.pageRange || job.order?.pageRange || "ALL",
          },
        ];

    const items = customItems && customItems.length > 0 ? customItems : allItems;
    const firstItem = items[0] || {};
    const isFirstColorOrPhoto =
      firstItem.colorMode === "COLOR" ||
      firstItem.printType === "PASSPORT_PHOTO" ||
      firstItem.printType === "PHOTO";
    const initialTargetPrinter = isFirstColorOrPhoto
      ? this.colorPrinter || "Color Printer"
      : this.mainPrinter || this.colorPrinter || "Main Printer";

    this.jobProgress.set(jobId, {
      stage: "PRINT_PREPARING",
      stageTitle: "PREPARING",
      stageMessage: "Preparing print files...",
      currentFileIndex: 0,
      totalFiles: items.length,
      currentFileName: firstItem.document?.originalFileName || "Document",
      currentPage: 1,
      totalPages: firstItem.calculatedPages || firstItem.document?.pageCount || 1,
      copies: firstItem.copies || 1,
      targetPrinter: initialTargetPrinter,
      isIndeterminate: true,
      percent: 0,
      error: null,
    });
    this.notify();

    const orderNum = job.orderNumber || (job.order && job.order.orderNumber) || "Unknown";
    this.addLog(
      `Executing print job for Order #${orderNum} (${items.length} file${items.length > 1 ? "s" : ""})...`,
      "info"
    );

    try {
      if (!this.mainPrinter && !this.colorPrinter) {
        throw new Error("No Windows printers configured. Please select a printer in Settings.");
      }

      // Print each document
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const doc = item.document;
        if (!doc || !doc.id) {
          throw new Error(`Item #${i + 1} has no document reference`);
        }

        const isColorOrPhoto =
          item.colorMode === "COLOR" ||
          item.printType === "PASSPORT_PHOTO" ||
          item.printType === "PHOTO";
        const targetPrinter = isColorOrPhoto
          ? this.colorPrinter || this.mainPrinter
          : this.mainPrinter || this.colorPrinter;

        const docPageCount = item.calculatedPages || doc.pageCount || 1;
        const currentFileName = doc.originalFileName || `File ${i + 1}`;

        if (onItemStatus) {
          onItemStatus(item, "PRINTING");
        }
        if (job.id && item.id) {
          api.patch(`/admin/orders/${job.id}/items/${item.id}/status`, { printStatus: "PRINTING" }).catch(() => {});
        }

        // DOWNLOADING STAGE
        this.jobProgress.set(jobId, {
          stage: "PRINT_DOWNLOADING",
          stageTitle: "DOWNLOADING",
          stageMessage: `Downloading ${currentFileName}...`,
          currentFileIndex: i + 1,
          totalFiles: items.length,
          currentFileName: currentFileName,
          currentPage: 1,
          totalPages: docPageCount,
          copies: item.copies || 1,
          targetPrinter: targetPrinter || "Printer",
          isIndeterminate: true,
          percent: items.length > 1 ? Math.round((i / items.length) * 100) : null,
          error: null,
        });
        this.notify();

        this.addLog(
          `Downloading document ${currentFileName} (File ${i + 1}/${items.length})...`,
          "info"
        );

        // Download document through secure authorized backend endpoint
        const docResponse = await api.get(`/print-agent/documents/${doc.id}/download`, {
          responseType: "arraybuffer",
        });

        // Convert arraybuffer to Base64
        const uint8Array = new Uint8Array(docResponse.data);
        let binaryString = "";
        const chunkSize = 8192;
        for (let j = 0; j < uint8Array.length; j += chunkSize) {
          binaryString += String.fromCharCode.apply(
            null,
            uint8Array.subarray(j, j + chunkSize)
          );
        }
        const base64Data = btoa(binaryString);

        // Extract item print settings
        const printSettings = {
          printType: item.printType || "PRINT",
          colorMode: item.colorMode || "BW",
          paperSize: item.paperSize || "A4",
          printSide: item.printSide || "SINGLE",
          copies: item.copies || 1,
          pageRange: item.pageRange || "ALL",
        };

        // PRINTING STAGE (Spooling to Windows printer)
        this.jobProgress.set(jobId, {
          stage: "PRINTING",
          stageTitle: "PRINTING",
          stageMessage: `Sending ${currentFileName} to printer...`,
          currentFileIndex: i + 1,
          totalFiles: items.length,
          currentFileName: currentFileName,
          currentPage: docPageCount,
          totalPages: docPageCount,
          copies: printSettings.copies,
          targetPrinter: targetPrinter || "Printer",
          isIndeterminate: items.length === 1,
          percent: items.length > 1 ? Math.round(((i) / items.length) * 100) : null,
          error: null,
        });
        this.notify();

        this.addLog(
          `Sending ${currentFileName} to printer (${printSettings.copies}x, ${printSettings.colorMode}, printer: ${targetPrinter})...`,
          "info"
        );

        if (window.electronAPI?.printDocument) {
          // Real Windows physical print spooling via Electron
          await window.electronAPI.printDocument({
            base64Data,
            originalFileName: doc.originalFileName || "document.pdf",
            contentType: doc.contentType || "application/pdf",
            printSettings
          });
        } else {
          // No printer agent in browser: fail honestly, never fake success.
          throw new Error("Printer agent unavailable. Open the PrintAlfa desktop app to print.");
        }

        // File i completed
        if (onItemStatus) {
          onItemStatus(item, "PRINTED");
        }
        if (job.id && item.id) {
          api.patch(`/admin/orders/${job.id}/items/${item.id}/status`, { printStatus: "COMPLETED" }).catch(() => {});
        }

        if (items.length > 1) {
          this.jobProgress.set(jobId, {
            stage: "PRINTING",
            stageTitle: "PRINTING",
            stageMessage: `Printed ${currentFileName}`,
            currentFileIndex: i + 1,
            totalFiles: items.length,
            currentFileName: currentFileName,
            currentPage: docPageCount,
            totalPages: docPageCount,
            copies: printSettings.copies,
            targetPrinter: targetPrinter || "Printer",
            isIndeterminate: false,
            percent: Math.round(((i + 1) / items.length) * 100),
            error: null,
          });
          this.notify();
        }
      }

      // COMPLETED STAGE
      this.jobProgress.set(jobId, {
        stage: "PRINT_COMPLETED",
        stageTitle: "COMPLETED",
        stageMessage: `${items.length} file${items.length > 1 ? "s" : ""} printed successfully`,
        currentFileIndex: items.length,
        totalFiles: items.length,
        currentFileName: items[items.length - 1]?.document?.originalFileName || "Document",
        currentPage: 1,
        totalPages: 1,
        targetPrinter: this.mainPrinter || this.colorPrinter || "Printer",
        isIndeterminate: false,
        percent: 100,
        error: null,
      });
      this.addLog(`✓ Successfully printed ${items.length} file(s) for Order #${orderNum}`, "success");
      return { success: true };
    } catch (err) {
      console.error(`Failed executing print job ${jobId}:`, err);
      const prevProgress = this.jobProgress.get(jobId);
      this.jobProgress.set(jobId, {
        stage: "PRINT_FAILED",
        stageTitle: "PRINT FAILED",
        stageMessage: err.message || "Printer unavailable or spool failed",
        currentFileIndex: prevProgress?.currentFileIndex || 1,
        totalFiles: items.length,
        currentFileName: prevProgress?.currentFileName || "Document",
        targetPrinter: prevProgress?.targetPrinter || this.mainPrinter || "Printer",
        isIndeterminate: false,
        percent: null,
        error: err.message || "Printer unavailable",
      });
      this.addLog(`✗ Print Failed for Order #${orderNum}: ${err.message}`, "error");
      
      if (window.electronAPI?.showNotification && getNotifPref("printerAlerts", true)) {
        window.electronAPI.showNotification(
          "Print Failed",
          `Order #${orderNum} failed: ${err.message}`
        );
      }
      throw err;
    } finally {
      this.activeJobs.delete(jobId);
      this.status = this.activeJobs.size > 0 ? "PRINTING" : "IDLE";
      this.notify();
    }
  }

  async testPrint(printerName) {
    const target = printerName;
    if (!target) {
      throw new Error("No printer selected for test print.");
    }

    this.addLog(`Triggering test print to ${target}...`, "info");

    if (window.electronAPI?.testPrint) {
      const res = await window.electronAPI.testPrint(target);
      this.addLog(`✓ Test print page sent to ${target}`, "success");
      return res;
    } else {
      // No printer agent in browser: fail honestly, never simulate success.
      throw new Error("Printer agent unavailable. Open the PrintAlfa desktop app to test print.");
    }
  }
}

export const printClient = new PrintClient();
