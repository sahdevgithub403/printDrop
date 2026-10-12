import { assertServerRuntime } from "@printdrop/domain";

// Streaming multipart parser with legacy size enforcement.
// Legacy: container rejects >20 MB files / >25 MB requests BEFORE the
// controller runs (400 "The file exceeds the maximum allowed size of
// 20 MB."). Next.js Route Handlers have no container guard, so this
// helper: (1) rejects early on Content-Length, (2) caps the streamed body
// at the request limit, (3) caps each file part at the file limit via
// busboy — all BEFORE unbounded buffering, all with the legacy message.
// Missing `file` part mirrors MissingServletRequestParameter:
// 400 "Missing required parameter: file". Only the FIRST `file` part is
// used; anything else is an approximation documented in the report.

export const OVERSIZE_MESSAGE =
  "The file exceeds the maximum allowed size of 20 MB.";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export class MultipartError extends Error {
  constructor(
    message: string,
    readonly status: 400 = 400
  ) {
    super(message);
  }
}

export interface ParsedFile {
  fieldName: string;
  originalFileName: string;
  contentType: string | null;
  data: Uint8Array;
}

export interface ParsedMultipart {
  files: ParsedFile[];
  fields: Record<string, string>;
}

export async function parseMultipart(
  req: Request,
  opts?: { maxFileBytes?: number; maxRequestBytes?: number }
): Promise<ParsedMultipart> {
  assertServerRuntime("parseMultipart");
  const maxFileBytes = opts?.maxFileBytes ?? MAX_FILE_BYTES;
  const maxRequestBytes = opts?.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new MultipartError("Missing required parameter: file");
  }

  const declared = req.headers.get("content-length");
  if (declared != null && /^\d+$/.test(declared.trim())) {
    if (Number.parseInt(declared.trim(), 10) > maxRequestBytes) {
      throw new MultipartError(OVERSIZE_MESSAGE);
    }
  }

  // Cap the streamed body BEFORE buffering it whole.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (reader == null) {
    throw new MultipartError("Missing required parameter: file");
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxRequestBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new MultipartError(OVERSIZE_MESSAGE);
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);

  const Busboy = (await import("busboy")).default;
  return new Promise<ParsedMultipart>((resolve, reject) => {
    const files: ParsedFile[] = [];
    const fields: Record<string, string> = {};
    let fileTooLarge = false;
    const parser = Busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: maxFileBytes },
    });
    parser.on("file", (_name: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const parts: Buffer[] = [];
      let size = 0;
      stream.on("data", (d: Buffer) => {
        size += d.length;
        parts.push(d);
      });
      stream.on("limit", () => {
        fileTooLarge = true;
        stream.resume();
      });
      stream.on("end", () => {
        files.push({
          fieldName: _name,
          originalFileName: info.filename,
          contentType: info.mimeType || null,
          data: new Uint8Array(Buffer.concat(parts)),
        });
      });
    });
    parser.on("field", (name: string, value: string) => {
      fields[name] = value;
    });
    parser.on("error", (err: Error) => reject(err));
    parser.on("finish", () => {
      if (fileTooLarge) {
        reject(new MultipartError(OVERSIZE_MESSAGE));
        return;
      }
      resolve({ files, fields });
    });
    parser.end(body);
  });
}

/** First `file` part, or the legacy missing-parameter 400. */
export function requireFirstFile(parsed: ParsedMultipart): ParsedFile {
  const file = parsed.files.find((f) => f.fieldName === "file") ?? parsed.files[0];
  if (file == null) {
    throw new MultipartError("Missing required parameter: file");
  }
  return file;
}
