import React, { useEffect, useState } from "react";
import {
  getAdminOrders,
  updateOrderPrintStatus,
  updateOrderPaymentStatus,
  updateShopProfile,
  getShopProfile,
  sendHeartbeat,
  deleteAdminDocumentsBulk,
  deleteAdminDocument,
  deleteAdminOrder,
} from "../api";
import { Sidebar } from "../components/Sidebar";
import { TopHeader } from "../components/TopHeader";
import { OrderCard } from "../components/OrderCard";
import { OrderDetailModal } from "../components/OrderDetailModal";
import { PricingSettings } from "../components/PricingSettings";
import { QRCodeModal } from "../components/QRCodeModal";
import { QRCodePage } from "../components/QRCodePage";
import { SettingsView } from "../components/SettingsView";
import { FileManagementView } from "../components/FileManagementView";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { Client } from "@stomp/stompjs";
import { printClient } from "../services/printClient";
import { getNotifPref } from "../services/notifyPrefs";

export const AdminDashboardPage = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState("DASHBOARD");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("admin_sidebar_collapsed");
    return saved !== null ? saved === "true" : true;
  });

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("admin_sidebar_collapsed", String(next));
      return next;
    });
  };

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [fileCleanupOrder, setFileCleanupOrder] = useState(null);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  
  const [clientState, setClientState] = useState(printClient.getState());
  const [wsStatus, setWsStatus] = useState("CONNECTING"); // "CONNECTED" | "CONNECTING" | "RECONNECTING" | "DISCONNECTED"
  const notifiedOrders = React.useRef(new Set());
  const incomingOrdersCache = React.useRef(new Map());

  // Bound notification dedupe: evict oldest past 500 so the set can't grow
  // without bound during long counter sessions.
  const markOrderNotified = (orderId, order) => {
    if (notifiedOrders.current.size >= 500) {
      const oldest = notifiedOrders.current.values().next().value;
      notifiedOrders.current.delete(oldest);
      incomingOrdersCache.current.delete(oldest);
    }
    notifiedOrders.current.add(orderId);
    incomingOrdersCache.current.set(orderId, order);
  };

  // Once an order reaches a terminal state it may legitimately re-appear as a
  // new order later — allow re-notify by clearing its dedupe entry.
  const clearTerminalNotified = (list) => {
    for (const o of list || []) {
      if (
        o?.id &&
        (o.printStatus === "COMPLETED" ||
          o.printStatus === "FAILED" ||
          o.printStatus === "CANCELLED" ||
          o.printStatus === "DECLINED")
      ) {
        notifiedOrders.current.delete(o.id);
        incomingOrdersCache.current.delete(o.id);
      }
    }
  };
  const ordersRef = React.useRef([]); // To access current orders in callbacks

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [shopIsOpen, setShopIsOpen] = useState(user?.isOpen !== false);
  const [isTogglingShopStatus, setIsTogglingShopStatus] = useState(false);
  const [statusToast, setStatusToast] = useState(null);

  const handleToggleShopStatus = async () => {
    if (isTogglingShopStatus) return;
    const previousStatus = shopIsOpen;
    const nextStatus = !shopIsOpen;
    setIsTogglingShopStatus(true);
    setShopIsOpen(nextStatus);

    try {
      const updated = await updateShopProfile({ isOpen: nextStatus });
      const confirmedStatus = updated.isOpen !== false;
      setShopIsOpen(confirmedStatus);
      const userData = JSON.parse(localStorage.getItem("admin_user_data") || "{}");
      userData.isOpen = confirmedStatus;
      localStorage.setItem("admin_user_data", JSON.stringify(userData));
      setStatusToast({
        message: confirmedStatus ? "Shop is now Active and accepting orders" : "Shop is now Closed and not accepting new orders",
        type: "success"
      });
      setTimeout(() => setStatusToast(null), 3000);
    } catch (err) {
      console.error("Failed to update shop status:", err);
      setShopIsOpen(previousStatus);
      setStatusToast({
        message: "Failed to update shop status. Please try again.",
        type: "error"
      });
      setTimeout(() => setStatusToast(null), 4000);
    } finally {
      setIsTogglingShopStatus(false);
    }
  };

  const handleConfirmDeleteFiles = async () => {
    if (!fileCleanupOrder) return;
    setIsDeletingFiles(true);
    try {
      const docIds = [];
      if (fileCleanupOrder.items && fileCleanupOrder.items.length > 0) {
        fileCleanupOrder.items.forEach((it) => {
          if (it.document?.id) docIds.push(it.document.id);
        });
      }
      if (fileCleanupOrder.document?.id && !docIds.includes(fileCleanupOrder.document.id)) {
        docIds.push(fileCleanupOrder.document.id);
      }

      if (docIds.length > 0) {
        try {
          await deleteAdminDocumentsBulk(docIds);
        } catch (bulkErr) {
          console.warn("Bulk delete endpoint returned error, trying sequential cleanup:", bulkErr);
          const failedDocs = [];
          for (const docId of docIds) {
            try {
              await deleteAdminDocument(docId);
            } catch (singleErr) {
              console.warn(`Individual deletion failed for document ${docId}:`, singleErr);
              failedDocs.push(docId);
            }
          }
          if (failedDocs.length === docIds.length) {
            throw new Error(`Could not delete any of the ${docIds.length} file(s).`);
          }
          if (failedDocs.length > 0) {
            setStatusToast({
              message: `Partial cleanup for order #${fileCleanupOrder.orderNumber}: ${docIds.length - failedDocs.length}/${docIds.length} files deleted, ${failedDocs.length} failed.`,
              type: "error",
            });
            setTimeout(() => setStatusToast(null), 4000);
            setIsDeletingFiles(false);
            setFileCleanupOrder(null);
            return;
          }
        }
      }

      // Update state locally so UI immediately reflects cleaned files without losing order history
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id === fileCleanupOrder.id) {
            return {
              ...o,
              document: null,
              items: (o.items || []).map((it) => ({ ...it, document: null })),
            };
          }
          return o;
        })
      );

      if (selectedOrder && selectedOrder.id === fileCleanupOrder.id) {
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                document: null,
                items: (prev.items || []).map((it) => ({ ...it, document: null })),
              }
            : null
        );
      }

      setStatusToast({
        message: `Uploaded files for order #${fileCleanupOrder.orderNumber} deleted. Order record preserved.`,
        type: "success",
      });
      setTimeout(() => setStatusToast(null), 3000);
    } catch (err) {
      console.error("Failed to delete files:", err);
      setStatusToast({
        message: "Failed to delete files. Please try again.",
        type: "error",
      });
      setTimeout(() => setStatusToast(null), 4000);
    } finally {
      setIsDeletingFiles(false);
      setFileCleanupOrder(null);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!orderToDelete) return;
    setIsDeletingOrder(true);
    try {
      // COMPLETED orders require explicit confirmation server-side; the modal
      // shown here IS that confirmation, so forward confirm=true for them.
      await deleteAdminOrder(orderToDelete.id, orderToDelete.printStatus === "COMPLETED");
      setOrders((prev) => prev.filter((o) => o.id !== orderToDelete.id));
      ordersRef.current = ordersRef.current.filter((o) => o.id !== orderToDelete.id);
      notifiedOrders.current.delete(orderToDelete.id);
      incomingOrdersCache.current.delete(orderToDelete.id);
      if (selectedOrder && selectedOrder.id === orderToDelete.id) {
        setSelectedOrder(null);
      }
      setStatusToast({
        message: `Order #${orderToDelete.orderNumber} deleted permanently.`,
        type: "success",
      });
      setTimeout(() => setStatusToast(null), 3000);
    } catch (err) {
      console.error("Failed to delete order:", err);
      setStatusToast({
        message: err.response?.data?.message || "Failed to delete order. Please try again.",
        type: "error",
      });
      setTimeout(() => setStatusToast(null), 4000);
    } finally {
      setIsDeletingOrder(false);
      setOrderToDelete(null);
    }
  };

  const handlePrintOrderDirect = async (orderToPrint) => {
    // Optimistically update order state to PRINTING immediately
    setOrders((prev) =>
      prev.map((o) => (o.id === orderToPrint.id ? { ...o, printStatus: "PRINTING" } : o))
    );
    try {
      await updateOrderPrintStatus(orderToPrint.id, "PRINTING");
      await printClient.executePrintJob(orderToPrint);
      
      // Optimistically update order state to COMPLETED immediately so it transitions instantly
      setOrders((prev) =>
        prev.map((o) => (o.id === orderToPrint.id ? { ...o, printStatus: "COMPLETED" } : o))
      );
      await updateOrderPrintStatus(orderToPrint.id, "COMPLETED");
      await fetchOrders(true);
    } catch (err) {
      console.error("Direct print failed:", err);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderToPrint.id ? { ...o, printStatus: "FAILED" } : o))
      );
      await updateOrderPrintStatus(orderToPrint.id, "FAILED");
      await fetchOrders(true);
    }
  };

  useEffect(() => {
    fetchOrders();
    // Document Studio return: re-open the order we came from.
    try {
      const returnId = sessionStorage.getItem("studioReturnOrder");
      if (returnId) {
        sessionStorage.removeItem("studioReturnOrder");
        // Orders load async — retry briefly until the list arrives.
        let attempts = 0;
        const timer = setInterval(() => {
          attempts += 1;
          setOrders((prev) => {
            const found = prev.find((o) => String(o.id) === String(returnId));
            if (found) {
              setSelectedOrder(found);
              clearInterval(timer);
            } else if (attempts > 20) {
              clearInterval(timer);
            }
            return prev;
          });
        }, 500);
        setTimeout(() => clearInterval(timer), 12000);
      }
    } catch {}
    // Initialize Print Client
    const unsubscribeClient = printClient.subscribe(setClientState);

    const interval = setInterval(() => {
      fetchOrders(true);
    }, 30000); // 30s fallback polling
    
    // Heartbeat ping every 10 seconds to maintain single-device active session
    const heartbeatInterval = setInterval(async () => {
      try {
        await sendHeartbeat();
      } catch (err) {
        console.error("Heartbeat failed", err);
      }
    }, 10000);

    const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:8085";
    let baseUrl = API_URL;
    if (baseUrl.endsWith("/api")) {
      baseUrl = baseUrl.slice(0, -4);
    }
    // Default to absolute backend URL to prevent Vite proxy 404s
    if (!baseUrl || baseUrl.startsWith("/")) {
      baseUrl = "http://localhost:8085";
    }

    const isSecure = baseUrl.startsWith("https://");
    const wsProtocol = isSecure ? "wss://" : "ws://";
    const hostAndPort = baseUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}${hostAndPort}/ws-admin`;

    const token = localStorage.getItem("admin_jwt_token");
    setWsStatus("CONNECTING");
    console.log(`[PrintAlfa WS] Connecting to ${wsUrl}...`);

    let currentReconnectDelay = 2000;
    const maxReconnectDelay = 20000;

    const stompClient = new Client({
      brokerURL: wsUrl,
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 2000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      beforeConnect: () => {
        const freshToken = localStorage.getItem("admin_jwt_token");
        if (freshToken) {
          stompClient.connectHeaders = { Authorization: `Bearer ${freshToken}` };
        }
      },
    });

    stompClient.onConnect = (frame) => {
      console.log("[PrintAlfa WS] STOMP CONNECTED:", frame);
      setWsStatus("CONNECTED");
      currentReconnectDelay = 2000;
      stompClient.reconnectDelay = 2000;

      const shopId = user?.shopId;
      if (shopId) {
        console.log(`[PrintAlfa WS] Subscription active on /topic/admin/shop/${shopId}/orders`);
        stompClient.subscribe(
          `/topic/admin/shop/${shopId}/orders`,
          (message) => {
            if (message.body) {
              let event;
              try {
                event = JSON.parse(message.body);
              } catch (parseErr) {
                console.error("[PrintAlfa WS] Failed to parse message body:", parseErr);
                return;
              }

              console.log("[PrintAlfa] REALTIME EVENT RECEIVED:", event);
              const eventType = event?.type || event?.eventType || "UNKNOWN";
              const order = event?.order || event?.data || event?.payload || (event?.id ? event : null);
              const orderId = order?.id || event?.orderId || event?.id;

              console.log("[PrintAlfa] EVENT TYPE:", eventType);
              console.log("[PrintAlfa] ORDER ID:", orderId);

              // Re-fetch orders silently to update the list
              fetchOrders(true);

              // Instantly trigger physical print notification on genuinely new
              // print requests only (explicit event types with a NEW/PENDING
              // order) — narrow heuristic avoids replay storms from generic
              // status broadcasts re-listing existing orders.
              const isFreshOrder =
                order &&
                (order.printStatus === "NEW" ||
                  order.printStatus === "PENDING" ||
                  !order.printStatus);
              const isNewPrintEvent =
                (eventType === "NEW_PRINT_REQUEST" ||
                  eventType === "ORDER_CREATED") &&
                isFreshOrder;

              if (isNewPrintEvent && order && orderId) {
                if (!notifiedOrders.current.has(orderId)) {
                  markOrderNotified(orderId, order);

                  if (!getNotifPref("newOrderPopup", true)) {
                    console.log("[PrintAlfa] Order popup suppressed by notification prefs:", orderId);
                  } else if (window.electronAPI?.showOrderNotification) {
                    console.log("[PrintAlfa] Triggering showOrderNotification for order:", orderId);
                    window.electronAPI.showOrderNotification(order);
                  } else {
                    console.log("[PrintAlfa] New print request received in web mode. Check order queue.");
                  }
                } else {
                  console.log("[PrintAlfa] Order already notified:", orderId);
                }
              }
            }
          },
        );
      }
    };

    stompClient.onDisconnect = () => {
      console.log("[PrintAlfa WS] Disconnected");
      setWsStatus("DISCONNECTED");
    };

    stompClient.onWebSocketClose = (evt) => {
      console.log(`[PrintAlfa WS] WebSocket closed (code ${evt.code}). Reconnecting in ${currentReconnectDelay} ms...`);
      setWsStatus("RECONNECTING");
      currentReconnectDelay = Math.min(currentReconnectDelay * 1.5, maxReconnectDelay);
      stompClient.reconnectDelay = currentReconnectDelay;
    };

    stompClient.onWebSocketError = (error) => {
      console.error("[PrintAlfa WS] Error:", error);
      setWsStatus("RECONNECTING");
    };

    stompClient.onStompError = (frame) => {
      console.error("[PrintAlfa WS] STOMP error: " + frame.headers["message"]);
      console.error("[PrintAlfa WS] Details: " + frame.body);
      // Route through the reconnect path instead of sticking in DISCONNECTED.
      setWsStatus("RECONNECTING");
    };

    stompClient.activate();

    let unsubscribeIpc = null;
    if (window.electronAPI?.onOrderActionResult) {
      unsubscribeIpc = window.electronAPI.onOrderActionResult(async ({ orderId, action }) => {
        console.log(`Received action ${action} for order ${orderId}`);
        if (action === 'ACCEPT_AND_PRINT') {
          try {
            await updateOrderPrintStatus(orderId, 'PRINTING');
            await fetchOrders(true);
            
            // Resolve full order in priority: 1. incomingOrdersCache, 2. ordersRef.current, 3. fresh fetch
            let fullOrder = incomingOrdersCache.current.get(orderId) || ordersRef.current.find(o => o.id === orderId);

            if (!fullOrder || (!fullOrder.items && !fullOrder.document)) {
              try {
                const freshOrders = await getAdminOrders();
                ordersRef.current = freshOrders || [];
                setOrders(freshOrders || []);
                fullOrder = freshOrders.find(o => o.id === orderId) || fullOrder;
              } catch (fetchErr) {
                console.error("Failed to fetch fresh order before printing:", fetchErr);
              }
            }

            if (!fullOrder) {
              fullOrder = { id: orderId, orderNumber: "Unknown" };
            }
            
            await printClient.executePrintJob(fullOrder);
            await updateOrderPrintStatus(orderId, 'COMPLETED');
            await fetchOrders(true);
          } catch (e) {
            console.error("Failed to print order:", e);
            await updateOrderPrintStatus(orderId, 'FAILED');
            await fetchOrders(true);
          }
        } else if (action === 'DECLINE') {
          try {
            await updateOrderPrintStatus(orderId, 'CANCELLED');
            await fetchOrders(true);
          } catch (e) {
            console.error("Failed to decline order:", e);
          }
        }
      });
    }

    return () => {
      clearInterval(interval);
      clearInterval(heartbeatInterval);
      stompClient.deactivate();
      unsubscribeClient();
      // Remove the IPC listener so StrictMode double-mount can't double-print.
      if (typeof unsubscribeIpc === "function") {
        try { unsubscribeIpc(); } catch {}
      }
      unsubscribeIpc = null;
    };
  }, [user]);

  const fetchOrders = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const [ordersResult, shopResult] = await Promise.allSettled([
        getAdminOrders(),
        getShopProfile(),
      ]);

      if (ordersResult.status === "fulfilled") {
        setOrders(ordersResult.value || []);
        ordersRef.current = ordersResult.value || [];
        clearTerminalNotified(ordersResult.value || []);
      } else {
        throw ordersResult.reason;
      }

      if (shopResult.status === "fulfilled" && shopResult.value) {
        setShopIsOpen(shopResult.value.isOpen !== false);
        const userData = JSON.parse(localStorage.getItem("admin_user_data") || "{}");
        userData.isOpen = shopResult.value.isOpen !== false;
        if (shopResult.value.name) userData.shopName = shopResult.value.name;
        localStorage.setItem("admin_user_data", JSON.stringify(userData));
      }
    } catch (err) {
      console.error("Failed to fetch orders:", err);
      if (!isBackground) {
        setError(
          "Unable to load shop orders. Please check backend connection.",
        );
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    // Optimistically update status locally
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, printStatus: newStatus } : o))
    );
    try {
      await updateOrderPrintStatus(orderId, newStatus);
      await fetchOrders(true);
    } catch (err) {
      console.error(err);
      await fetchOrders(true);
    }
  };

  const isUpdatingPaymentRef = React.useRef(new Set());
  const handleUpdatePaymentStatus = async (orderId, newPaymentStatus) => {
    // Double-click guard: one in-flight payment toggle per order.
    if (isUpdatingPaymentRef.current.has(orderId)) return;
    isUpdatingPaymentRef.current.add(orderId);
    const prevOrders = ordersRef.current;
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, paymentStatus: newPaymentStatus } : o))
    );
    try {
      await updateOrderPaymentStatus(orderId, newPaymentStatus);
      await fetchOrders(true);
    } catch (err) {
      console.error(err);
      // Revert optimistic update on failure.
      setOrders(prevOrders);
      ordersRef.current = prevOrders;
    } finally {
      isUpdatingPaymentRef.current.delete(orderId);
    }
  };

  // Operational Queue Classification (Mutually Exclusive Rules)
  const isNewOrder = (o) => o.printStatus === "PENDING" || o.printStatus === "NEW";
  const isCompletedOrder = (o) => o.printStatus === "COMPLETED";
  const isFailedOrder = (o) => o.printStatus === "FAILED";
  const isCancelledOrder = (o) => o.printStatus === "CANCELLED" || o.printStatus === "DECLINED";
  // Normal active print workflow: NEW, PENDING, PRINTING, PARTIALLY_PRINTED
  const isNormalWorkflowOrder = (o) => !isCompletedOrder(o) && !isFailedOrder(o) && !isCancelledOrder(o);

  // Operational Queue Counters (Calculated strictly from identical rules)
  // ALL = every order ever loaded; ACTIVE = live workflow only (NEW/PENDING/
  // PRINTING incl. partial) — never the same set.
  const allCount = orders.length;
  const activeCount = orders.filter(isNormalWorkflowOrder).length;
  const failedCount = orders.filter(isFailedOrder).length;
  const completedCount = orders.filter(isCompletedOrder).length;
  const pendingCount = orders.filter(isNewOrder).length;
  const printingCount = orders.filter((o) => o.printStatus === "PRINTING").length;

  // STRICT DASHBOARD QUEUE: ONLY orders with status = NEW (waiting to be printed)
  const dashboardNewOrders = orders.filter(isNewOrder);

  // Today's Overview & Revenue (Monitoring)
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const todayReceived = todayOrders.length;
  const todayPrinted = todayOrders.filter(isCompletedOrder).length;
  const todayDeclined = todayOrders.filter(isCancelledOrder).length;
  const todayPrinting = todayOrders.filter((o) => o.printStatus === "PRINTING").length;
  const todayNew = todayOrders.filter(isNewOrder).length;
  const todayFailed = todayOrders.filter(isFailedOrder).length;

  const revenueTotal = todayOrders.filter(isCompletedOrder).reduce((sum, o) => sum + o.totalPrice, 0);
  const revenueOnline = todayOrders.filter(o => isCompletedOrder(o) && o.paymentStatus === "PAID").reduce((sum, o) => sum + o.totalPrice, 0);
  const revenuePending = todayOrders.filter(o => isCompletedOrder(o) && o.paymentStatus !== "PAID").reduce((sum, o) => sum + o.totalPrice, 0);

  // Filtered orders logic for Orders Tab (Mutually exclusive operational queues)
  // Dashboard = NEW/PENDING only; Orders->Active = live workflow incl. PRINTING;
  // Orders->Completed = COMPLETED; Orders->Failed = FAILED. Cancelled/declined
  // history is reachable via ALL.
  const filteredOrders = orders.filter((order) => {
    if (statusFilter === "ALL") {
      // No status restriction: full history incl. cancelled.
    } else if (statusFilter === "ACTIVE") {
      if (!isNormalWorkflowOrder(order)) return false;
    } else if (statusFilter === "FAILED") {
      if (!isFailedOrder(order)) return false;
    } else if (statusFilter === "COMPLETED") {
      if (!isCompletedOrder(order)) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const filename = (order.document?.originalFileName || "").toLowerCase();
      const orderNum = (order.orderNumber || "").toLowerCase();
      const customer = (order.customerName || "").toLowerCase();
      const phone = (order.customerPhone || "").toLowerCase();

      return (
        filename.includes(q) ||
        orderNum.includes(q) ||
        customer.includes(q) ||
        phone.includes(q)
      );
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-row antialiased transition-colors duration-200">
      {/* ChatGPT-Style Permanent Collapsible Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === "QR") setShowQRModal(false);
        }}
        user={user}
        onLogout={onLogout}
        pendingCount={pendingCount}
        printingCount={printingCount}
        isRefreshing={isRefreshing}
        wsStatus={wsStatus}
        onRefresh={() => fetchOrders(false)}
      />

      {/* Main Content Column (dynamically reflows/resizes with zero overlay) */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen bg-[var(--bg-app)] transition-colors duration-200">
        {/* Top Header Bar */}
        <TopHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isRefreshing={isRefreshing}
          onRefresh={() => fetchOrders(false)}
          shopIsOpen={shopIsOpen}
          isTogglingShopStatus={isTogglingShopStatus}
          onToggleShopStatus={handleToggleShopStatus}
          user={user}
        />

        {/* Transient Status Notification Toast */}
        {statusToast && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-4">
            <div
              className={`p-3 rounded-none border text-xs font-semibold flex items-center justify-between transition-all ${
                statusToast.type === "error"
                  ? "bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error-text)]"
                  : "bg-[var(--color-success-bg)] border-[var(--color-success-border)] text-[var(--color-success-text)]"
              }`}
            >
              <div className="flex items-center gap-2">
                {statusToast.type === "error" ? (
                  <MaterialIcon name="warning" size={16} className="text-[var(--color-error-text)] shrink-0" />
                ) : (
                  <MaterialIcon name="check_circle" size={16} className="text-[var(--color-success-text)] shrink-0" />
                )}
                <span>{statusToast.message}</span>
              </div>
              <button
                onClick={() => setStatusToast(null)}
                className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-4 font-normal cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Main Content Container */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-5 space-y-5">
        {/* DASHBOARD TAB VIEW */}
        {activeTab === "DASHBOARD" && (
          <div className="space-y-5">
            {/* Top 3 Balanced Large Metric Panels */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Today's Earnings */}
              <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-4 sm:p-5 flex items-center justify-between transition-colors duration-200">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Today's Earnings
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] font-mono tracking-tight">
                    ₹{revenueTotal.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                    ₹{revenueOnline.toFixed(2)} online · ₹{revenuePending.toFixed(2)} cash
                  </p>
                </div>
                <MaterialIcon name="payments" size={20} className="text-[var(--color-accent)] shrink-0" />
              </div>

              {/* Prints Today */}
              <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-4 sm:p-5 flex items-center justify-between transition-colors duration-200">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Prints Today
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] font-mono tracking-tight">
                    {todayPrinted}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                    {todayPrinting} jobs in progress · {todayPrinted} printed
                  </p>
                </div>
                <MaterialIcon name="print" size={20} className="text-[var(--color-accent)] shrink-0" />
              </div>

              {/* Orders Today */}
              <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-4 sm:p-5 flex items-center justify-between transition-colors duration-200">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Orders Today
                  </p>
                  <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] font-mono tracking-tight">
                    {todayReceived}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                    {todayNew} queued · {todayPrinted} completed
                  </p>
                </div>
                <MaterialIcon name="receipt_long" size={20} className="text-[var(--color-accent)] shrink-0" />
              </div>
            </div>

            {/* Live Orders Section */}
            {/* Orders Waiting to Print Section (STRICTLY NEW ORDERS ONLY) */}
            <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] overflow-hidden transition-colors duration-200">
              {/* Card Header & Controls */}
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-app)]">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)] uppercase tracking-wider">
                      Orders Waiting to Print
                    </h2>
                    {dashboardNewOrders.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-none text-[11px] font-mono font-bold bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
                        <span>{dashboardNewOrders.length} NEW</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-none text-[11px] font-mono font-semibold bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-app)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                        <span>Live Sync Active</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
                    Incoming customer orders waiting for shop print action ({dashboardNewOrders.length} waiting)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("ORDERS");
                      setStatusFilter("ACTIVE");
                    }}
                    className="px-2.5 py-1.5 rounded-none border border-[var(--border-app)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>View Active Printing ({activeCount})</span>
                    <MaterialIcon name="arrow_forward" size={14} className="text-[var(--text-secondary)]" />
                  </button>
                </div>
              </div>

              {/* Table Column Label Row */}
              <div className="bg-[var(--bg-surface)] px-4 sm:px-6 py-2.5 text-[11px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider hidden md:flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div className="w-5/12">Order Details / Customer</div>
                <div className="w-7/12 flex items-center justify-end gap-4 sm:gap-6 pr-2">
                  <span className="w-28 text-left">Status</span>
                  <span className="w-24 text-left">Payment</span>
                  <span className="text-right flex-1 pr-1">Amount & Action</span>
                </div>
              </div>

              {/* Order List Content */}
              {loading ? (
                <div className="divide-y divide-[var(--border-subtle)] p-6 space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="py-3 space-y-2 animate-pulse">
                      <div className="h-4 bg-[var(--bg-elevated)] rounded-none w-1/3" />
                      <div className="h-3 bg-[var(--bg-elevated)] rounded-none w-2/3" />
                    </div>
                  ))}
                </div>
              ) : dashboardNewOrders.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <MaterialIcon name="check_circle" size={28} className="text-[#22C55E] mx-auto" />
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
                      No orders waiting to be printed
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-sm mx-auto">
                      All incoming print requests have been started or completed. New customer orders will appear here automatically in real time.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("ORDERS");
                        setStatusFilter("COMPLETED");
                      }}
                      className="btn-secondary-sm cursor-pointer"
                    >
                      <span>View Completed ({completedCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("QR")}
                      className="btn-primary-sm cursor-pointer"
                    >
                      <MaterialIcon name="qr_code_2" size={14} />
                      <span>Shop QR</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {dashboardNewOrders.slice(0, 20).map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onUpdateStatus={handleUpdateStatus}
                      onUpdatePaymentStatus={handleUpdatePaymentStatus}
                      onPrintOrder={handlePrintOrderDirect}
                      onSelectOrder={(ord) => setSelectedOrder(ord)}
                      onDeleteFiles={(ord) => setFileCleanupOrder(ord)}
                      onDeleteOrder={(ord) => setOrderToDelete(ord)}
                      clientState={clientState}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* FULL ORDERS QUEUE & HISTORY TAB VIEW */}
        {(activeTab === "ORDERS" || activeTab === "HISTORY") && (
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-5 sm:p-6 space-y-5 transition-colors duration-200">
            {/* Header & Search / Filter Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
              <div>
                <h1 className="text-lg font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  {activeTab === "HISTORY" ? "Order History" : "Orders List"}
                </h1>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
                  {activeTab === "HISTORY"
                    ? "Archived completed and cancelled print requests"
                    : "Operational print queue, failed retries, and completed history"}
                </p>
              </div>

              {/* Search Box - Sharp Rectangular Minimal Design */}
              <div className="relative w-full md:w-80">
                <MaterialIcon name="search" size={16} className="text-[var(--text-muted)] pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by name, file, order #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-medium text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors"
                />
              </div>
            </div>

            {/* Filter Tabs: Separate rectangular controls inspired by reference */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-app)] pb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)] mr-1">Filter:</span>
                <div className="inline-flex items-center gap-1">
                  {[
                    { key: "ALL", label: "All", count: allCount },
                    { key: "ACTIVE", label: "Active", count: activeCount },
                    { key: "FAILED", label: "Failed", count: failedCount },
                    { key: "COMPLETED", label: "Completed", count: completedCount },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatusFilter(tab.key)}
                      className={`px-3 py-1.5 rounded-none text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 border ${
                        statusFilter === tab.key
                          ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)]"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-app)] hover:bg-[var(--bg-elevated)]"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-none text-[10px] font-mono font-bold ${
                          statusFilter === tab.key
                            ? "bg-[var(--bg-app)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-[var(--text-secondary)] font-mono">
                Showing <strong className="text-[var(--text-primary)] font-semibold">{filteredOrders.length}</strong> of {orders.length} orders
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="p-3 rounded-none bg-[var(--color-error-bg)] border border-[var(--color-error-border)] text-[var(--color-error-text)] text-xs font-medium flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="warning" size={16} className="text-[var(--color-error-text)] shrink-0" />
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchOrders(false)}
                  className="px-2.5 py-1 rounded-none bg-[var(--bg-panel)] border border-[var(--border-app)] text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Table Column Label Row */}
            <div className="bg-[var(--bg-surface)] px-4 sm:px-6 py-2.5 text-[11px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider hidden md:flex items-center justify-between border-y border-[var(--border-app)]">
              <div className="w-5/12">Order Details / Customer</div>
              <div className="w-7/12 flex items-center justify-end gap-4 sm:gap-6 pr-2">
                <span className="w-28 text-left">Status</span>
                <span className="w-24 text-left">Payment</span>
                <span className="text-right flex-1 pr-1">Amount & Action</span>
              </div>
            </div>

            {/* Orders List */}
            {loading ? (
              <div className="divide-y divide-[var(--border-subtle)] p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="py-3 space-y-2 animate-pulse">
                    <div className="h-4 bg-[var(--bg-elevated)] rounded-none w-1/3" />
                    <div className="h-3 bg-[var(--bg-elevated)] rounded-none w-2/3" />
                  </div>
                ))}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <MaterialIcon name="inbox" size={32} className="text-[var(--text-secondary)] mx-auto" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
                    No matching print orders found
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-sm mx-auto">
                    {searchQuery
                      ? `No orders matching "${searchQuery}".`
                      : statusFilter !== "ALL"
                        ? `No orders currently marked as "${statusFilter}".`
                        : "New print requests will appear here in real-time as customers send orders."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] border-b border-[var(--border-app)]">
                {filteredOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onUpdateStatus={handleUpdateStatus}
                    onUpdatePaymentStatus={handleUpdatePaymentStatus}
                    onPrintOrder={handlePrintOrderDirect}
                    onSelectOrder={(ord) => setSelectedOrder(ord)}
                    onDeleteFiles={(ord) => setFileCleanupOrder(ord)}
                    onDeleteOrder={(ord) => setOrderToDelete(ord)}
                    clientState={clientState}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* FILES STORAGE TAB */}
        {activeTab === "FILES" && <FileManagementView user={user} />}

        {/* PRICING RATES TAB */}
        {activeTab === "PRICING" && (
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-5 sm:p-6 transition-colors duration-200">
            <PricingSettings />
          </div>
        )}

        {/* SHOP QR CODE TAB */}
        {activeTab === "QR" && (
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-5 sm:p-6 transition-colors duration-200">
            <QRCodePage user={user} />
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "SETTINGS" && (
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] p-5 sm:p-6 transition-colors duration-200">
            <SettingsView user={user} />
          </div>
        )}
      </main>
      </div>

      {/* Desktop Software Order Workspace */}
      {selectedOrder && (
        <OrderDetailModal
          order={orders.find((o) => o.id === selectedOrder.id) || selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={handleUpdateStatus}
          onUpdatePaymentStatus={handleUpdatePaymentStatus}
          onPrintOrder={handlePrintOrderDirect}
          onDeleteFiles={(ord) => setFileCleanupOrder(ord)}
          onDeleteOrder={(ord) => setOrderToDelete(ord)}
          onEditItem={(item) => {
            if (!item?.id) return;
            window.location.hash = `#/studio/${selectedOrder.id}/${item.id}`;
          }}
          onOrderChanged={(updated) => {
            if (!updated?.id) return;
            setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
            ordersRef.current = ordersRef.current.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
            setSelectedOrder((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
          }}
          clientState={clientState}
        />
      )}

      {/* Permanent Order Delete Confirmation Modal */}
      {orderToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-2xl w-full max-w-md p-6 space-y-4 text-[var(--text-primary)] animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <MaterialIcon name="delete" size={20} className="text-[var(--color-error-text)] shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  {orderToDelete.printStatus === "COMPLETED"
                    ? "Delete completed order?"
                    : orderToDelete.printStatus === "CANCELLED" || orderToDelete.printStatus === "DECLINED"
                      ? "Delete cancelled order?"
                      : "Delete failed order?"}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Order #{orderToDelete.orderNumber} • {orderToDelete.customerName || "Walk-in Customer"}
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {orderToDelete.printStatus === "COMPLETED"
                ? "This will permanently remove this order from order history."
                : orderToDelete.printStatus === "CANCELLED" || orderToDelete.printStatus === "DECLINED"
                  ? "This will permanently remove this cancelled order from the system."
                  : "This will permanently remove this failed order from the system."}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOrderToDelete(null)}
                disabled={isDeletingOrder}
                className="btn-secondary-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrder}
                disabled={isDeletingOrder}
                className="btn-danger-sm cursor-pointer"
              >
                {isDeletingOrder ? (
                  <>
                    <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
                    <span>Deleting Order...</span>
                  </>
                ) : (
                  <>
                    <MaterialIcon name="delete" size={14} />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Cleanup Confirmation Modal */}
      {fileCleanupOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-2xl w-full max-w-md p-6 space-y-4 text-[var(--text-primary)] animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <MaterialIcon name="delete" size={20} className="text-[var(--color-error-text)] shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Delete uploaded files?
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Order #{fileCleanupOrder.orderNumber} • {fileCleanupOrder.customerName || "Walk-in Customer"}
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              This will permanently remove the uploaded files associated with this completed order to free shop storage.
              <br />
              <strong className="text-[var(--text-primary)] font-semibold mt-1 block">
                The order record, customer details, page count, and revenue history will remain safely preserved.
              </strong>
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFileCleanupOrder(null)}
                disabled={isDeletingFiles}
                className="btn-secondary-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFiles}
                disabled={isDeletingFiles}
                className="btn-danger-sm cursor-pointer"
              >
                {isDeletingFiles ? (
                  <>
                    <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
                    <span>Deleting Files...</span>
                  </>
                ) : (
                  <>
                    <MaterialIcon name="delete" size={14} />
                    <span>Delete Files</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Printable Modal */}
      {showQRModal && (
        <QRCodeModal
          shopName={user?.shopName || ""}
          shopSlug={user?.shopSlug || ""}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </div>
  );
};


