import React, { useEffect, useState } from "react";
import { MaterialIcon } from "../components/ui/MaterialIcon";

export const NotificationPopup = () => {
  const [order, setOrder] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dismiss closes this popup window only — the order stays in the
  // dashboard queue. Only DECLINE declines the order.
  const handleDismiss = () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.dismissPopup === "function") {
        window.electronAPI.dismissPopup();
        return;
      }
    } catch {}
    // Fallback (dev browser tab): close our own window.
    window.close();
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    try {
      const hash = window.location.hash;
      console.log("[PrintAlfa Popup] hash:", hash);
      const paramIndex = hash.indexOf("?order=");

      if (paramIndex !== -1) {
        const paramStr = hash.substring(paramIndex + "?order=".length);
        const decoded = decodeURIComponent(paramStr);
        const parsedOrder = JSON.parse(decoded);
        console.log("[PrintAlfa Popup] parsed order:", parsedOrder);

        setOrder(parsedOrder);
      } else {
        console.warn("[PrintAlfa Popup] No ?order= found in hash:", hash);
      }
    } catch (error) {
      console.error("[PrintAlfa Popup] Failed to parse order from notification URL:", error);
    }
  }, []);

  const handleAction = (action) => {
    if (isProcessing) return;
    setIsProcessing(true);
    if (order && window.electronAPI) {
      window.electronAPI.sendOrderActionResult(order.id, action);
    }
  };

  if (!order) return <div className="p-4 text-white bg-[#111418] h-screen">Loading...</div>;

  const items = Array.isArray(order.items) ? order.items : [];
  const firstItem = items[0] || {};
  const firstDoc = order.document || firstItem.document || {};
  const fileName = firstDoc.originalFileName || 'Document';
  const customerName = order.customerName || 'Walk-in';
  const amount = order.totalAmount || order.totalPrice || '0';
  const paymentStatus = order.paymentStatus || 'PENDING';
  const colorMode = order.colorMode || firstItem.colorMode || '';
  const paperSize = order.paperSize || firstItem.paperSize || '';
  const printSide = order.printSide || firstItem.printSide || '';
  const copies = order.copies || firstItem.copies || 1;
  const pageCount = order.pages || firstDoc.pageCount || 1;
  const isColor = String(colorMode).toUpperCase() === 'COLOR';
  const isPaid = String(paymentStatus).toUpperCase() === 'PAID';
  const isCounter = String(order.paymentMethod || '').toUpperCase() === 'PAY_AT_SHOP'
    || String(paymentStatus).toUpperCase() === 'COUNTER';
  const fileCount = items.length || 1;
  const totalPrintPages = items.length
    ? items.reduce((sum, it) => sum + ((it?.document?.pageCount || 0) * (it?.copies || 1)), 0)
    : pageCount * copies;
  const specBits = [
    isColor ? 'Color' : 'B&W',
    paperSize ? String(paperSize).toUpperCase() : null,
    printSide ? (String(printSide).toUpperCase() === 'DOUBLE' ? 'Double side' : 'Single side') : null,
    copies > 1 ? `${copies} copies` : '1 copy',
  ].filter(Boolean);

  return (
    <div className="h-screen w-screen bg-[#0b0d10] text-zinc-100 flex flex-col overflow-hidden border border-white/10 rounded-none" style={{ WebkitAppRegion: 'drag' }}>
      {/* Slim header */}
      <div className="px-4 pt-3 pb-2.5 flex items-center gap-2.5 border-b border-white/[0.07]">
        <MaterialIcon name="print" size={18} className="text-white shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 leading-none">NEW PRINT ORDER</p>
          <p className="text-[14px] font-mono font-bold text-white truncate mt-1 leading-none">
            #{order.orderNumber || order.id?.slice?.(0, 8) || '—'}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Close"
          title="Close (order stays in queue)"
          className="p-1.5 rounded-none text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <MaterialIcon name="close" size={18} />
        </button>
      </div>

      {/* Amount + payment hero */}
      <div className="px-4 pt-3 pb-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 font-medium">Amount due</p>
          <p className="text-[28px] leading-8 font-extrabold text-white tracking-tight">₹{amount}</p>
        </div>
        <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-none border ${
          isPaid
            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
            : isCounter
              ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
              : 'text-zinc-300 border-white/15 bg-white/5'
        }`}>
          {isPaid ? 'Paid' : isCounter ? 'Pay at counter' : String(paymentStatus)}
        </span>
      </div>

      {/* Customer + file */}
      <div className="px-4 py-2.5 flex flex-col gap-2.5">
        <div className="flex items-center gap-3 rounded-none bg-white/[0.04] border border-white/[0.07] px-3 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-none bg-white text-black font-extrabold text-sm shrink-0">
            {String(customerName).trim().charAt(0).toUpperCase() || 'W'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">{customerName}</p>
            {order.customerPhone ? (
              <p className="text-xs text-zinc-500 truncate">{order.customerPhone}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-none bg-white/[0.04] border border-white/[0.07] px-3 py-2.5">
          <MaterialIcon name="description" size={18} className="text-zinc-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-100 truncate font-mono" title={fileName}>{fileName}</p>
            <p className="text-xs text-zinc-500">
              {fileCount > 1 ? `${fileCount} files • ` : ''}{totalPrintPages} print page{totalPrintPages === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-500 truncate px-0.5">{specBits.join('  •  ')}</p>
      </div>

      {/* Actions */}
      <div className="mt-auto p-4 pt-2 grid grid-cols-[1fr_1.4fr] gap-2.5" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => handleAction('DECLINE')}
          className="flex items-center justify-center gap-1.5 h-11 px-3 rounded-none text-sm font-semibold text-zinc-300 bg-white/[0.05] hover:bg-red-500/15 hover:text-red-300 transition-colors border border-white/10 hover:border-red-500/40 cursor-pointer"
        >
          <MaterialIcon name="close" size={18} />
          Decline
        </button>
        <button
          onClick={() => handleAction('ACCEPT_AND_PRINT')}
          className="flex items-center justify-center gap-1.5 h-11 px-3 rounded-none text-sm font-bold bg-white text-black hover:bg-zinc-200 transition-colors cursor-pointer"
        >
          <MaterialIcon name="print" size={18} />
          Accept & Print
        </button>
      </div>
    </div>
  );
};
