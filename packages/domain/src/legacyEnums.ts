// Legacy value sets for the 17 former EnumType.STRING columns.
//
// These mirror backend/src/main/java/com/printalfa/backend/enums/*.java
// exactly (Prisma `enum` blocks were deliberately NOT declared so the
// columns stay VARCHAR(255), matching Hibernate storage — see D1 in
// packages/db/prisma/schema.prisma).
//
// TYPE-LEVEL DOCUMENTATION ONLY: no runtime code, no validation logic.
// Runtime enforcement arrives with the API migration after approval.

export type UserRole = "ROLE_SHOP_ADMIN" | "ROLE_SUPER_ADMIN" | "ROLE_PRINT_AGENT";

export type SessionStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export type PaymentMethod = "ONLINE" | "PAY_AT_SHOP";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

export type PrintStatus = "PENDING" | "PRINTING" | "COMPLETED" | "CANCELLED" | "FAILED";

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type PrintType = "PRINT" | "XEROX" | "PASSPORT_PHOTO";

export type ColorMode = "BW" | "COLOR";

export type PaperSize = "A4" | "A3";

export type PrintSide = "SINGLE" | "DOUBLE";
