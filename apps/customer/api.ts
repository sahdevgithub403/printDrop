import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

export const getShopBySlug = async (
  slug: string,
  options: { signal?: AbortSignal } = {},
) => {
  const response = await api.get(`/public/shops/${slug}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return response.data.data;
};

export const uploadDocument = async (
  file: File | Blob,
  options: { signal?: AbortSignal } = {},
) => {
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

export const calculatePrice = async (payload: any) => {
  const response = await api.post("/public/pricing/calculate", payload);
  return response.data.data;
};

export const createOrder = async (payload: any, idempotencyKey?: string) => {
  const response = await api.post("/public/orders", payload, {
    ...(idempotencyKey
      ? { headers: { "Idempotency-Key": idempotencyKey } }
      : {}),
  });
  return response.data.data;
};

export const getOrderByToken = async (token: string) => {
  const response = await api.get(`/public/orders/${token}`);
  return response.data.data;
};

export const getOrderStatus = getOrderByToken;

export const createPayment = async (orderId: string, paymentMethod: string) => {
  const response = await api.post("/public/payments/create", {
    orderId,
    paymentMethod,
  });
  return response.data.data;
};

export const verifyPayment = async (payload: any) => {
  const response = await api.post("/public/payments/verify", payload);
  return response.data.data;
};

export const cancelPayment = async (orderId: string) => {
  const response = await api.post("/public/payments/cancel", { orderId });
  return response.data.data;
};
