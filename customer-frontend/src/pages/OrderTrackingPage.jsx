import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getOrderByToken } from "../api";
import { useTheme } from "../context/ThemeContext";
import {
  CheckCircle2,
  Printer,
  ArrowLeft,
  RefreshCw,
  FileText,
  Sun,
  Moon,
} from "lucide-react";

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "FAILED", "REJECTED"];
const BASE_POLL_INTERVAL = 4000;
const MAX_BACKOFF_INTERVAL = 30000;

export const OrderTrackingPage = () => {
  const { publicToken } = useParams();
  const navigate = useNavigate();
  const { toggleTheme, isDark } = useTheme();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const pollTimeoutRef = useRef(null);
  const backoffDelayRef = useRef(BASE_POLL_INTERVAL);
  const isMountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const formatTotal = (value) =>
    value != null && !Number.isNaN(Number(value))
      ? `₹${Number(value).toFixed(2)}`
      : "—";

  const fetchOrderDetails = useCallback(
    async (isBackground = false) => {
      if (!publicToken) return;
      const seq = ++fetchSeqRef.current;

      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }

      if (!isBackground) setLoading(true);
      else setIsRefreshing(true);

      try {
        const data = await getOrderByToken(publicToken);
        if (!isMountedRef.current || fetchSeqRef.current !== seq) return;

        setOrder(data);
        setNotFound(false);
        // Reset delay on successful response
        backoffDelayRef.current = BASE_POLL_INTERVAL;

        const isTerminal =
          data?.printStatus &&
          TERMINAL_STATUSES.includes(data.printStatus.toUpperCase());

        // Schedule next poll only if the order is still active
        if (!isTerminal && isMountedRef.current) {
          pollTimeoutRef.current = setTimeout(() => {
            fetchOrderDetails(true);
          }, BASE_POLL_INTERVAL);
        }
      } catch (err) {
        console.error("Order tracking poll error:", err);
        if (!isMountedRef.current || fetchSeqRef.current !== seq) return;

        // Terminal 404 state: stop polling
        if (err?.response?.status === 404) {
          setNotFound(true);
          setOrder(null);
          if (isMountedRef.current) {
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        // Exponential backoff on polling error
        const nextDelay = Math.min(
          backoffDelayRef.current * 2,
          MAX_BACKOFF_INTERVAL,
        );
        backoffDelayRef.current = nextDelay;

        pollTimeoutRef.current = setTimeout(() => {
          fetchOrderDetails(true);
        }, nextDelay);
      } finally {
        if (isMountedRef.current && fetchSeqRef.current === seq) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [publicToken],
  );

  useEffect(() => {
    isMountedRef.current = true;
    backoffDelayRef.current = BASE_POLL_INTERVAL;

    fetchOrderDetails(false);

    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [fetchOrderDetails]);

  const getStepStatus = (stepName) => {
    if (!order) return "PENDING";
    const status = (order.printStatus || "").toUpperCase();

    if (status === "CANCELLED" || status === "REJECTED" || status === "FAILED") return status;

    if (stepName === "RECEIVED") return "COMPLETED";

    if (stepName === "PRINTING") {
      if (status === "PRINTING" || status === "COMPLETED") return "COMPLETED";
      return "CURRENT";
    }

    if (stepName === "READY") {
      if (status === "COMPLETED") return "COMPLETED";
      return "PENDING";
    }

    return "PENDING";
  };

  const failedStatus = (order?.printStatus || "").toUpperCase();
  const isFailedOrder = failedStatus === "FAILED" || failedStatus === "REJECTED" || failedStatus === "CANCELLED";
  const itemsList = order?.items && order.items.length > 0 ? order.items : [];

  if (loading && !order && !notFound) {
    return (
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col transition-colors duration-200">
        <header className="bg-[var(--bg-surface)] border-b border-[var(--border-app)] py-3 sm:py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <div className="h-9 w-28 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] animate-pulse" />
          </div>
        </header>
        <main className="flex-1 max-w-xl w-full mx-auto px-5 sm:px-6 py-10 space-y-8">
          <div className="text-center space-y-3">
            <div className="h-6 w-36 mx-auto rounded-full bg-[var(--bg-subtle)] animate-pulse" />
            <div className="h-12 w-48 mx-auto rounded-xl bg-[var(--bg-subtle)] animate-pulse" />
            <div className="h-4 w-64 mx-auto rounded bg-[var(--bg-subtle)] animate-pulse" />
          </div>
          <div className="bg-[var(--bg-surface)] rounded-2xl p-5 sm:p-8 border border-[var(--border-app)] space-y-4">
            {[0, 1, 2].map((k) => (
              <div key={k} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[var(--bg-subtle)] animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-[var(--bg-subtle)] animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-[var(--bg-subtle)] animate-pulse" />
                </div>
              </div>
            ))}
            <p className="text-sm text-[var(--text-secondary)] font-medium text-center">Loading order status…</p>
          </div>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col transition-colors duration-200">
        <header className="bg-[var(--bg-surface)] border-b border-[var(--border-app)] py-3 sm:py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>New Print</span>
            </button>
          </div>
        </header>
        <main className="flex-1 max-w-xl w-full mx-auto px-5 sm:px-6 py-10">
          <div className="bg-[var(--bg-surface)] rounded-2xl p-8 border border-[var(--border-app)] text-center space-y-4 shadow-xs">
            <h1 className="text-2xl font-extrabold">Order not found</h1>
            <p className="text-sm text-[var(--text-secondary)] font-medium">
              This tracking link is invalid or the order was removed. Check the link or scan the shop QR code to place a new print.
            </p>
            <button onClick={() => navigate("/")} className="btn-primary w-full h-12">
              Back to start — scan shop QR for a new print
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col transition-colors duration-200">
      {/* Header */}
      <header className="bg-[var(--bg-surface)] border-b border-[var(--border-app)] py-3 sm:py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs transition-colors duration-200">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>New Print</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="w-9 h-9 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center border border-[var(--border-app)] bg-[var(--bg-surface)] cursor-pointer shrink-0"
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? (
                <Moon className="w-4 h-4 text-blue-400" />
              ) : (
                <Sun className="w-4 h-4 text-amber-500" />
              )}
            </button>
            <button
              onClick={() => fetchOrderDetails(false)}
              disabled={isRefreshing || loading}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh order status"
            >
              <RefreshCw
                className={`w-5 h-5 ${isRefreshing ? "animate-spin text-[var(--text-primary)]" : ""}`}
              />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-5 sm:px-6 py-10 space-y-8">
        {/* Order Identifier */}
        <div className="text-center space-y-2">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs font-bold bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-app)] uppercase tracking-wider">
            Live Print Token
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            #{order?.orderNumber || "---"}
          </h1>
          <p className="text-base text-[var(--text-secondary)] font-medium">
            Keep this screen open while waiting at the shop counter.
          </p>
          <p className="text-xs text-[var(--text-muted)] font-medium">
            For a new print, use “New Print” above, then scan the shop QR code again.
          </p>
        </div>

        {isFailedOrder && (
          <div className="p-5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-300 text-sm font-semibold">
            Order {failedStatus === "CANCELLED" ? "cancelled" : failedStatus === "REJECTED" ? "rejected by the shop" : "failed"}. Please show this screen at the counter or place a new print.
          </div>
        )}

        {/* Live Timeline Component */}
        <div className="bg-[var(--bg-surface)] rounded-2xl p-5 sm:p-8 border border-[var(--border-app)] space-y-6 sm:space-y-8 shadow-xs">
          <div className="space-y-6 relative before:absolute before:left-5 before:top-4 before:bottom-4 before:w-0.5 before:bg-[var(--timeline-line)]">
            {/* Step 1: Received */}
            <div className="flex items-start gap-5 relative z-10">
              <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] text-[var(--pill-active-text)] flex items-center justify-center font-bold text-sm shrink-0 border-4 border-[var(--bg-surface)] shadow-xs">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="pt-1">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  Order Received
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  Sent directly to shop queue
                </p>
              </div>
            </div>

            {/* Step 2: Printing */}
            <div className="flex items-start gap-5 relative z-10">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border-4 border-[var(--bg-surface)] shadow-xs ${
                  getStepStatus("PRINTING") === "COMPLETED"
                    ? "bg-[var(--color-accent)] text-[var(--pill-active-text)]"
                    : getStepStatus("PRINTING") === "CURRENT"
                      ? "bg-blue-600 text-white animate-pulse"
                      : "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-app)]"
                }`}
              >
                <Printer className="w-5 h-5" />
              </div>
              <div className="pt-1">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  Printing Files
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  {order?.printStatus === "PRINTING"
                    ? "Operator is currently printing your files"
                    : "Waiting in printer queue"}
                </p>
              </div>
            </div>

            {/* Step 3: Ready */}
            <div className="flex items-start gap-5 relative z-10">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border-4 border-[var(--bg-surface)] shadow-xs ${
                  getStepStatus("READY") === "COMPLETED"
                    ? "bg-emerald-600 text-white"
                    : "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-app)]"
                }`}
              >
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="pt-1">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  Ready for Pickup
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  Collect prints at shop counter
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Order Details & Items Card */}
        {order && (
          <div className="bg-[var(--bg-surface)] rounded-2xl p-4 sm:p-6 border border-[var(--border-app)] space-y-4 sm:space-y-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[var(--border-app)]">
              <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Order Items ({itemsList.length || 1})
              </span>
              <span className="text-xs font-bold text-[var(--text-secondary)]">Status</span>
            </div>

            <div className="space-y-4 divide-y divide-[var(--border-app)]">
              {itemsList.length > 0 ? (
                itemsList.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-start justify-between gap-3 sm:gap-4 ${idx > 0 ? "pt-3 sm:pt-4" : ""}`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)] mt-0.5">
                        <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                          {item.document?.originalFileName || `File ${idx + 1}`}
                        </p>
                        <p className="text-[10px] sm:text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
                          {item.colorMode === "BW" ? "B&W" : "Color"} ·{" "}
                          {item.paperSize} · {item.copies}{" "}
                          {item.copies === 1 ? "copy" : "copies"}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-md text-xs font-extrabold uppercase ${
                          item.printStatus === "COMPLETED"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : item.printStatus === "PRINTING"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                              : item.printStatus === "FAILED" || item.printStatus === "REJECTED" || item.printStatus === "CANCELLED"
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-500/20"
                                : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-app)]"
                        }`}
                      >
                        {item.printStatus}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)] text-sm font-medium">
                    {order.document?.originalFileName || "Print Order"}
                  </span>
                  <span className="font-bold text-[var(--text-primary)] text-base">
                    {formatTotal(order?.totalPrice)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-app)]">
              <span className="text-[var(--text-secondary)] text-sm font-medium">
                Total Amount
              </span>
              <span className="text-xl font-extrabold text-[var(--text-primary)]">
                {formatTotal(order?.totalPrice)}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
