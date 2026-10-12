import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@printdrop/db";
import { verifyJwt } from "@printdrop/domain";
import { POST as login } from "../app/api/auth/login/route.js";
import { POST as signup } from "../app/api/auth/signup/route.js";
import { POST as forgotPassword } from "../app/api/auth/forgot-password/route.js";
import { POST as resetPassword } from "../app/api/auth/reset-password/route.js";
import { testResetOutbox } from "../lib/authRoutes.js";

// Phase 2B.2 integration tests — auth endpoints against the ISOLATED test
// database only (printdrop_dev on localhost:5434, verified empty before
// test setup). DATABASE_URL/JWT_SECRET come from the test process env
// (test-only values, never committed). Test-only accounts per test with
// DB cleanup after each case. No production contact of any kind.

const JWT_SECRET = process.env["JWT_SECRET"] ?? "";
import { randomUUID } from "node:crypto";

const uniq = () => randomUUID().slice(0, 8);
const testEmail = (tag: string) => `phase22-${tag}-${uniq()}@example.com`;

function req(
  path: string,
  body: unknown,
  headers?: Record<string, string>
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

async function post(
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
  headers?: Record<string, string>
) {
  const res = await handler(req(path, body, headers));
  return { status: res.status, json: (await res.json()) as any };
}

async function cleanupUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user == null) {
    return;
  }
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.userSession.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

const created: string[] = [];

beforeEach(() => {
  delete process.env["MAIL_ENABLED"];
  testResetOutbox.length = 0;
});

afterEach(async () => {
  delete process.env["MAIL_ENABLED"];
  testResetOutbox.length = 0;
  for (const email of created.splice(0)) {
    await cleanupUser(email);
  }
});

