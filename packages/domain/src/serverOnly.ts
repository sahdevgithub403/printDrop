// Server-only guard: database credentials and secrets must never load in
// browser code. Importing this module from a Client Component (or any
// non-Node runtime) throws immediately instead of leaking configuration.
export function assertServerRuntime(caller: string): void {
  const hasWindow =
    typeof globalThis !== "undefined" &&
    (globalThis as Record<string, unknown>)["window"] !== undefined;
  if (hasWindow) {
    throw new Error(
      `${caller} is server-only and must not be imported from browser code`
    );
  }
}
