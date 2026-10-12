import {
  loadServerEnv,
  readR2Config,
  R2Adapter,
  LocalDirectoryAdapter,
  authenticateRequest,
  requireAuthenticated,
  type StorageAdapter,
} from "@printdrop/domain";
import { prismaPrincipalStores } from "./principalStore.js";

// Storage + principal wiring for document routes. R2 (private bucket) is
// used exactly when R2_* env is complete; otherwise a local directory
// (FILE_STORAGE_DIR, default ./uploads) mirrors the legacy filesystem
// semantics for isolated tests and development. Credentials are never
// exposed: clients receive only short-lived presigned download URLs,
// and only after authorization.

let storage: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (storage != null) {
    return storage;
  }
  const r2 = readR2Config();
  if (r2 != null) {
    storage = new R2Adapter(r2);
    return storage;
  }
  // Fail closed in production: local-disk storage of customer documents is
  // explicitly restricted to development/test. Production without R2
  // refuses to start serving files instead of silently storing them
  // on ephemeral local disk.
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "Document storage is not configured: R2 credentials are required " +
        "in production (R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/" +
        "R2_SECRET_ACCESS_KEY). Local-directory fallback is development/test only."
    );
  }
  const dir = process.env["FILE_STORAGE_DIR"]?.trim() || "./uploads";
  storage = new LocalDirectoryAdapter(dir);
  return storage;
}

/** Test seam: reset the cached adapter between isolated cases. */
export function resetStorage(): void {
  storage = null;
}

export async function authenticateDocumentRequest(req: Request) {
  const { jwtSecret } = loadServerEnv();
  const principal = await authenticateRequest(
    prismaPrincipalStores,
    req.headers,
    jwtSecret
  );
  return requireAuthenticated(principal);
}
