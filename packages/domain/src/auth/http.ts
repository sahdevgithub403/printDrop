// Legacy ApiResponse envelope for auth failures.
// Source: JwtAuthenticationFilter.unauthorized writes
// {"success":false,"message":"<msg>","data":null} with 401 JSON content.
// The two legacy messages are "Invalid or expired token" (bad/expired
// JWT) and "Session is invalid or expired" (revoked/expired session).

export interface ApiErrorBody {
  success: false;
  message: string;
  data: null;
}

export function unauthorizedBody(message: string): ApiErrorBody {
  return { success: false, message, data: null };
}

export const INVALID_TOKEN_MESSAGE = "Invalid or expired token";
export const INVALID_SESSION_MESSAGE = "Session is invalid or expired";

// Generic ApiResponse envelope.
// Source: backend/.../dto/ApiResponse.java — {success, message, data,
// timestamp}; success(data) defaults message "Success"; error(message)
// sets data null. Timestamp is server-local ISO-8601 (Jackson renders
// LocalDateTime the same shape).
export interface ApiSuccessBody<T> {
  success: true;
  message: string;
  data: T;
  timestamp: string;
}

export function apiSuccess<T>(data: T, message = "Success"): ApiSuccessBody<T> {
  return { success: true, message, data, timestamp: new Date().toISOString() };
}

export function apiError(message: string): ApiErrorBody {
  return { success: false, message, data: null };
}
