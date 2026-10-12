import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// Download-redirect compatibility evidence (Phase 2B.4 issue 3).
// The R2 download flow authorizes in the Route Handler, then answers 307
// to a 5-minute presigned URL on a DIFFERENT host. This test replicates
// exactly that shape with a local stub: /start is fetched on 127.0.0.1
// and 307-redirects to /final on localhost (different origins, same as
// API-origin -> R2-host). It proves fetch delivers the final bytes,
// content type, and disposition, and that the user Authorization header
// is NOT forwarded cross-origin (verified behavior, not assumption).
// Admin (axios/XHR blob) and Electron print-agent (axios arraybuffer)
// follow redirects natively and consume only final bytes/headers.

const FINAL_BYTES = new TextEncoder().encode("%PDF-1.4 fake-bytes");
const DISPOSITION = 'attachment; filename="src.pdf"; filename*=UTF-8\'\'src.pdf';

let server: Server;
let startBase = "";
let finalBase = "";
let seenAtFinal: { authorization: string | null } = { authorization: null };

function start(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/start") {
        res.writeHead(307, { Location: `${finalBase}/final` });
        res.end();
        return;
      }
      if (req.url === "/final") {
        seenAtFinal = { authorization: req.headers["authorization"] ?? null };
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": DISPOSITION,
        });
        res.end(FINAL_BYTES);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    // Dual-stack bind so both 127.0.0.1 and localhost reach one server.
    server.listen(0, "::", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      startBase = `http://127.0.0.1:${port}`;
      finalBase = `http://localhost:${port}`;
      resolve();
    });
  });
}

beforeAll(start);
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    })
);

describe("307 presigned-redirect download compatibility", () => {
  it("delivers final bytes, type, and disposition like a direct response", async () => {
    const res = await fetch(`${startBase}/start`, {
      headers: { Authorization: "Bearer secret-test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(DISPOSITION);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(FINAL_BYTES)
    );
  });

  it("does not leak the Authorization header to the redirect host", async () => {
    await fetch(`${startBase}/start`, {
      headers: { Authorization: "Bearer secret-test-token" },
    });
    expect(seenAtFinal.authorization).toBeNull();
  });

  it("blob() consumption matches the admin client's usage", async () => {
    const res = await fetch(`${startBase}/start`);
    const blob = await res.blob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(FINAL_BYTES.length);
  });
});
