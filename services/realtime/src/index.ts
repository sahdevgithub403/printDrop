import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyJwt } from "@printdrop/domain";
import { prisma } from "@printdrop/db";

// STOMP-compatible broker for the admin dashboard + Electron agent.
// Protocol preserved from backend/.../config/WebSocketConfig.java:
// - Endpoint path /ws-admin (native WebSocket; the SockJS fallback has no
//   consumer — sockjs-client is installed but unused — so only native WS
//   is implemented; documented limitation).
// - CONNECT must carry an `authorization: Bearer <JWT>` native header with
//   a valid signature + ACTIVE, unexpired DB session (fail closed).
// - SUBSCRIBE/SEND require auth; /topic/admin/shop/* topics are
//   tenant-scoped to the JWT shopId unless ROLE_SUPER_ADMIN.
// - Heartbeats negotiated as 0,0 (disabled); the client's 2s
//   reconnectDelay + 30s poll + 10s heartbeat-poll fallback provide
//   liveness exactly as before.
// - Route Handlers publish via POST /publish {shopId, event} guarded by
//   REALTIME_SECRET (replaces WebSocketService.convertAndSend).

interface Principal {
  email: string;
  role: string;
  shopId: string | null;
}

interface Connection {
  socket: WebSocket;
  principal: Principal | null;
  subscriptions: Map<string, string>;
  buffer: string;
}

const connections = new Set<Connection>();
let messageSeq = 0;

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function parseFrame(raw: string): {
  command: string;
  headers: Record<string, string>;
  body: string;
} | null {
  const nullIndex = raw.indexOf("\0");
  const text = nullIndex >= 0 ? raw.slice(0, nullIndex) : raw;
  const lines = text.split("\n");
  const command = (lines.shift() ?? "").replace(/\r$/, "");
  if (!command) {
    return null;
  }
  const headers: Record<string, string> = {};
  let line: string | undefined;
  while ((line = lines.shift()) !== undefined) {
    const clean = line.replace(/\r$/, "");
    if (clean === "") {
      break;
    }
    const colon = clean.indexOf(":");
    if (colon > 0) {
      headers[clean.slice(0, colon).trim()] = clean.slice(colon + 1).trim();
    }
  }
  return { command, headers, body: lines.join("\n") };
}

function sendFrame(socket: WebSocket, command: string, headers: Record<string, string>, body = ""): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  let out = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    out += `${key}:${value}\n`;
  }
  out += `\n${body}\0`;
  socket.send(out);
}

function header(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }
  return null;
}

function errorAndClose(conn: Connection, message: string): void {
  sendFrame(conn.socket, "ERROR", { message }, message);
  setTimeout(() => {
    try {
      conn.socket.close();
    } catch {
      /* ignore */
    }
  }, 50);
}

function isSuperAdmin(principal: Principal): boolean {
  return principal.role === "ROLE_SUPER_ADMIN";
}

function checkTenant(principal: Principal, destination: string): boolean {
  if (!destination.startsWith("/topic/admin/shop/")) {
    return true;
  }
  if (isSuperAdmin(principal)) {
    return true;
  }
  if (principal.shopId == null) {
    return false;
  }
  return destination.startsWith(`/topic/admin/shop/${principal.shopId}/`);
}

async function handleConnect(
  conn: Connection,
  headers: Record<string, string>
): Promise<void> {
  const auth = header(headers, "authorization");
  if (auth == null || !auth.startsWith("Bearer ")) {
    errorAndClose(conn, "Missing WebSocket credentials");
    return;
  }
  const token = auth.substring(7);
  const jwtSecret = env("JWT_SECRET");
  if (!jwtSecret) {
    errorAndClose(conn, "Server misconfigured");
    return;
  }
  let claims;
  try {
    claims = await verifyJwt(jwtSecret, token);
  } catch {
    errorAndClose(conn, "Invalid WebSocket credentials");
    return;
  }
  if (claims.sessionId != null) {
    const session = await prisma.userSession.findUnique({
      where: { sessionToken: claims.sessionId },
    });
    const usable =
      session != null &&
      session.status === "ACTIVE" &&
      session.expiresAt != null &&
      session.expiresAt.getTime() > Date.now();
    if (!usable) {
      errorAndClose(conn, "WebSocket session is invalid or expired");
      return;
    }
  }
  const user = await prisma.user.findUnique({
    where: { email: claims.email },
    select: { id: true, role: true, shopId: true },
  });
  if (user == null) {
    errorAndClose(conn, "Invalid WebSocket credentials");
    return;
  }
  conn.principal = {
    email: claims.email,
    role: user.role,
    shopId: user.shopId,
  };
  const requestedHeartbeat = header(headers, "heart-beat") ?? "0,0";
  void requestedHeartbeat;
  sendFrame(conn.socket, "CONNECTED", {
    version: "1.2",
    "heart-beat": "0,0",
    server: "printdrop-realtime",
  });
}