describe("POST /api/auth/signup (AuthController.signup)", () => {
  it("creates a SHOP_ADMIN, auto-logs in, and stores an ACTIVE session", async () => {
    const email = testEmail("signup");
    created.push(email);
    const { status, json } = await post(signup, "/api/auth/signup", {
      name: "Test Owner",
      email,
      phone: "9999999999",
      password: "password-123",
      confirmPassword: "password-123",
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Signup successful");
    expect(json.data.email).toBe(email);
    expect(json.data.role).toBe("ROLE_SHOP_ADMIN");
    expect(json.data.shopId).toBeNull();
    expect(json.data.shopSetupComplete).toBe(false);
    expect(json.data.apiKey).toBeNull();
    expect(json.data.name).toBe("Test Owner");
    expect(typeof json.timestamp).toBe("string");

    const claims = await verifyJwt(JWT_SECRET, json.data.token);
    expect(claims.email).toBe(email);
    expect(claims.sessionId).not.toBeNull();
    const session = await prisma.userSession.findUnique({
      where: { sessionToken: claims.sessionId! },
    });
    expect(session?.status).toBe("ACTIVE");
    expect(session?.deviceId).toBe("UNKNOWN");
  });

  it("rejects duplicates and validation failures with legacy messages", async () => {
    const email = testEmail("dup");
    created.push(email);
    const good = {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    };
    expect((await post(signup, "/api/auth/signup", good)).status).toBe(200);
    const dup = await post(signup, "/api/auth/signup", good);
    expect(dup.status).toBe(400);
    expect(dup.json).toMatchObject({
      success: false,
      message: "Email already in use",
      data: null,
    });
    const base = { name: "N", phone: "1", password: "password-123", confirmPassword: "password-123" };
    const cases: Array<[object, string]> = [
      [{ ...base, email: testEmail("x"), name: "" }, "Name is required"],
      [{ ...base, email: "bad" }, "Invalid email format"],
      [{ ...base, email: testEmail("x"), password: "short", confirmPassword: "short" }, "Password must be at least 8 characters"],
      [{ ...base, email: testEmail("x"), confirmPassword: "other-1234" }, "Passwords do not match"],
      [{ ...base, email: testEmail("x"), phone: "" }, "Phone number is required"],
    ];
    for (const [body, message] of cases) {
      const r = await post(signup, "/api/auth/signup", body);
      expect(r.status).toBe(400);
      expect(r.json.message).toBe(message);
    }
  });
});

describe("POST /api/auth/login (AuthController.login)", () => {
  it("logs in, records device headers, and revokes prior sessions", async () => {
    const email = testEmail("login");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    const first = await post(login, "/api/auth/login", {
      email,
      password: "password-123",
    });
    expect(first.status).toBe(200);
    expect(first.json.message).toBe("Login successful");

    const second = await post(
      login,
      "/api/auth/login",
      { email, password: "password-123" },
      { "X-Device-ID": "dev-1", "X-Device-Name": "PC", "X-App-Version": "2.0" }
    );
    expect(second.status).toBe(200);
    const claims = await verifyJwt(JWT_SECRET, second.json.data.token);
    const current = await prisma.userSession.findUnique({
      where: { sessionToken: claims.sessionId! },
    });
    expect(current?.deviceId).toBe("dev-1");
    expect(current?.status).toBe("ACTIVE");
    const firstClaims = await verifyJwt(JWT_SECRET, first.json.data.token);
    const old = await prisma.userSession.findUnique({
      where: { sessionToken: firstClaims.sessionId! },
    });
    expect(old?.status).toBe("REVOKED");
    expect(old?.revokedReason).toBe("NEW_LOGIN");
  });

  it("returns identical 401 for wrong password and unknown email", async () => {
    const email = testEmail("bad");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    for (const body of [
      { email, password: "wrong-pass-1" },
      { email: testEmail("ghost"), password: "whatever-12" },
    ]) {
      const r = await post(login, "/api/auth/login", body);
      expect(r.status).toBe(401);
      expect(r.json).toMatchObject({
        success: false,
        message: "Invalid email or password credentials",
        data: null,
      });
    }
  });

  it("validates input and throttles at 6 attempts (429)", async () => {
    const email = testEmail("throttle");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    expect(
      (await post(login, "/api/auth/login", { email: "", password: "x" })).json
        .message
    ).toBe("Email is required");
    expect(
      (await post(login, "/api/auth/login", { email: "bad", password: "x" }))
        .json.message
    ).toBe("Invalid email format");
    expect(
      (
        await post(login, "/api/auth/login", {
          email: testEmail("v"),
          password: "",
        })
      ).json.message
    ).toBe("Password is required");

    const t = testEmail("t6");
    created.push(t);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email: t,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    for (let i = 0; i < 5; i++) {
      const r = await post(login, "/api/auth/login", {
        email: t,
        password: "wrong-pass-1",
      });
      expect(r.status).toBe(401);
    }
    const limited = await post(login, "/api/auth/login", {
      email: t,
      password: "wrong-pass-1",
    });
    expect(limited.status).toBe(429);
    expect(limited.json.message).toMatch(/Too many login attempts/);
  });
});

describe("forgot/reset-password (AuthController)", () => {
  it("returns generic success for unknown emails; 400 when missing", async () => {
    const r = await post(forgotPassword, "/api/auth/forgot-password", {
      email: testEmail("nobody"),
    });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe(
      "If an account exists with this email, a reset link has been sent."
    );
    const bad = await post(forgotPassword, "/api/auth/forgot-password", {
      email: "  ",
    });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Email is required");
  });

  it("fails 503 with mail disabled and persists no token row", async () => {
    const email = testEmail("mailoff");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    const r = await post(forgotPassword, "/api/auth/forgot-password", {
      email,
    });
    expect(r.status).toBe(503);
    expect(r.json.message).toBe(
      "Password reset email could not be sent. Mail service is not configured."
    );
    const user = await prisma.user.findUnique({ where: { email } });
    const rows = await prisma.passwordResetToken.findMany({
      where: { userId: user!.id },
    });
    expect(rows).toHaveLength(0);
  });

  it("completes the reset lifecycle with mail enabled", async () => {
    process.env["MAIL_ENABLED"] = "true";
    const email = testEmail("reset");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    const loginBefore = await post(login, "/api/auth/login", {
      email,
      password: "password-123",
    });
    const beforeClaims = await verifyJwt(JWT_SECRET, loginBefore.json.data.token);

    const f = await post(forgotPassword, "/api/auth/forgot-password", {
      email,
    });
    expect(f.status).toBe(200);
    expect(testResetOutbox).toHaveLength(1);
    expect(testResetOutbox[0]!.to).toBe(email);
    expect(testResetOutbox[0]!.subject).toBe("PrintAlfa - Password Reset");
    const raw = testResetOutbox[0]!.rawToken;

    const done = await post(resetPassword, "/api/auth/reset-password", {
      token: raw,
      newPassword: "new-password-9",
    });
    expect(done.status).toBe(200);
    expect(done.json.message).toBe(
      "Password has been reset successfully. Please login again."
    );

    // Old password dead, new password works, old session revoked.
    expect(
      (await post(login, "/api/auth/login", { email, password: "password-123" }))
        .status
    ).toBe(401);
    expect(
      (
        await post(login, "/api/auth/login", {
          email,
          password: "new-password-9",
        })
      ).status
    ).toBe(200);
    const oldSession = await prisma.userSession.findUnique({
      where: { sessionToken: beforeClaims.sessionId! },
    });
    expect(oldSession?.status).toBe("REVOKED");
    expect(oldSession?.revokedReason).toBe("PASSWORD_RESET");

    // Single-use: replay is rejected.
    const replay = await post(resetPassword, "/api/auth/reset-password", {
      token: raw,
      newPassword: "another-pass-1",
    });
    expect(replay.status).toBe(400);
    expect(replay.json.message).toBe("Token has expired or already been used");
  });

  it("rejects bad/expired tokens and short passwords", async () => {
    const bad = await post(resetPassword, "/api/auth/reset-password", {
      token: "nope",
      newPassword: "long-enough-1",
    });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Invalid reset token");
    const short = await post(resetPassword, "/api/auth/reset-password", {
      token: "whatever",
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    expect(short.json.message).toBe(
      "Valid token and new password (min 8 chars) are required"
    );

    // Expired row (crafted directly, test-only).
    process.env["MAIL_ENABLED"] = "true";
    const email = testEmail("expired");
    created.push(email);
    await post(signup, "/api/auth/signup", {
      name: "N",
      email,
      phone: "1",
      password: "password-123",
      confirmPassword: "password-123",
    });
    const user = await prisma.user.findUnique({ where: { email } });
    const { createHash } = await import("node:crypto");
    const raw = "expired-raw-token";
    await prisma.passwordResetToken.create({
      data: {
        userId: user!.id,
        token: createHash("sha256").update(raw, "utf8").digest("hex"),
        createdAt: new Date(Date.now() - 7200_000),
        expiresAt: new Date(Date.now() - 3600_000),
        used: false,
      },
    });
    const r = await post(resetPassword, "/api/auth/reset-password", {
      token: raw,
      newPassword: "long-enough-1",
    });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Token has expired or already been used");
  });
});
