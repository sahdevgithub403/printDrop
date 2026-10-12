import { assertServerRuntime } from "./serverOnly.js";

// Realtime publish hook. Legacy WebSocketService.sendOrderUpdate delivers
// {type, order} to /topic/admin/shop/{shopId}/orders AFTER the surrounding
// transaction commits (afterCommit), so subscribers never observe phantom
// rows. Route handlers call publishEvent only after all writes succeed,
// which is the same ordering. Delivery to the standalone broker is an
// HTTP POST; a failed publish logs a warning and never fails the API
// request (documented infra difference vs the in-process broker).

export interface OrderEvent {
  type:
    | "NEW_PRINT_REQUEST"
    | "ORDER_STATUS_UPDATED"
    | "ORDER_ITEM_STATUS_UPDATED"
    | "PAYMENT_STATUS_UPDATED";
  order: unknown;
}

export interface RealtimeConfig {
  internalUrl: string;
  secret: string;
}

export function readRealtimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RealtimeConfig | null {
  const internalUrl = (env["REALTIME_INTERNAL_URL"] ?? "").trim();
  const secret = (env["REALTIME_SECRET"] ?? "").trim();
  if (!internalUrl || !secret) {
    return null;
  }
  return { internalUrl, secret };
}

export async function publishEvent(
  config: RealtimeConfig | null,
  shopId: string,
  event: OrderEvent
): Promise<void> {
  assertServerRuntime("publishEvent");
  if (config == null) {
    return;
  }
  try {
    const res = await fetch(
      `${config.internalUrl.replace(/\/$/, "")}/publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": config.secret,
        },
        body: JSON.stringify({ shopId, event }),
      }
    );
    if (!res.ok) {
      console.warn(
        `publishEvent: broker rejected event for shop ${shopId} (status ${res.status})`
      );
    }
  } catch (err) {
    console.warn(
      `publishEvent: broker unreachable for shop ${shopId}: ${
        (err as Error).message
      }`
    );
  }
}
