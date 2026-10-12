import { assertServerRuntime } from "./serverOnly.js";
import type { RazorpayGateway } from "./orders.js";

// Razorpay gateway seam. Production uses the official razorpay SDK
// (orders.create with INR paise + receipt=orderNumber); test mode mints
// offline order_test_* ids (no network, verification still HMAC-checks);
// dummy keys fail closed (503) outside test mode. Mirrors
// OrderService.createOrder (C-02) + PaymentService.requireRealRazorpayKeys.

export interface LiveRazorpayConfig {
  keyId: string;
  keySecret: string;
  testMode: boolean;
}

export function readRazorpayConfig(
  env: NodeJS.ProcessEnv = process.env
): LiveRazorpayConfig {
  return {
    keyId: (env["RAZORPAY_KEY_ID"] ?? "").trim(),
    keySecret: (env["RAZORPAY_KEY_SECRET"] ?? "").trim(),
    testMode: (env["RAZORPAY_TEST_MODE"] ?? "").trim() === "true",
  };
}

export function isDummyRazorpayKeys(keyId: string, keySecret: string): boolean {
  return (
    keyId.length === 0 ||
    keySecret.length === 0 ||
    keyId.startsWith("rzp_test_dummy") ||
    keySecret === "dummy_secret"
  );
}

export function liveRazorpayGateway(config: LiveRazorpayConfig): RazorpayGateway {
  return {
    isDummy: () => isDummyRazorpayKeys(config.keyId, config.keySecret),
    isTestMode: () => config.testMode,
    async createOrder(amountPaise: number, receipt: string): Promise<string> {
      assertServerRuntime("razorpay.createOrder");
      const Razorpay = (await import("razorpay")).default;
      const client = new Razorpay({
        key_id: config.keyId,
        key_secret: config.keySecret,
      });
      const created = await client.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt,
      });
      if (created == null || typeof created.id !== "string") {
        throw new Error("Razorpay order creation returned no id");
      }
      return created.id;
    },
  };
}
