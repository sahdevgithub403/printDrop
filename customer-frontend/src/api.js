import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const getShopBySlug = async (slug, options = {}) => {
  const response = await api.get(`/public/shops/${slug}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return response.data.data;
};

export const uploadDocument = async (file, options = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/public/documents/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return response.data.data;
};

export const calculatePrice = async (payload) => {
  const response = await api.post("/public/pricing/calculate", payload);
  return response.data.data;
};

export const createOrder = async (payload, idempotencyKey) => {
  const response = await api.post("/public/orders", payload, {
    ...(idempotencyKey
      ? { headers: { "Idempotency-Key": idempotencyKey } }
      : {}),
  });
  return response.data.data;
};

export const getOrderByToken = async (token) => {
  const response = await api.get(`/public/orders/${token}`);
  return response.data.data;
};

export const getOrderStatus = getOrderByToken;

export const createPayment = async (orderId, paymentMethod) => {
  const response = await api.post("/public/payments/create", {
    orderId,
    paymentMethod,
  });
  return response.data.data;
};

export const verifyPayment = async (payload) => {
  const response = await api.post("/public/payments/verify", payload);
  return response.data.data;
};

export const cancelPayment = async (orderId) => {
  const response = await api.post("/public/payments/cancel", { orderId });
  return response.data.data;
};
