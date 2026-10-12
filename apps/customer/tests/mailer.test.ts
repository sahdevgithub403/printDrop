import { describe, expect, it } from "vitest";
import {
  pushResetOutbox,
  testResetOutbox,
  MAX_RESET_OUTBOX,
} from "../lib/authRoutes.js";

// Outbox bound verification (FUNC-001): the in-memory reset-token store
// must not grow without limit if mail stays enabled outside tests.
describe("reset outbox bound", () => {
  it("caps retained tokens, dropping oldest first", () => {
    expect(MAX_RESET_OUTBOX).toBe(100);
    testResetOutbox.length = 0;
    for (let i = 0; i < MAX_RESET_OUTBOX + 5; i++) {
      pushResetOutbox({
        to: `u${i}@example.com`,
        rawToken: `tok-${i}`,
        subject: "s",
        text: "t",
      });
    }
    expect(testResetOutbox).toHaveLength(MAX_RESET_OUTBOX);
    expect(testResetOutbox[0]!.rawToken).toBe("tok-5");
    expect(testResetOutbox[MAX_RESET_OUTBOX - 1]!.rawToken).toBe(
      `tok-${MAX_RESET_OUTBOX + 4}`
    );
    testResetOutbox.length = 0;
  });
});
