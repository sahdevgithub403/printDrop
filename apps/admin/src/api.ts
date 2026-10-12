"use client";
import axios from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "") + "/api"
    : "/api");

const getBrowserDeviceId = () => {
  const KEY = "printalfa_browser_device_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : null) ||
        `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "browser-session-dev";
  }
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(async (config) => {
  // Interceptors only fire for requests issued from effects/handlers
  // (client-side), but every browser-global access is still guarded so a
  // server prerender can never throw here.
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("admin_jwt_token") : null;
  if (token && token !== "undefined") {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Add device headers for session management
  const electronAPI = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (electronAPI && electronAPI.getDeviceId) {
    config.headers["X-Device-ID"] = await electronAPI.getDeviceId?.();
    config.headers["X-Device-Name"] = await electronAPI.getDeviceName?.();
    config.headers["X-App-Version"] = await electronAPI.getAppVersion?.();
  } else {
    config.headers["X-Device-ID"] = getBrowserDeviceId();
    config.headers["X-Device-Name"] = "Browser (Dev)";
    config.headers["X-App-Version"] = "1.0.0-dev";
  }
  
  return config;
});

let isRedirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || "";
      const isAuthEndpoint = url.includes("/auth/");
      if (!isAuthEndpoint && !isRedirectingToLogin) {
        isRedirectingToLogin = true;
        try {
          localStorage.removeItem("admin_jwt_token");
          localStorage.removeItem("admin_user_data");
        } catch {}
        // Single-flight redirect to login; guard avoids loops when token is already gone.
        window.location.reload();
      }
    }

    return Promise.reject(error);
  },
);

export const loginAdmin = async (email, password) => {
  const response = await api.post("/auth/login", { email, password });
  return response.data.data;
};

export const signupAdmin = async (name, phone, email, password, confirmPassword) => {
  const response = await api.post("/auth/signup", { name, phone, email, password, confirmPassword });
  return response.data.data;
};

export const forgotPassword = async (email) => {
  const response = await api.post("/auth/forgot-password", { email });
  return response.data.data;
};

export const resetPassword = async (token, newPassword) => {
  const response = await api.post("/auth/reset-password", { token, newPassword });
  return response.data.data;
};

export const getShopProfile = async () => {
  const response = await api.get("/admin/shop");
  return response.data.data;
};

export const createShop = async (shopData) => {
  const response = await api.post("/admin/shop/create", shopData);
  return response.data.data;
};

export const updateShopProfile = async (shopData) => {
  const response = await api.put("/admin/shop", shopData);
  return response.data.data;
};

export const sendHeartbeat = async () => {
  const response = await api.post("/print-agent/heartbeat");
  return response.data.data;
};

export const getAdminOrders = async (status?: any) => {
  const params = status ? { status } : {};
  const response = await api.get("/admin/orders", { params });
  return response.data.data;
};

export const getAdminOrder = async (orderId) => {
  const response = await api.get(`/admin/orders/${orderId}`);
  return response.data.data;
};

/* ---------- Document Studio ---------- */

// Raw authorized bytes (Blob). Unlike downloadDocumentFile this never
// triggers a save dialog — used to load the source into the editor.
export const fetchDocumentBytes = async (documentId) => {
  const response = await api.get(`/admin/documents/${documentId}/download`, {
    responseType: "blob",
  });
  return response.data;
};

export const uploadEditedCopy = async (file, sourceDocumentId) => {
  const form = new FormData();
  form.append("file", file);
  if (sourceDocumentId) form.append("sourceDocumentId", sourceDocumentId);
  const response = await api.post("/admin/documents/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};

export const swapItemDocument = async (orderId, itemId, documentId) => {
  const response = await api.patch(`/admin/orders/${orderId}/items/${itemId}/document`, {
    documentId,
  });
  return response.data.data;
};

export const getItemDocumentVersions = async (orderId, itemId) => {
  const response = await api.get(`/admin/orders/${orderId}/items/${itemId}/versions`);
  return response.data.data;
};

export const updateOrderPrintStatus = async (orderId, printStatus) => {
  const response = await api.patch(`/admin/orders/${orderId}/status`, {
    printStatus,
  });
  return response.data.data;
};

export const updateItemPrintStatus = async (orderId, itemId, printStatus) => {
  const response = await api.patch(
    `/admin/orders/${orderId}/items/${itemId}/status`,
    { printStatus },
  );
  return response.data.data;
};

export const updateOrderPaymentStatus = async (orderId, paymentStatus) => {
  const response = await api.patch(`/admin/orders/${orderId}/payment-status`, {
    paymentStatus,
  });
  return response.data.data;
};

export const getShopPricing = async () => {
  const response = await api.get("/admin/pricing");
  return response.data.data;
};

export const updateShopPricing = async (pricingData) => {
  const response = await api.put("/admin/pricing", pricingData);
  return response.data.data;
};

export const getShopQRData = async () => {
  const response = await api.get("/admin/shop/qr");
  return response.data.data;
};

export const downloadDocumentFile = async (documentId, originalFileName) => {
  const response = await api.get(`/admin/documents/${documentId}/download`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", originalFileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const getDocumentPreviewUrl = async (documentId, contentType) => {
  const response = await api.get(`/admin/documents/${documentId}/download`, {
    responseType: "blob",
  });
  return window.URL.createObjectURL(
    new Blob([response.data], { type: contentType }),
  );
};

export const getAdminDocuments = async ({ search = "", type = "ALL", sort = "NEWEST", page = 0, size = 25 } = {}) => {
  const response = await api.get("/admin/documents", {
    params: { search, type, sort, page, size },
  });
  return response.data.data;
};

export const deleteAdminDocument = async (documentId) => {
  const response = await api.delete(`/admin/documents/${documentId}`);
  return response.data;
};

export const deleteAdminDocumentsBulk = async (documentIds) => {
  const response = await api.delete("/admin/documents/bulk", {
    data: { documentIds },
  });
  return response.data.data;
};

export const deleteAllAdminDocuments = async () => {
  const response = await api.delete("/admin/documents/all");
  return response.data.data;
};

export const deleteAdminOrder = async (orderId, confirm = false) => {
  const response = await api.delete(`/admin/orders/${orderId}`, {
    params: { confirm },
  });
  return response.data;
};
