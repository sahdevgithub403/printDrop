import React, { useState } from "react";
import { printClient } from "../services/printClient";
import { MaterialIcon } from "./ui/MaterialIcon";

export const OrderCard = ({
  order,
  onUpdateStatus,
  onUpdatePaymentStatus,
  onPrintOrder,
  onSelectOrder,
  onDeleteFiles,
  onDeleteOrder,
  clientState,
}) => {
  const [isPrintingLocal, setIsPrintingLocal] = useState(false);

  const items = order.items && order.items.length > 0 ? order.items : [];
  const itemCount = items.length;
  const printedItemsCount = items.filter((it) => it.printStatus === "COMPLETED").length;
  const isPartiallyPrinted = itemCount > 1 && printedItemsCount > 0 && printedItemsCount < itemCount && order.printStatus !== "COMPLETED";

  const hasFiles = Boolean(
    (items.length > 0 && items.some((it) => it.document && it.document.id)) ||
    (order.document && order.document.id)
  );

  const firstDoc = items[0]?.document || order.document;
  const primaryDocName = hasFiles
    ? firstDoc?.originalFileName || "Document.pdf"
    : "Files Removed";
  const firstDocType = items[0]?.printType || order.printType;
  const isPassportPhoto = firstDocType === "PASSPORT_PHOTO";

  const totalCalculatedPages =
    items.length > 0
      ? items.reduce(
          (sum, item) =>
            sum + (item.calculatedPages || item.document?.pageCount || 1),
          0
        )
      : order.document?.pageCount || order.calculatedPages || 1;

  // Real-time printing progress for this specific order
  const orderJobProgress = clientState?.jobProgress?.[order.id];

  const handleDirectPrint = async (e) => {
    e?.stopPropagation();
    if (order.printStatus === "PRINTING" || isPrintingLocal) return;

    setIsPrintingLocal(true);
    try {
      if (onPrintOrder) {
        await onPrintOrder(order);
      } else {
        await onUpdateStatus(order.id, "PRINTING");
        await printClient.executePrintJob(order);
        await onUpdateStatus(order.id, "COMPLETED");
      }
    } catch (err) {
      console.error("Print execution failed:", err);
      // onPrintOrder (dashboard handler) already PATCHes FAILED on error —
      // patching again here would double-report the same outcome.
      if (!onPrintOrder) {
        await onUpdateStatus(order.id, "FAILED");
      }
    } finally {
      setIsPrintingLocal(false);
    }
  };

  // Format completed time
  const formattedTime = (() => {
    try {
      const dateStr = order.updatedAt || order.createdAt;
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  })();

  // Status Indicator renderer
  const renderStatusBadge = () => {
    const isPrinting = order.printStatus === "PRINTING" || isPrintingLocal;

    if (isPrinting) {
      const current = orderJobProgress?.currentFileIndex || orderJobProgress?.current || 1;
      const total = orderJobProgress?.totalFiles || orderJobProgress?.total || itemCount || 1;
      const percent = typeof orderJobProgress?.percent === "number" && !orderJobProgress?.isIndeterminate ? `${orderJobProgress.percent}%` : null;

      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]">
          <span className="w-1.5 h-1.5 rounded-none bg-[var(--color-accent)] animate-pulse" />
          <span>
            {total > 1 ? `Printing ${current}/${total}` : "Printing"}
            {percent ? ` • ${percent}` : ""}
          </span>
        </span>
      );
    }

    if (isPartiallyPrinted) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--color-info-bg)] text-[var(--color-info-text)] border border-[var(--color-info-border)]">
          <span className="w-1.5 h-1.5 rounded-none bg-[var(--color-accent)]" />
          <span>PARTIAL ({printedItemsCount}/{itemCount})</span>
        </span>
      );
    }

    switch (order.printStatus) {
      case "PENDING":
      case "NEW":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
            <span className="w-1.5 h-1.5 rounded-none bg-black dark:bg-white" />
            <span>NEW</span>
          </span>
        );
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
            <MaterialIcon name="check" size={14} className="text-black dark:text-white" />
            <span>COMPLETED</span>
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--color-error-bg)] text-[var(--color-error-text)] border border-[var(--color-error-border)]">
            <span className="w-1.5 h-1.5 rounded-none bg-black dark:bg-white" />
            <span>FAILED</span>
          </span>
        );
      case "CANCELLED":
      case "DECLINED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--border-subtle)] text-[var(--text-secondary)] border border-[var(--border-app)]">
            <span className="w-1.5 h-1.5 rounded-none bg-[var(--text-muted)]" />
            <span>CANCELLED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-bold tracking-wide uppercase bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)]">
            <span className="w-1.5 h-1.5 rounded-none bg-[var(--color-accent)]" />
            <span>{order.printStatus}</span>
          </span>
        );
    }
  };

  const isPrinting = order.printStatus === "PRINTING" || isPrintingLocal;
  const isFailed = order.printStatus === "FAILED";
  const isCompleted = order.printStatus === "COMPLETED";
  const isCancelled = order.printStatus === "CANCELLED" || order.printStatus === "DECLINED";
  const isDeletable = isCompleted || isFailed || isCancelled;

  return (
    <div
      data-testid="order-row"
      onClick={() => onSelectOrder && onSelectOrder(order)}
      className="group relative border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-elevated)] transition-all duration-150 cursor-pointer select-none"
    >
      {/* Subtle hover accent line on the left */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />

      <div className="py-3 px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
        
        {/* Left Column: Document Icon + Order Details */}
        <div className="flex items-start sm:items-center gap-3.5 min-w-0 md:w-5/12">
          {/* Doc Type Icon — bare native icon, no decorative container */}
          {isPassportPhoto ? (
            <MaterialIcon name="badge" size={20} className="text-[var(--color-accent)] shrink-0" />
          ) : itemCount > 1 ? (
            <MaterialIcon name="folder_copy" size={20} className="text-[var(--color-accent)] shrink-0" />
          ) : (
            <MaterialIcon name="description" size={20} className="text-[var(--color-accent)] shrink-0" />
          )}

          {/* Order Info */}
          <div className="min-w-0 space-y-0.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold text-[var(--text-secondary)] bg-[var(--border-subtle)] px-1.5 py-0.2 rounded-none border border-[var(--border-app)]">
                #{order.orderNumber}
              </span>
              <span
                className={`text-[13px] font-semibold tracking-tight truncate max-w-xs sm:max-w-sm ${
                  !hasFiles ? "text-[var(--text-muted)] italic" : "text-[var(--text-primary)]"
                }`}
                title={primaryDocName}
              >
                {primaryDocName}
              </span>
            </div>

            <p className="text-[11px] text-[var(--text-secondary)] font-medium flex items-center gap-2 flex-wrap font-mono">
              <span className="text-[var(--text-primary)] font-sans">
                {order.customerName || "Walk-in Customer"}
              </span>
              {order.customerPhone && (
                <>
                  <span className="text-[var(--border-app)]">|</span>
                  <span>{order.customerPhone}</span>
                </>
              )}
              <span className="text-[var(--border-app)]">|</span>
              <span className="text-[var(--text-primary)]">
                {itemCount > 0 ? `${itemCount} File${itemCount > 1 ? "s" : ""}` : "1 File"}
              </span>
              <span className="text-[var(--border-app)]">|</span>
              <span>{totalCalculatedPages} Pgs</span>
              
              {isCompleted && formattedTime && (
                <>
                  <span className="text-[var(--border-app)]">|</span>
                  <span className="text-[var(--color-success-text)] font-semibold">
                    {formattedTime}
                  </span>
                </>
              )}
              
              {!hasFiles && (
                <>
                  <span className="text-[var(--border-app)]">|</span>
                  <span className="text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider">
                    Files Removed
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right Column: Status, Payment, Amount & Actions */}
        <div className="flex items-center justify-between md:justify-end gap-3 sm:gap-5 md:w-7/12 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--border-subtle)]">
          
          {/* Status Column */}
          <div className="w-28 flex items-center justify-start shrink-0">
            {renderStatusBadge()}
          </div>

          {/* Payment Column */}
          <div className="w-20 flex items-center justify-start shrink-0">
            <span
              className={`text-[10px] font-bold font-mono tracking-wider uppercase px-2 py-0.5 rounded-none border ${
                order.paymentStatus === "PAID"
                  ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
                  : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
              }`}
            >
              {order.paymentStatus === "PAID" ? "PAID" : "COUNTER"}
            </span>
          </div>

          {/* Amount & Actions Column */}
          <div className="flex items-center justify-end gap-2.5 shrink-0">
            {/* If PRINTING: Replace standard amount & print button with real progress state */}
            {isPrinting ? (
              <div className="flex items-center gap-2.5">
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-[var(--color-accent)]" />
                    <span className="text-[11px] font-bold font-mono text-[var(--color-accent)]">
                      {itemCount > 1
                        ? `${orderJobProgress?.currentFileIndex || 1}/${itemCount} files`
                        : `${orderJobProgress?.currentPage || 1}/${totalCalculatedPages} pgs`}
                    </span>
                  </div>
                  <div className="w-24 sm:w-28 h-1.5 bg-[var(--bg-surface)] rounded-none overflow-hidden border border-[var(--border-app)]">
                    {orderJobProgress?.percent !== null &&
                    orderJobProgress?.percent !== undefined &&
                    !orderJobProgress?.isIndeterminate ? (
                      <div
                        className="h-full bg-[var(--color-accent)] rounded-none transition-all duration-300"
                        style={{ width: `${Math.max(5, orderJobProgress.percent)}%` }}
                      />
                    ) : (
                      <div className="h-full bg-[var(--color-accent)] rounded-none animate-pulse w-3/4" />
                    )}
                  </div>
                </div>

                {/* VIEW BUTTON */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectOrder) onSelectOrder(order);
                  }}
                  className="btn-secondary-sm cursor-pointer"
                >
                  <MaterialIcon name="visibility" size={16} className="text-[var(--text-secondary)]" />
                  <span>View</span>
                </button>
              </div>
            ) : (
              <>
                <span className="text-[14px] font-bold text-[var(--text-primary)] font-mono min-w-[65px] text-right">
                  ₹{(order.totalPrice || 0).toFixed(2)}
                </span>

                <div className="flex items-center gap-2">
                  {/* VIEW BUTTON */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectOrder) onSelectOrder(order);
                    }}
                    className="btn-secondary-sm cursor-pointer"
                  >
                    <MaterialIcon name="visibility" size={16} className="text-[var(--text-secondary)]" />
                    <span>View</span>
                  </button>

                  {/* FAILED ORDER: RETRY BUTTON */}
                  {isFailed && (
                    <button
                      type="button"
                      onClick={handleDirectPrint}
                      className="btn-danger-sm"
                    >
                      <MaterialIcon name="refresh" size={16} />
                      <span>Retry</span>
                    </button>
                  )}

                  {/* NEW / PENDING: PRINT BUTTON */}
                  {!isCompleted && !isFailed && !isCancelled && (
                    <button
                      type="button"
                      onClick={handleDirectPrint}
                      className="btn-primary-sm cursor-pointer"
                    >
                      <MaterialIcon name="print" size={16} />
                      <span>Print</span>
                    </button>
                  )}

                  {/* DELETE ORDER ACTION FOR COMPLETED, FAILED & CANCELLED ORDERS */}
                  {isDeletable && onDeleteOrder && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteOrder(order);
                      }}
                      className="btn-danger-sm"
                      title={isCompleted ? "Delete completed order" : "Delete failed order"}
                    >
                      <MaterialIcon name="delete" size={16} />
                      <span className="hidden xl:inline">Delete</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};