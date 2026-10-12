import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  makeShopWithOwner,
  uploadPdf,
  json,
  post,
  cleanupAll,
} from "./helpers.js";
import { POST as createOrder } from "../app/api/public/orders/route.js";
import { startRealtimeService } from "@printdrop/realtime";

// STOMP broker protocol tests (isolated test DB + ephemeral broker on
// port 18086). Verifies CONNECT auth, tenant isolation, publish fan-out,
// and the HTTP publish guard — the exact WebSocketConfig contract.

const PORT = 18086;
const SECRET = "test-internal-realtime-secret";
let server: { close: (cb?: () => void) => void } | null = null;

class StompSocket {
  private ws: WebSocket;
  private queue: string[] = [];
  private waiters: Array<(frame: string) => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    let buffer = "";
    this.ws.on("message", (data: Buffer) => {
      buffer += data.toString("utf8");
      let idx = buffer.indexOf("\0");
      while (idx >= 0) {
        const raw = buffer.slice(0, idx + 1);
        buffer = buffer.slice(idx + 1);
        if (raw.trim().length > 0) {
          const next = this.waiters.shift();
          if (next) {
            next(raw);
          } else {
            this.queue.push(raw);
          }
        }
        idx = buffer.indexOf("\0");
      }
    });
  }

  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (e) => reject(e));
    });
  }

  send(command: string, headers: Record<string, string>, body = ""): void {
    let out = `${command}\n`;
    for (const [k, v] of Object.entries(headers)) {
      out += `${k}:${v}\n`;
    }
    this.ws.send(`${out}\n${body}\0`);
  }

  async next(timeoutMs = 5000): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return queued;
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("frame timeout")), timeoutMs);
      this.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function parseCommand(frame: string): string {
  return frame.split("\n")[0]!.replace(/\r$/, "");
}

beforeAll(() => {
  process.env["REALTIME_INTERNAL_URL"] = `http://localhost:${PORT}`;
  process.env["REALTIME_SECRET"] = SECRET;
  const started = startRealtimeService(PORT);
  server = started.server;
});

afterAll(async () => {
  delete process.env["REALTIME_INTERNAL_URL"];
  delete process.env["REALTIME_SECRET"];
  await cleanupAll();
  await new Promise<void>((resolve) => {
    if (server == null) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
  server = null;
});

describe("STOMP broker (WebSocketConfig contract)", () => {
  it("authenticates CONNECT, subscribes own shop, and fans out orders", async () => {
    const { token, shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 1);

    const sock = new StompSocket(`ws://localhost:${PORT}/ws-admin`);
    await sock.open();
    sock.send(
      "CONNECT",
      { Authorization: `Bearer ${token}`, "heart-beat": "10000,10000" }
    );
    const connected = parseCommand(await sock.next());
    expect(connected).toBe("CONNECTED");

    const topic = `/topic/admin/shop/${shopId}/orders`;
    sock.send("SUBSCRIBE", { id: "sub-0", destination: topic });
    // No receipt requested; give the broker a beat, then create an order.
    await new Promise((r) => setTimeout(r, 200));

    const created = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        items: [
          { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
        ],
      })
    );
    expect(created.status).toBe(200);

    const message = await sock.next(8000);
    expect(parseCommand(message)).toBe("MESSAGE");
    expect(message).toContain("NEW_PRINT_REQUEST");
    expect(message).toContain(created.body.data.orderNumber);
    sock.close();
  });

  it("rejects bad credentials and cross-shop subscriptions", async () => {
    const { shopId } = await makeShopWithOwner();

    const bad = new StompSocket(`ws://localhost:${PORT}/ws-admin`);
    await bad.open();
    bad.send("CONNECT", { Authorization: "Bearer invalid.token.here" });
    expect(parseCommand(await bad.next())).toBe("ERROR");
    bad.close();

    const { token } = await makeShopWithOwner();
    const sock = new StompSocket(`ws://localhost:${PORT}/ws-admin`);
    await sock.open();
    sock.send("CONNECT", { Authorization: `Bearer ${token}` });
    expect(parseCommand(await sock.next())).toBe("CONNECTED");
    sock.send("SUBSCRIBE", {
      id: "sub-x",
      destination: `/topic/admin/shop/${shopId}/orders`,
    });
    expect(parseCommand(await sock.next())).toBe("ERROR");
    sock.close();
  });

  it("guards the HTTP publish endpoint", async () => {
    const forbidden = await fetch(`http://localhost:${PORT}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopId: "x", event: {} }),
    });
    expect(forbidden.status).toBe(403);
    const health = await fetch(`http://localhost:${PORT}/health`);
    expect(health.status).toBe(200);
  });
});
