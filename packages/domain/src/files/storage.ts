import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { assertServerRuntime } from "../serverOnly.js";

// Object-storage adapter boundary. Application logic talks ONLY to
// StorageAdapter, never to R2/S3 clients directly, so the provider can be
// swapped without touching upload/download/delete flows.
// Keys are ALWAYS the server-generated stored file name
// (<uuid>.<ext>); caller display names never reach the bucket.

// Short-lived download grant (approved TTL: 5 minutes).
export const DOWNLOAD_TTL_SECONDS = 300;

export interface StorageAdapter {
  readonly backend: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Idempotent: missing keys report success (legacy delete semantics). */
  remove(key: string): Promise<boolean>;
  /** Presigned GET valid for DOWNLOAD_TTL_SECONDS. */
  presignedGet(key: string, contentDisposition: string): Promise<string>;
}

/** Key guard mirroring the legacy stored-name checks (no traversal). */
export function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.includes("..") ||
    key.includes("/") ||
    key.includes("\\")
  ) {
    throw new Error("Invalid stored file name");
  }
}

export function newStoredFileName(extension: string): string {
  return `${randomUUID()}.${extension}`;
}

/**
 * Local-directory adapter: mirrors the legacy app.upload.dir filesystem
 * semantics (resolve + normalize + confinement, idempotent delete). Used
 * for isolated tests and local development — never for customer data.
 */
export class LocalDirectoryAdapter implements StorageAdapter {
  readonly backend = "local-directory";
  private readonly root: string;

  constructor(rootDir: string) {
    assertServerRuntime("LocalDirectoryAdapter");
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    // assertSafeKey already rejects separators and "..", so the resolved
    // path must stay exactly root + key (legacy confinement check).
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (full !== path.join(this.root, key)) {
      throw new Error("Cannot access file outside upload directory");
    }
    return full;
  }

  async put(key: string, data: Uint8Array, _contentType?: string): Promise<void> {
    void _contentType;
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(this.resolve(key), data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.resolve(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      await fs.unlink(this.resolve(key));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      return false;
    }
  }

  async presignedGet(_key: string, _disposition?: string): Promise<string> {
    void _key;
    void _disposition;
    throw new Error(
      "LocalDirectoryAdapter does not issue presigned URLs (test/dev only)"
    );
  }
}

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

/** Reads R2_* env WITHOUT logging values. Returns null when incomplete. */
export function readR2Config(
  env: NodeJS.ProcessEnv = process.env
): R2Config | null {
  const endpoint = (env["R2_ENDPOINT"] ?? "").trim();
  const bucket = (env["R2_BUCKET"] ?? "").trim();
  const accessKeyId = (env["R2_ACCESS_KEY_ID"] ?? "").trim();
  const secretAccessKey = (env["R2_SECRET_ACCESS_KEY"] ?? "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: (env["R2_REGION"] ?? "auto").trim() || "auto",
  };
}

/**
 * Cloudflare R2 adapter (private bucket, S3-compatible API). Constructed
 * ONLY from explicit config; missing config throws instead of connecting
 * anywhere. Credentials never leave server code and never reach clients —
 * browsers receive only 5-minute presigned download URLs.
 */
export class R2Adapter implements StorageAdapter {
  readonly backend = "cloudflare-r2";
  private readonly config: R2Config;
  private client: {
    raw: unknown;
    send: (cmd: unknown) => Promise<any>;
    GetObjectCommand: new (input: any) => unknown;
    PutObjectCommand: new (input: any) => unknown;
    DeleteObjectCommand: new (input: any) => unknown;
    getSignedUrl: (cmd: unknown, opts: unknown) => Promise<string>;
  } | null = null;

  constructor(config: R2Config | null) {
    assertServerRuntime("R2Adapter");
    if (config == null) {
      throw new Error(
        "R2Adapter: missing R2 configuration (R2_ENDPOINT/R2_BUCKET/" +
          "R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY). Refusing to connect."
      );
    }
    this.config = config;
  }

  private async s3(): Promise<NonNullable<R2Adapter["client"]>> {
    if (this.client != null) {
      return this.client;
    }
    const s3: any = await import("@aws-sdk/client-s3");
    const presign: any = await import("@aws-sdk/s3-request-presigner");
    const client = new s3.S3Client({
      region: this.config.region ?? "auto",
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: false,
    });
    this.client = {
      raw: client,
      send: (cmd: unknown) => client.send(cmd as any),
      GetObjectCommand: s3.GetObjectCommand,
      PutObjectCommand: s3.PutObjectCommand,
      DeleteObjectCommand: s3.DeleteObjectCommand,
      getSignedUrl: (cmd: unknown, opts: unknown) =>
        presign.getSignedUrl(client, cmd, opts),
    };
    return this.client;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    const s3 = await this.s3();
    await s3.send(
      new s3.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: Buffer.from(data),
        ContentType: contentType || "application/octet-stream",
      })
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    const s3 = await this.s3();
    try {
      const out = await s3.send(
        new s3.GetObjectCommand({ Bucket: this.config.bucket, Key: key })
      );
      const bytes = await (out.Body as any).transformToByteArray();
      return new Uint8Array(bytes);
    } catch (err) {
      if (
        (err as { name?: string }).name === "NoSuchKey" ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async remove(key: string): Promise<boolean> {
    assertSafeKey(key);
    const s3 = await this.s3();
    try {
      await s3.send(
        new s3.DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }

  async presignedGet(
    key: string,
    contentDisposition: string
  ): Promise<string> {
    assertSafeKey(key);
    const s3 = await this.s3();
    return s3.getSignedUrl(
      new s3.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition,
      }),
      { expiresIn: DOWNLOAD_TTL_SECONDS }
    );
  }
}
