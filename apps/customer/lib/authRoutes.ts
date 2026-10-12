import { NextResponse } from "next/server";
import {
  loadServerEnv,
  AttemptThrottle,
  TooManyAttemptsError,
  AuthServiceError,
  apiSuccess,
  apiError,
  type AuthContext,
  type ResetMailer,
} from "@printdrop/domain";
import { prismaAuthDb } from "./authStore.js";

// Shared auth-route wiring. Mirrors the Spring setup: JWT secret +
// DATABASE_URL fail fast (RequiredEnvValidator), one in-process throttle
// (AuthService's ConcurrentHashMap), mail disabled unless MAIL_ENABLED
// (EmailService: app.mail.enabled + mailSender presence).

const throttle = new AttemptThrottle();

export interface CapturedResetEmail {
  to: string;
  rawToken: string;
  subject: string;
  text: string;
}

/** In-memory outbox — the only seam tests use to read the raw token. */
export const testResetOutbox: CapturedResetEmail[] = [];

/** Bounded so a misconfigured long-lived process cannot retain tokens. */
export const MAX_RESET_OUTBOX = 100;

export function pushResetOutbox(entry: CapturedResetEmail): void {
  testResetOutbox.push(entry);
  while (testResetOutbox.length > MAX_RESET_OUTBOX) {
    testResetOutbox.shift();
  }
}

function buildMailer(): ResetMailer {
  return {
    async sendPasswordResetEmail(
      to: string,
      rawToken: string
    ): Promise<boolean> {
      // Subject/body mirror EmailService.sendPasswordResetEmail exactly.
      // There is intentionally NO real transport here: with mail disabled
      // the request is logged server-side only (legacy log-only mode) and
      // the caller 503s; with the test flag on, tests read the outbox.
      // Real delivery requires a configured provider (not claimed).
      const subject = "PrintAlfa - Password Reset";
      const text =
        "You have requested to reset your password.\n\n" +
        "Use the following token to reset your password:\n" +
        `${rawToken}\n\n` +
        "This token will expire in 1 hour.\n" +
        "If you did not request a password reset, please ignore this email.";
      if (process.env["MAIL_ENABLED"] !== "true") {
        // Legacy log-only mode: developers can complete the flow locally
        // from this line. Production never logs tokens (see below).
        if (process.env["NODE_ENV"] === "production") {
          console.info(
            `Password reset requested for ${to} (mail disabled, not sent)`
          );
        } else {
          console.info(
            `Password reset email (NOT sent) to ${to}:\nSubject: ${subject}\n${text}`
          );
        }
        return false;
      }
      pushResetOutbox({ to, rawToken, subject, text });
      return true;
    },
  };
}

export function getAuthContext(): AuthContext {
  const env = loadServerEnv();
  return {
    db: prismaAuthDb,
    mailer: buildMailer(),
    throttle,
    jwtSecret: env.jwtSecret,
  };
}

export function deviceFrom(req: Request) {
  return {
    deviceId: req.headers.get("X-Device-ID"),
    deviceName: req.headers.get("X-Device-Name"),
    appVersion: req.headers.get("X-App-Version"),
  };
}

export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return { __malformed: true };
  }
}

export function isMalformed(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "__malformed" in (body as Record<string, unknown>)
  );
}

export function ok<T>(data: T, message: string): NextResponse {
  return NextResponse.json(apiSuccess(data, message), { status: 200 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json(apiError(message), { status: 400 });
}

export function fail(err: unknown): NextResponse {
  if (err instanceof AuthServiceError) {
    return NextResponse.json(apiError(err.message), { status: err.status });
  }
  if (err instanceof TooManyAttemptsError) {
    return NextResponse.json(apiError(err.message), { status: err.status });
  }
  // Domain service errors (orders/payments/shop/jobs/docs): same
  // {status,message} contract (400/401/403/404/409/429/500/503).
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string" &&
    [400, 401, 403, 404, 409, 429, 500, 503].includes(
      (err as { status: unknown }).status as number
    )
  ) {
    const e = err as { status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503; message: string };
    return NextResponse.json(apiError(e.message), { status: e.status });
  }
  // M-03/M-07: never leak internals (GlobalExceptionHandler catch-all).
  console.error("Unhandled auth exception:", err);
  return NextResponse.json(apiError("An internal server error occurred"), {
    status: 500,
  });
}