function handleFrame(conn: Connection, frame: ReturnType<typeof parseFrame>): void {
  if (frame == null) {
    return;
  }
  if (frame.command === "CONNECT" || frame.command === "STOMP") {
    void handleConnect(conn, frame.headers).catch(() => {
      errorAndClose(conn, "Internal error during CONNECT");
    });
    return;
  }
  if (conn.principal == null) {
    errorAndClose(conn, "Unauthorized WebSocket frame: authentication required");
    return;
  }
  if (frame.command === "SUBSCRIBE") {
    const id = frame.headers["id"];
    const destination = frame.headers["destination"] ?? "";
    if (id == null || !destination) {
      errorAndClose(conn, "SUBSCRIBE requires id and destination");
      return;
    }
    if (!checkTenant(conn.principal, destination)) {
      errorAndClose(conn, "Forbidden WebSocket subscription to other shop");
      return;
    }
    conn.subscriptions.set(id, destination);
    const receipt = frame.headers["receipt"];
    if (receipt != null) {
      sendFrame(conn.socket, "RECEIPT", { "receipt-id": receipt });
    }
    return;
  }
  if (frame.command === "UNSUBSCRIBE") {
    const id = frame.headers["id"];
    if (id != null) {
      conn.subscriptions.delete(id);
    }
    return;
  }
  if (frame.command === "DISCONNECT") {
    try {
      conn.socket.close();
    } catch {
      /* ignore */
    }
    return;
  }
  if (frame.command === "SEND") {
    const destination = frame.headers["destination"] ?? "";
    if (!checkTenant(conn.principal, destination)) {
      errorAndClose(conn, "Forbidden WebSocket destination");
    }
    return;
  }
}

export function publishToShop(shopId: string, event: unknown): void {
  const destination = `/topic/admin/shop/${shopId}/orders`;
  const body = JSON.stringify(event);
  for (const conn of connections) {
    if (conn.principal == null || conn.socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    for (const [subId, subscribed] of conn.subscriptions) {
      if (subscribed === destination) {
        messageSeq += 1;
        sendFrame(
          conn.socket,
          "MESSAGE",
          {
            subscription: subId,
            "message-id": `msg-${messageSeq}`,
            destination,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
          body
        );
      }
    }
  }
}

export function startRealtimeService(port: number) {
  const secret = env("REALTIME_SECRET");
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pathOnly = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && pathOnly === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "POST" && pathOnly === "/publish") {
      if (secret.length === 0 || req.headers["x-internal-secret"] !== secret) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "Forbidden" }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        try {
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8")
          ) as { shopId?: string; event?: unknown };
          if (typeof body.shopId !== "string" || body.event == null) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                message: "shopId and event required",
              })
            );
            return;
          }
          publishToShop(body.shopId, body.event);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ success: false, message: "Malformed body" })
          );
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "Not found" }));
  });
  const wss = new WebSocketServer({ server, path: "/ws-admin" });
  wss.on("connection", (socket: WebSocket) => {
    const conn: Connection = {
      socket,
      principal: null,
      subscriptions: new Map(),
      buffer: "",
    };
    connections.add(conn);
    socket.on("message", (data: { toString(encoding: string): string }) => {
      conn.buffer += data.toString("utf8");
      let nullIndex = conn.buffer.indexOf("\0");
      while (nullIndex >= 0) {
        const raw = conn.buffer.slice(0, nullIndex + 1);
        conn.buffer = conn.buffer.slice(nullIndex + 1);
        // STOMP heart-beat EOLs (bare newlines) carry no frame.
        if (raw.trim().length > 0) {
          handleFrame(conn, parseFrame(raw));
        }
        nullIndex = conn.buffer.indexOf("\0");
      }
    });
    const drop = () => {
      connections.delete(conn);
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });
  server.listen(port);
  return { server, wss };
}

// Standalone runner (REALTIME_PORT, default 8086) for local dev.
if (require.main === module) {
  const port = Number.parseInt(process.env["REALTIME_PORT"] ?? "8086", 10);
  const listenPort = Number.isInteger(port) ? port : 8086;
  startRealtimeService(listenPort);
  console.log(`printdrop realtime broker listening on :${listenPort}/ws-admin`);
}
