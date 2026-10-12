import {
  readRazorpayConfig,
  type PaymentContext,
} from "@printdrop/domain";
import { prismaPaymentStore } from "./paymentStore.js";

// Shared payment context (keys/test-mode from server env only).
export function paymentContext(): PaymentContext {
  const razorpay = readRazorpayConfig();
  return {
    store: prismaPaymentStore,
    razorpayKeyId: razorpay.keyId,
    razorpayKeySecret: razorpay.keySecret,
    razorpayWebhookSecret:
      process.env["RAZORPAY_WEBHOOK_SECRET"]?.trim() ?? "",
    testMode: razorpay.testMode,
  };
}
