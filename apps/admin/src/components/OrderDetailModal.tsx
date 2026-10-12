"use client";
import React, { useState, useEffect } from "react";
import {
  downloadDocumentFile,
  updateItemPrintStatus,
  getDocumentPreviewUrl,
  updateOrderPrintStatus,
  getItemDocumentVersions,
  swapItemDocument,
} from "../api";
import { printClient } from "../services/printClient";
import mammoth from "mammoth";
import { MaterialIcon } from "./ui/MaterialIcon";

export const OrderDetailModal = ({
  order,
  onClose,
  onUpdateStatus,
  onUpdatePaymentStatus,
  onPrintOrder,
  onDeleteFiles,
  onDeleteOrder,
  onEditItem,
  onOrderChanged,
  clientState,
}) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [downloadingDocId, setDownloadingDocId] = useState<any>(null);
  const [isPrintingLocal, setIsPrintingLocal] = useState(false);
  const [printError, setPrintError] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [swappingVersion, setSwappingVersion] = useState(false);
  const [versionError, setVersionError] = useState<any>(null);

  // Multi-file selection checkboxes (indices)
  const [checkedIndices, setCheckedIndices] = useState<any>(new Set());

  const items = order.items && order.items.length > 0 ? order.items : [];
  const itemCount = items.length > 0 ? items.length : 1;

  const hasFiles = Boolean(
    (items.length > 0 && items.some((it) => it.document && it.document.id)) ||
    (order.document && order.document.id)
  );

  // Stable per-item keys: backend item id when present, otherwise a
  // position-scoped fallback that can never collide with a real id.
  const itemKeyOf = (item, idx) =>
    item && item.id !== undefined && item.id !== null ? item.id : `local-${idx}`;
  const findItemIdx = (itm) =>
    items.findIndex(
      (x) =>
        (x.id !== undefined &&
          x.id !== null &&
          itm?.id !== undefined &&
          itm?.id !== null &&
          x.id === itm.id) ||
        (x.document?.id && itm?.document?.id && x.document.id === itm.document.id),
    );
  const resolveItemKey = (itm, fallbackIdx = 0) => {
    if (itm && itm.id !== undefined && itm.id !== null) return itm.id;
    const fi = findItemIdx(itm);
    return `local-${fi !== -1 ? fi : fallbackIdx}`;
  };

  // Minimal sanitizer for mammoth-generated HTML: strip scripts, embedded
  // frames/objects and inline event handlers before dangerouslySetInnerHTML.
  const sanitizeDocxHtml = (html) => {
    if (!html || typeof html !== "string") return "";
    return html
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<(iframe|object|embed|form|meta|link|base)[\s\S]*?(?:<\/\1\s*>|\/>|>)/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  };

  // Per-item print status state map: { [stableItemKey]: 'READY' | 'PRINTING' | 'PRINTED' | 'FAILED' }
  const [itemStatusMap, setItemStatusMap] = useState(() => {
    const map = {};
    const itms = order.items && order.items.length > 0 ? order.items : [];
    const isOrderCompleted = order.printStatus === "COMPLETED";

    itms.forEach((itm, idx) => {
      const key = itm.id !== undefined && itm.id !== null ? itm.id : `local-${idx}`;
      if (isOrderCompleted || itm.printStatus === "COMPLETED") {
        map[key] = "PRINTED";
      } else if (itm.printStatus === "PRINTING") {
        map[key] = "PRINTING";
      } else if (itm.printStatus === "FAILED") {
        map[key] = "FAILED";
      } else {
        map[key] = "READY";
      }
    });

    if (itms.length === 0) {
      map[0] = isOrderCompleted ? "PRINTED" : "READY";
    }
    return map;
  });

  // Preview state for selected file
  const [previewDocId, setPreviewDocId] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<any>(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [previewType, setPreviewType] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [docxHtml, setDocxHtml] = useState<any>(null);

  const previewUrlRef = React.useRef<any>(null);
  const revokePreviewUrl = () => {
    if (previewUrlRef.current) {
      try {
        window.URL.revokeObjectURL(previewUrlRef.current);
      } catch {}
      previewUrlRef.current = null;
    }
  };

  // Revoke any lingering preview object URL on unmount (blob leak fix).
  useEffect(() => () => revokePreviewUrl(), []);

  const totalCalculatedPages =
    items.length > 0
      ? items.reduce(
          (sum, item) =>
            sum + (item.calculatedPages || item.document?.pageCount || 1),
          0,
        )
      : order.document?.pageCount || order.calculatedPages || 1;

  // Selected item and document
  const selectedItem = items[selectedFileIndex] || items[0] || {
    id: order.id,
    document: order.document,
    printType: order.printType || "PRINT",
    colorMode: order.colorMode || "BW",
    paperSize: order.paperSize || "A4",
    printSide: order.printSide || "SINGLE",
    pageRange: order.pageRange || "ALL",
    copies: order.copies || 1,
    calculatedPages: totalCalculatedPages,
    unitPrice: order.totalPrice,
    itemPrice: order.totalPrice,
  };

  const selectedDoc = selectedItem.document || order.document;

  // Real-time printing progress for this specific order
  const orderJobProgress = clientState?.jobProgress?.[order.id];

  // Count how many files are printed
  const printedFilesCount = items.length > 0
    ? items.filter((it, idx) => itemStatusMap[itemKeyOf(it, idx)] === "PRINTED").length
    : itemStatusMap[0] === "PRINTED" ? 1 : 0;

  const isPartiallyPrinted = printedFilesCount > 0 && printedFilesCount < itemCount;
  const isAllFilesPrinted = printedFilesCount === itemCount || order.printStatus === "COMPLETED";

  // Checkbox Selection Helpers
  const toggleCheck = (idx, e) => {
    e?.stopPropagation();
    setCheckedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = (e) => {
    e?.stopPropagation();
    if (checkedIndices.size === itemCount) {
      setCheckedIndices(new Set());
    } else {
      const all = new Set();
      for (let i = 0; i < itemCount; i++) all.add(i);
      setCheckedIndices(all);
    }
  };

  // Lazy load preview for the selected file
  useEffect(() => {
    if (!selectedDoc?.id) return;
    if (previewDocId === selectedDoc.id && previewUrl) return;

    let isMounted = true;
    const loadPreview = async () => {
      setIsPreviewLoading(true);
      setPreviewError(false);
      setDocxHtml(null);

      const fileName = selectedDoc.originalFileName || "Document";
      const contentType = selectedDoc.contentType || "application/pdf";
      setPreviewFileName(fileName);
      setPreviewType(contentType);

      try {
        const url = await getDocumentPreviewUrl(selectedDoc.id, contentType);
        if (!isMounted) return;

        // Revoke the previous blob URL before adopting the new one.
        revokePreviewUrl();
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewDocId(selectedDoc.id);

        const isDocx =
          fileName.toLowerCase().endsWith(".docx") ||
          contentType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (isDocx) {
          try {
            const resp = await fetch(url);
            const arrayBuffer = await resp.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer });
            if (isMounted) setDocxHtml(sanitizeDocxHtml(result.value));
          } catch (docxErr: any) {
            console.warn("Docx conversion failed:", docxErr);
          }
        }
      } catch (err: any) {
        console.error("Failed to load preview:", err);
        if (isMounted) setPreviewError(true);
      } finally {
        if (isMounted) setIsPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
    };
  }, [selectedDoc?.id]);

  const handleDownloadDoc = async (docId, fileName, e) => {
    e?.stopPropagation();
    if (!docId) return;
    try {
      setDownloadingDocId(docId);
      await downloadDocumentFile(docId, fileName);
    } catch (err: any) {
      console.error("Failed to download document:", err);
    } finally {
      setDownloadingDocId(null);
    }
  };

  // Document Studio: PDF/JPG/PNG are editable; DOC/DOCX are honestly
  // reported as unsupported (no fake editing).
  const isEditableDoc = (doc) => {
    if (!doc) return false;
    const ct = String(doc.contentType || "").toLowerCase();
    const fn = String(doc.originalFileName || "").toLowerCase();
    if (ct === "application/pdf" || fn.endsWith(".pdf")) return true;
    if (ct.startsWith("image/") || /\.(jpg|jpeg|png)$/.test(fn)) return true;
    return false;
  };

  const selectedItemForVersions =
    items[selectedFileIndex] || items[0] || null;
  const selectedItemIdForVersions = selectedItemForVersions?.id || null;

  // Load Original/Edited versions for the selected file.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!selectedItemIdForVersions) {
        setVersions([]);
        return;
      }
      setVersionsLoading(true);
      setVersionError(null);
      try {
        const list = await getItemDocumentVersions(order.id, selectedItemIdForVersions);
        if (!cancelled) setVersions(Array.isArray(list) ? list : []);
      } catch (err: any) {
        if (!cancelled) {
          console.error("Failed to load document versions:", err);
          setVersions([]);
        }
      } finally {
        if (!cancelled) setVersionsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [order.id, selectedItemIdForVersions]);

  const handleUseVersion = async (documentId) => {
    if (!selectedItemIdForVersions || !documentId || swappingVersion) return;
    setSwappingVersion(true);
    setVersionError(null);
    try {
      const updated = await swapItemDocument(order.id, selectedItemIdForVersions, documentId);
      if (onOrderChanged) onOrderChanged(updated);
      const list = await getItemDocumentVersions(order.id, selectedItemIdForVersions);
      setVersions(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error("Failed to switch document version:", err);
      setVersionError(err.response?.data?.message || "Could not switch version (paid or printing orders are locked).");
    } finally {
      setSwappingVersion(false);
    }
  };

  // 1. PRINT INDIVIDUAL SINGLE FILE
  const handlePrintSingleItem = async (item, idx, e) => {
    e?.stopPropagation();
    if (isPrintingLocal || order.printStatus === "PRINTING") return;

    const itemKey = itemKeyOf(item, idx);
    setIsPrintingLocal(true);
    setPrintError(null);
    setItemStatusMap((prev) => ({ ...prev, [itemKey]: "PRINTING" }));

    try {
      await printClient.executePrintJob(order, [item], (itm, status) => {
        setItemStatusMap((prev) => ({ ...prev, [resolveItemKey(itm, idx)]: status }));
      });

      setItemStatusMap((prev) => {
        const next = { ...prev, [itemKey]: "PRINTED" };
        const allDone = items.length > 0
          ? items.every((it, i) => next[itemKeyOf(it, i)] === "PRINTED")
          : true;
        if (allDone) {
          onUpdateStatus(order.id, "COMPLETED");
        }
        return next;
      });
    } catch (err: any) {
      console.error(`Individual print failed for item ${idx + 1}:`, err);
      setItemStatusMap((prev) => ({ ...prev, [itemKey]: "FAILED" }));
      setPrintError(err.message || `Failed to print ${item.document?.originalFileName || "file"}`);
      // A failed single-file print must surface as FAILED, never stuck PRINTING.
      try {
        await onUpdateStatus(order.id, "FAILED");
      } catch (statusErr: any) {
        console.error("Failed to mark order FAILED:", statusErr);
      }
    } finally {
      setIsPrintingLocal(false);
    }
  };

  // 2. PRINT SELECTED CHECKED FILES
  const handlePrintSelected = async () => {
    if (isPrintingLocal || order.printStatus === "PRINTING") return;
    const selectedItems = items.length > 0
      ? items.filter((_, idx) => checkedIndices.has(idx))
      : [selectedItem];

    if (selectedItems.length === 0) return;

    setIsPrintingLocal(true);
    setPrintError(null);

    // Mark checked items as PRINTING
    selectedItems.forEach((itm) => {
      const itmIdx = items.indexOf(itm);
      const key = itemKeyOf(itm, itmIdx === -1 ? 0 : itmIdx);
      setItemStatusMap((prev) => ({ ...prev, [key]: "PRINTING" }));
    });

    try {
      await printClient.executePrintJob(order, selectedItems, (itm, status) => {
        setItemStatusMap((prev) => ({ ...prev, [resolveItemKey(itm)]: status }));
      });

      setItemStatusMap((prev) => {
        const next = { ...prev };
        selectedItems.forEach((itm) => {
          const itmIdx = items.indexOf(itm);
          next[itemKeyOf(itm, itmIdx === -1 ? 0 : itmIdx)] = "PRINTED";
        });

        const allDone = items.length > 0
          ? items.every((it, i) => next[itemKeyOf(it, i)] === "PRINTED")
          : true;
        if (allDone) {
          onUpdateStatus(order.id, "COMPLETED");
        }
        return next;
      });
      // Clear selection after printing
      setCheckedIndices(new Set());
    } catch (err: any) {
      console.error("Print selected failed:", err);
      setPrintError(err.message || "Failed to print selected files");
    } finally {
      setIsPrintingLocal(false);
    }
  };

  // 3. PRINT ALL FILES
  const handlePrintAll = async () => {
    if (order.printStatus === "PRINTING" || isPrintingLocal) return;

    setIsPrintingLocal(true);
    setPrintError(null);

    // Mark all items as PRINTING
    items.forEach((itm, idx) => {
      setItemStatusMap((prev) => ({ ...prev, [itemKeyOf(itm, idx)]: "PRINTING" }));
    });

    try {
      if (onPrintOrder) {
        await onPrintOrder(order);
      } else {
        await onUpdateStatus(order.id, "PRINTING");
        await printClient.executePrintJob(order, items, (itm, status) => {
          setItemStatusMap((prev) => ({ ...prev, [resolveItemKey(itm)]: status }));
        });
        await onUpdateStatus(order.id, "COMPLETED");
      }

      // Mark all items as PRINTED
      setItemStatusMap((prev) => {
        const next = { ...prev };
        items.forEach((it, i) => {
          next[itemKeyOf(it, i)] = "PRINTED";
        });
        if (items.length === 0) next[0] = "PRINTED";
        return next;
      });
    } catch (err: any) {
      console.error("Workspace print all failed:", err);
      setPrintError(err.message || "Failed to print order");
      // onPrintOrder already PATCHes FAILED on error — patch only for the local path.
      if (!onPrintOrder) {
        await onUpdateStatus(order.id, "FAILED");
      }
    } finally {
      setIsPrintingLocal(false);
    }
  };

  const isPrinting = order.printStatus === "PRINTING" || isPrintingLocal;
  const isCompleted = isAllFilesPrinted;
  const isFailed = order.printStatus === "FAILED" && !isPrinting && !isCompleted;

  const renderHeaderStatusBadge = () => {
    if (isPrinting) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-bold bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]">
          <MaterialIcon name="progress_activity" size={14} className="animate-spin text-[var(--color-accent)]" />
          <span>PRINTING IN PROGRESS</span>
        </span>
      );
    }

    if (isCompleted) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-bold bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
          <MaterialIcon name="check" size={14} className="text-black dark:text-white" />
          <span>COMPLETED ({itemCount}/{itemCount} PRINTED)</span>
        </span>
      );
    }

    if (isPartiallyPrinted) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-bold bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]">
          <span className="w-2 h-2 rounded-none bg-[var(--color-accent)]" />
          <span>PARTIALLY PRINTED ({printedFilesCount}/{itemCount})</span>
        </span>
      );
    }

    switch (order.printStatus) {
      case "PENDING":
      case "NEW":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-bold bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
            <span className="w-2 h-2 rounded-none bg-black dark:bg-white" />
            <span>NEW ORDER</span>
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-bold bg-[var(--color-error-bg)] text-[var(--color-error-text)] border border-[var(--color-error-border)]">
            <span className="w-2 h-2 rounded-none bg-black dark:bg-white" />
            <span>FAILED</span>
          </span>
        );
      case "CANCELLED":
      case "DECLINED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-semibold bg-[var(--border-subtle)] text-[var(--text-secondary)] border border-[var(--border-app)]">
            <span className="w-2 h-2 rounded-none bg-[var(--text-muted)]" />
            <span>CANCELLED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-bold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
            <span>{order.printStatus}</span>
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200" data-testid="order-modal">
      {/* DESKTOP SOFTWARE ORDER WORKSPACE PANEL */}
      <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-2xl w-full max-w-4xl h-[88vh] max-h-[860px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 text-[var(--text-primary)]">
        
        {/* FIXED HEADER */}
        <div className="px-5 py-3.5 border-b border-[var(--border-app)] bg-[var(--bg-surface)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <MaterialIcon name="folder_copy" size={20} className="text-[var(--color-accent)] shrink-0" />
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)] font-mono tracking-tight uppercase">
                  ORDER #{order.orderNumber}
                </h2>
                {renderHeaderStatusBadge()}
              </div>
              <p className="text-xs text-[var(--text-secondary)] font-normal flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--text-primary)]">
                  {order.customerName || "Walk-in Customer"}
                </span>
                {order.customerPhone && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span>{order.customerPhone}</span>
                  </>
                )}
                <span className="text-[var(--text-muted)]">•</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {itemCount > 0 ? `${itemCount} File${itemCount > 1 ? "s" : ""}` : "1 File"}
                </span>
                <span className="text-[var(--text-muted)]">•</span>
                <span>{totalCalculatedPages} Pages</span>
                <span className="text-[var(--text-muted)]">•</span>
                <span className="font-bold text-[var(--text-primary)] font-mono">
                  ₹{(order.totalPrice || 0).toFixed(2)}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-none border border-transparent hover:border-[var(--border-app)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0 cursor-pointer"
            title="Close Workspace"
            aria-label="Close"
          >
            <MaterialIcon name="close" size={18} />
          </button>
        </div>

        {/* LIVE REAL PRINTING PROGRESS WORKSPACE SECTION */}
        {isPrinting && (
          <div className="px-5 py-3.5 bg-[var(--color-info-bg)] space-y-2.5 shrink-0 border-b border-[var(--color-info-border)] animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping" />
                <span className="text-xs font-mono font-bold tracking-wider uppercase text-[var(--color-info-text)]">
                  {orderJobProgress?.stageTitle || "PRINTING"}
                </span>
                <span className="text-[var(--text-muted)]">•</span>
                <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-xs sm:max-w-md">
                  {orderJobProgress?.currentFileName || selectedDoc?.originalFileName || "Document"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                {orderJobProgress?.totalFiles > 1 && (
                  <span className="font-bold font-mono text-[var(--color-info-text)] bg-[var(--bg-panel)] px-2 py-0.5 rounded-none border border-[var(--color-info-border)]">
                    {orderJobProgress?.currentFileIndex || 1} / {orderJobProgress?.totalFiles} FILES
                  </span>
                )}
                {typeof orderJobProgress?.percent === "number" && !orderJobProgress?.isIndeterminate ? (
                  <span className="font-mono font-bold text-[var(--color-info-text)]">
                    {orderJobProgress.percent}%
                  </span>
                ) : (
                  <span className="font-semibold text-[11px] text-[var(--color-info-text)]">
                    {orderJobProgress?.stageMessage || "In Progress"}
                  </span>
                )}
              </div>
            </div>

            {/* REAL PROGRESS BAR / INDETERMINATE SHIMMER */}
            <div className="print-progress-track">
              {orderJobProgress?.isIndeterminate ? (
                <div className="animate-print-indeterminate" />
              ) : (
                <div
                  className="print-progress-fill"
                  style={{
                    width: `${Math.max(5, Math.min(100, orderJobProgress?.percent ?? 100))}%`,
                  }}
                />
              )}
            </div>

            {/* PROGRESS METRICS FOOTER */}
            <div className="flex items-center justify-between gap-4 text-[11px] text-[var(--text-secondary)] flex-wrap pt-0.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span>
                  {orderJobProgress?.stageMessage || "Sending document to printer..."}
                </span>
                {orderJobProgress?.totalPages && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span>
                      {orderJobProgress.totalPages > 1
                        ? `Page ${orderJobProgress.currentPage || 1} of ${orderJobProgress.totalPages}`
                        : `1 Page`}
                    </span>
                  </>
                )}
                {orderJobProgress?.copies && orderJobProgress.copies > 1 && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span>{orderJobProgress.copies} Copies</span>
                  </>
                )}
              </div>

              {orderJobProgress?.targetPrinter && (
                <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                  <MaterialIcon name="print" size={14} className="text-[var(--color-accent)]" />
                  <span>Printer: <strong className="text-[var(--text-primary)]">{orderJobProgress.targetPrinter}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}

        {isCompleted && !isPrinting && (
          <div className="px-5 py-3 bg-[var(--color-success-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-semibold text-[var(--color-success-text)] shrink-0 border-b border-[var(--color-success-border)] animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5">
              <MaterialIcon name="check_circle" size={20} className="text-[#22C55E] shrink-0" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-wide uppercase text-xs font-mono">PRINT COMPLETED</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 bg-[var(--bg-panel)] rounded-none border border-[var(--color-success-border)]">100%</span>
                </div>
                <p className="text-[11px] font-normal text-[var(--color-success-text)] opacity-90">
                  {itemCount > 1 ? `All ${itemCount} files printed successfully` : "Document printed successfully"} • Job ready for pickup
                </p>
              </div>
            </div>
            
            {orderJobProgress?.targetPrinter && (
              <span className="text-[11px] font-medium text-[var(--color-success-text)] opacity-90 font-mono">
                Routed to: {orderJobProgress.targetPrinter}
              </span>
            )}
          </div>
        )}

        {isFailed && !isPrinting && (
          <div className="px-5 py-3 bg-[var(--color-error-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-semibold text-[var(--color-error-text)] shrink-0 border-b border-[var(--color-error-border)] animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5">
              <MaterialIcon name="error" size={20} className="text-[#EF4444] shrink-0" />
              <div>
                <span className="font-bold tracking-wide uppercase block text-xs font-mono">PRINT FAILED</span>
                <p className="text-[11px] font-normal text-[var(--color-error-text)] mt-0.5">
                  {printError || orderJobProgress?.error || "Printer unavailable or spool failed"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintAll}
                className="btn-danger-sm cursor-pointer"
              >
                <MaterialIcon name="refresh" size={14} />
                <span>Retry Print</span>
              </button>
            </div>
          </div>
        )}

        {/* WORKSPACE BODY: 2-COLUMN SPLIT */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          
          {/* LEFT COLUMN: FILE LIST + SPECS + CUSTOMER INFO (lg:col-span-6) */}
          <div className="lg:col-span-6 border-r border-[var(--border-subtle)] flex flex-col min-h-0 bg-[var(--bg-surface)]">
            
            {/* FILE LIST SECTION WITH BOUNDED SCROLL & SELECT ALL */}
            <div className="p-4 bg-[var(--bg-panel)] shrink-0">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  {itemCount > 1 && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="p-1 rounded-none hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
                      title={checkedIndices.size === itemCount ? "Deselect All" : "Select All"}
                    >
                      {checkedIndices.size === itemCount ? (
                        <MaterialIcon name="check_box" size={16} className="text-[var(--color-accent)]" />
                      ) : (
                        <MaterialIcon name="check_box_outline_blank" size={16} className="text-[var(--text-muted)]" />
                      )}
                      <span>Select All</span>
                    </button>
                  )}
                  <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                    Files ({itemCount})
                  </span>
                </div>
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {checkedIndices.size > 0
                    ? `${checkedIndices.size} of ${itemCount} selected`
                    : "Click file to preview"}
                </span>
              </div>

              {/* BOUNDED SCROLLABLE FILE LIST */}
              <div className="max-h-[220px] sm:max-h-[250px] overflow-y-auto space-y-2 pr-1">
                {items.length > 0 ? (
                  items.map((item, idx) => {
                    const doc = item.document;
                    const docId = doc?.id || "";
                    const fileName = doc?.originalFileName || `File ${idx + 1}`;
                    const isSelected = selectedFileIndex === idx;
                    const isChecked = checkedIndices.has(idx);
                    const isDocDownloading = downloadingDocId === docId;
                    const itemKey = itemKeyOf(item, idx);
                    const itemStatus = itemStatusMap[itemKey] || "READY";
                    const isItemPrinting = itemStatus === "PRINTING";
                    const isItemPrinted = itemStatus === "PRINTED";
                    const isItemFailed = itemStatus === "FAILED";

                    return (
                      <div
                        key={item.id ?? idx}
                        onClick={() => setSelectedFileIndex(idx)}
                        className={`p-2.5 rounded-none border text-xs cursor-pointer transition-all flex items-center justify-between gap-2.5 ${
                          isSelected
                            ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] shadow-none"
                            : "border-[var(--border-app)] bg-transparent hover:bg-[var(--bg-elevated)]"
                        }`}
                      >
                        {/* LEFT: Checkbox + Number + File Info */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* CHECKBOX */}
                          <div
                            onClick={(e) => toggleCheck(idx, e)}
                            className="p-1 -m-1 rounded-none hover:bg-[var(--bg-panel)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                          >
                            {isChecked ? (
                              <MaterialIcon name="check_box" size={16} className="text-[var(--color-accent)]" />
                            ) : (
                              <MaterialIcon name="check_box_outline_blank" size={16} className="text-[var(--text-muted)]" />
                            )}
                          </div>

                          <span
                            className={`w-5 h-5 rounded-none font-bold text-[11px] flex items-center justify-center shrink-0 ${
                              isSelected
                                ? "bg-[var(--color-accent)] text-white dark:text-black"
                                : "bg-[var(--border-app)] text-[var(--text-primary)]"
                            }`}
                          >
                            {idx + 1}
                          </span>

                          <div className="min-w-0">
                            <p
                              className={`font-semibold truncate max-w-[140px] sm:max-w-[200px] ${
                                isSelected ? "text-[var(--color-accent)] font-bold" : "text-[var(--text-primary)]"
                              }`}
                              title={fileName}
                            >
                              {fileName}
                            </p>
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              {item.calculatedPages || doc?.pageCount || 1} pgs • {item.copies} cop{item.copies > 1 ? "ies" : "y"} • {item.colorMode === "COLOR" ? "Color" : "B&W"}
                            </p>
                          </div>
                        </div>

                        {/* RIGHT: Status Badge + Individual Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* PER-FILE STATUS BADGE */}
                          {isItemPrinting ? (
                            <span className="px-2 py-0.5 rounded-none text-[10px] font-bold bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)] inline-flex items-center gap-1">
                              <MaterialIcon name="progress_activity" size={10} className="animate-spin" />
                              <span>PRINTING</span>
                            </span>
                          ) : isItemPrinted ? (
                            <span className="px-2 py-0.5 rounded-none text-[10px] font-bold bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)] inline-flex items-center gap-1">
                              <MaterialIcon name="check" size={10} />
                              <span>PRINTED</span>
                            </span>
                          ) : isItemFailed ? (
                            <span className="px-2 py-0.5 rounded-none text-[10px] font-bold bg-[var(--color-error-bg)] text-[var(--color-error-text)] border border-[var(--color-error-border)] inline-flex items-center gap-1">
                              <MaterialIcon name="error" size={10} />
                              <span>FAILED</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-none text-[10px] font-semibold bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-app)]">
                              READY
                            </span>
                          )}

                          {/* PREVIEW BUTTON */}
                          {docId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFileIndex(idx);
                              }}
                              className={`p-1.5 rounded-none transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-[var(--color-accent)] text-white dark:text-black"
                                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-app)]"
                              }`}
                              title="Preview file"
                              aria-label="Preview file"
                            >
                              <MaterialIcon name="visibility" size={14} />
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)] font-medium italic px-1">
                              Removed
                            </span>
                          )}

                          {/* INDIVIDUAL PRINT ACTION (ONLY IF FILE ATTACHED) */}
                          {docId ? (
                            <button
                              type="button"
                              onClick={(e) => handlePrintSingleItem(item, idx, e)}
                              disabled={isPrintingLocal || isItemPrinting}
                              className={`px-2 py-1 rounded-none text-[11px] font-bold transition-colors inline-flex items-center gap-1 cursor-pointer ${
                                isItemPrinting
                                  ? "bg-[var(--color-info-bg)] text-[var(--color-info-text)] cursor-not-allowed"
                                  : isItemFailed
                                    ? "bg-[#EF4444] text-white hover:bg-[#DC2626]"
                                    : isItemPrinted
                                      ? "bg-[var(--bg-panel)] border border-[var(--border-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-app)]"
                                      : "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] dark:text-black"
                              }`}
                              title={isItemPrinted ? "Reprint this file" : isItemFailed ? "Retry printing this file" : "Print this file only"}
                            >
                              {isItemPrinting ? (
                                <MaterialIcon name="progress_activity" size={12} className="animate-spin" />
                              ) : (
                                <MaterialIcon name="print" size={12} />
                              )}
                              <span className="hidden sm:inline">
                                {isItemPrinted ? "Reprint" : isItemFailed ? "Retry" : "Print"}
                              </span>
                            </button>
                          ) : null}

                          {/* DOWNLOAD BUTTON */}
                          {docId ? (
                            <button
                              type="button"
                              onClick={(e) => handleDownloadDoc(docId, fileName, e)}
                              disabled={isDocDownloading}
                              className="p-1.5 rounded-none text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-app)] transition-colors cursor-pointer"
                              title="Download file"
                              aria-label="Download file"
                            >
                              {isDocDownloading ? (
                                <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
                              ) : (
                                <MaterialIcon name="download" size={14} />
                              )}
                            </button>
                          ) : null}

                          {/* EDIT IN DOCUMENT STUDIO (PDF / photos only) */}
                          {docId ? (
                            isEditableDoc(item.document) ? (
                              <button
                                type="button"
                                data-testid="edit-in-studio"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onEditItem) onEditItem(item, idx);
                                }}
                                className="p-1.5 rounded-none text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-app)] transition-colors cursor-pointer"
                                title="Edit in Document Studio"
                                aria-label="Edit in Document Studio"
                              >
                                <MaterialIcon name="edit" size={14} />
                              </button>
                            ) : (
                              <span
                                className="p-1.5 text-[var(--text-muted)] opacity-40 cursor-not-allowed"
                                title="Editing is not supported for this file type"
                              >
                                <MaterialIcon name="edit" size={14} />
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div
                    onClick={() => setSelectedFileIndex(0)}
                    className="p-2.5 rounded-none border bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-xs cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-none bg-[var(--color-accent)] text-white font-bold text-[11px] flex items-center justify-center shrink-0 dark:text-black">
                        1
                      </span>
                      <p className="font-semibold text-[var(--color-accent)] truncate">
                        {order.document?.originalFileName || "Print Document"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {order.document?.id ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => handlePrintSingleItem(selectedItem, 0, e)}
                            className="px-2 py-1 rounded-none bg-[var(--color-accent)] text-white text-[11px] font-bold inline-flex items-center gap-1 dark:text-black"
                          >
                            <MaterialIcon name="print" size={12} />
                            <span>Print</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) =>
                              handleDownloadDoc(
                                order.document?.id,
                                order.document?.originalFileName,
                                e
                              )
                            }
                            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            aria-label="Download file"
                          >
                            <MaterialIcon name="download" size={14} />
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)] italic">Files Removed</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SELECTED FILE SPECIFICATIONS */}
            <div className="p-4 bg-[var(--bg-panel)] shrink-0 space-y-3">
              <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
                Selected File Specifications
              </span>

              {/* Document versions: Original + edited copies. The checked
                  version is what prints. */}
              {selectedItemIdForVersions && (
                <div className="flex items-center gap-2 flex-wrap" data-testid="version-chips">
                  <MaterialIcon name="layers" size={14} className="text-[var(--text-secondary)] shrink-0" />
                  <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                    Print version:
                  </span>
                  {versionsLoading ? (
                    <span className="text-[11px] text-[var(--text-muted)]">Loading versions…</span>
                  ) : versions.length === 0 ? (
                    <span className="text-[11px] text-[var(--text-muted)]">Original only</span>
                  ) : (
                    versions.map((v) => {
                      const label = v.parentDocumentId
                        ? `Edited · ${v.pageCount} pg`
                        : `Original · ${v.pageCount} pg`;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          disabled={v.current || swappingVersion}
                          onClick={() => handleUseVersion(v.id)}
                          title={v.originalFileName || label}
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-none border transition-colors cursor-pointer disabled:cursor-default ${
                            v.current
                              ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                              : "bg-transparent border-[var(--border-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                          }`}
                        >
                          {v.current ? `✓ ${label}` : label}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
              {versionError && (
                <p className="text-[11px] font-medium text-[var(--color-error-text)]">{versionError}</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-none border border-[var(--border-app)]">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold block">
                    Color Mode
                  </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {selectedItem.colorMode === "BW" ? "Black & White" : "Full Color"}
                  </span>
                </div>

                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-none border border-[var(--border-app)]">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold block">
                    Paper & Sides
                  </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {selectedItem.paperSize || "A4"} • {selectedItem.printSide === "DOUBLE" ? "Double" : "Single"}
                  </span>
                </div>

                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-none border border-[var(--border-app)]">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold block">
                    Pages & Copies
                  </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {selectedItem.calculatedPages || selectedDoc?.pageCount || 1} Pgs × {selectedItem.copies || 1} Cop{selectedItem.copies > 1 ? "ies" : "y"}
                  </span>
                </div>

                <div className="bg-[var(--bg-elevated)] p-2.5 rounded-none border border-[var(--border-app)]">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold block">
                    Item Total
                  </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    ₹{(selectedItem.itemPrice || order.totalPrice || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* CUSTOMER & PAYMENT INFO */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-[var(--bg-panel)]">
              <div className="bg-[var(--bg-elevated)] p-3.5 rounded-none border border-[var(--border-app)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Customer Details
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  <p className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <MaterialIcon name="person" size={14} className="text-[var(--text-secondary)]" />
                    <span>{order.customerName || "Walk-in Customer"}</span>
                  </p>
                  {order.customerPhone && (
                    <p className="text-[var(--text-secondary)] flex items-center gap-2">
                      <MaterialIcon name="call" size={14} className="text-[var(--text-secondary)]" />
                      <span>{order.customerPhone}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-[var(--bg-elevated)] p-3.5 rounded-none border border-[var(--border-app)] flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
                    Payment Status
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePaymentStatus(
                        order.id,
                        order.paymentStatus === "PAID" ? "PENDING" : "PAID",
                      )
                    }
                    className="text-[11px] text-[var(--color-accent)] hover:underline font-semibold cursor-pointer"
                  >
                    {order.paymentStatus === "PAID" ? "Mark Unpaid" : "Mark as Paid"}
                  </button>
                </div>
                <div className="text-right">
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-none border border-transparent inline-block ${
                      order.paymentStatus === "PAID"
                        ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                        : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                    }`}
                  >
                    {order.paymentStatus === "PAID" ? "PAID" : "COUNTER"}
                  </span>
                  <p className="text-base font-bold text-[var(--text-primary)] font-mono mt-0.5">
                    ₹{(order.totalPrice || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: PREVIEW AREA (lg:col-span-6) */}
          <div className="lg:col-span-6 flex flex-col min-h-0 bg-[var(--bg-app)]">
            {/* PREVIEW HEADER */}
            <div className="px-5 py-3 border-b border-[var(--border-app)] bg-[var(--bg-surface)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Preview:
                </span>
                <span className="text-xs font-semibold text-[var(--color-accent)] truncate max-w-xs sm:max-w-md">
                  {selectedDoc?.originalFileName || (hasFiles ? "Document" : "Files Removed")}
                </span>
              </div>

              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
                >
                  <MaterialIcon name="open_in_new" size={14} />
                  <span className="hidden sm:inline">Open in tab</span>
                </a>
              )}
            </div>

            {/* PREVIEW CONTAINER */}
            <div className="flex-1 min-h-0 p-4 flex items-center justify-center overflow-hidden">
              {!hasFiles ? (
                <div className="text-center space-y-3 max-w-sm p-6 mx-auto">
                  <MaterialIcon name="warning" size={32} className="text-[var(--text-muted)] mx-auto" />
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">
                      Files No Longer Available
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                      The uploaded files for this completed order have been cleaned up to free shop storage. Order specifications and payment records remain safely recorded.
                    </p>
                  </div>
                </div>
              ) : isPreviewLoading ? (
                <div className="text-center space-y-3">
                  <MaterialIcon name="progress_activity" size={32} className="animate-spin text-[var(--color-accent)] mx-auto" />
                  <p className="text-xs font-medium text-[var(--text-secondary)]">
                    Loading document preview...
                  </p>
                </div>
              ) : previewError ? (
                <div className="text-center space-y-3 max-w-xs p-6">
                  <MaterialIcon name="warning" size={32} className="text-[#EF4444] mx-auto" />
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-primary)]">
                      Preview not available
                    </h4>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                      {selectedDoc?.originalFileName}
                    </p>
                  </div>
                  {selectedDoc?.id && (
                    <button
                      type="button"
                      onClick={(e) =>
                        handleDownloadDoc(
                          selectedDoc.id,
                          selectedDoc.originalFileName,
                          e,
                        )
                      }
                      className="h-8 px-3 rounded-none bg-[var(--bg-elevated)] border border-[var(--border-app)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--border-app)] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <MaterialIcon name="download" size={14} />
                      <span>Download to View</span>
                    </button>
                  )}
                </div>
              ) : previewUrl ? (
                <div className="w-full h-full bg-[var(--bg-surface)] rounded-none border border-[var(--border-app)] overflow-hidden flex flex-col">
                  {previewType?.startsWith("image/") ||
                  selectedDoc?.originalFileName?.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
                    <div className="w-full h-full flex items-center justify-center p-4 bg-[var(--bg-app)]">
                      <img
                        src={previewUrl}
                        alt={selectedDoc?.originalFileName || "Preview"}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : docxHtml ? (
                    <div className="w-full h-full p-6 overflow-y-auto text-xs text-[#111111] bg-white leading-relaxed">
                      <div dangerouslySetInnerHTML={{ __html: docxHtml }} />
                    </div>
                  ) : (
                    <iframe
                      src={`${previewUrl}#toolbar=0&navpanes=0`}
                      title="Document Preview"
                      className="w-full h-full border-none bg-white"
                    />
                  )}
                </div>
              ) : (
                <div className="text-center space-y-2 text-[var(--text-muted)]">
                  <MaterialIcon name="description" size={32} className="mx-auto text-[var(--text-muted)]" />
                  <p className="text-xs">Select a file from the list to preview</p>
                </div>
              )}
            </div>

          </div>

        </div>

        {/* FIXED FOOTER WITH ACTION HIERARCHY */}
        <div className="px-6 py-4 border-t border-[var(--border-app)] bg-[var(--bg-surface)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary cursor-pointer"
            >
              Close Workspace
            </button>

            {/* DELETE ORDER ACTION FOR COMPLETED, FAILED OR CANCELLED ORDERS */}
            {(isCompleted || isFailed || order.printStatus === "CANCELLED" || order.printStatus === "DECLINED") && onDeleteOrder && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onDeleteOrder(order);
                }}
                className="btn-danger"
                title="Delete this order"
              >
                <MaterialIcon name="delete" size={14} />
                <span>Delete Order</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {order.printStatus !== "CANCELLED" && (
              <button
                type="button"
                onClick={() => onUpdateStatus(order.id, "CANCELLED")}
                className="text-xs text-[var(--text-muted)] hover:text-[#EF4444] font-medium mr-2 cursor-pointer"
              >
                Cancel Order
              </button>
            )}

            {/* IF CHECKED FILES EXIST: SHOW PRINT SELECTED + SECONDARY PRINT ALL */}
            {checkedIndices.size > 0 && checkedIndices.size < itemCount ? (
              <>
                <button
                  type="button"
                  onClick={handlePrintAll}
                  disabled={isPrinting}
                  className="btn-secondary cursor-pointer disabled:opacity-40"
                >
                  Print All ({itemCount})
                </button>

                <button
                  type="button"
                  onClick={handlePrintSelected}
                  disabled={isPrinting}
                  className="h-10 px-6 rounded-none text-xs font-bold transition-all flex items-center gap-2 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] cursor-pointer dark:text-black"
                >
                  <MaterialIcon name="print" size={16} className="text-white dark:text-black" />
                  <span>PRINT SELECTED ({checkedIndices.size})</span>
                </button>
              </>
            ) : (
              /* PRIMARY PRINT ALL / REPRINT ACTION */
              <button
                type="button"
                onClick={handlePrintAll}
                disabled={isPrinting}
                className={`h-10 px-6 rounded-none text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  isPrinting
                    ? "bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)] cursor-not-allowed"
                    : isFailed
                      ? "bg-[#EF4444] text-white hover:bg-[#DC2626]"
                      : isCompleted
                        ? "bg-[#22C55E] text-white hover:bg-[#16A34A]"
                        : "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] dark:text-black"
                }`}
              >
                {isPrinting ? (
                  <>
                    <MaterialIcon name="progress_activity" size={16} className="animate-spin text-[var(--color-accent)]" />
                    <span>
                      {orderJobProgress?.totalFiles > 1
                        ? `Printing ${orderJobProgress?.currentFileIndex || 1}/${orderJobProgress?.totalFiles}...`
                        : orderJobProgress?.stageTitle || "Printing..."}
                    </span>
                  </>
                ) : isFailed ? (
                  <>
                    <MaterialIcon name="refresh" size={16} className="text-white" />
                    <span>Retry Print Job</span>
                  </>
                ) : isCompleted ? (
                  <>
                    <MaterialIcon name="print" size={16} className="text-white" />
                    <span>Reprint All Files</span>
                  </>
                ) : (
                  <>
                    <MaterialIcon name="print" size={16} className="text-white" />
                    <span>PRINT {itemCount > 1 ? `ALL FILES (${itemCount})` : "DOCUMENT"}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
