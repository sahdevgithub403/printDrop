"use client";
import React, { useEffect, useRef, useState } from "react";
import { uploadDocument } from "../api";
import mammoth from "mammoth";
import {
  Upload,
  FileText,
  Image,
  File,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  RefreshCw,
  CheckCircle2,
  Eye,
  FileWarning,
} from "lucide-react";

const MAX_FILE_COUNT = 30;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "doc", "docx"];
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const sanitizeDocxHtml = (html: any) => {
  if (!html) return "";
  let out = String(html);
  out = out.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style\s*>/gi, "");
  out = out.replace(/<(iframe|object|embed|form|link|meta)[\s\S]*?(?:<\/\1\s*>|\/>|>)/gi, "");
  out = out.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\s*(href|src|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, "");
  return out;
};

export const FileUploadStep = ({items, onItemsChange, onContinue, onBack }: any) => {
  const [globalError, setGlobalError] = useState<any>(null);
  const fileInputRef = useRef<any>(null);
  const uploadControllersRef = useRef(new Map());
  const previewUrlRef = useRef<any>(null);

  const [previewFile, setPreviewFile] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<any>(null);
  const [previewType, setPreviewType] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [docxHtml, setDocxHtml] = useState<any>(null);

  const defaultSpecs = {
    printType: "PRINT",
    colorMode: "BW",
    paperSize: "A4",
    printSide: "SINGLE",
    pageRangeOption: "ALL",
    customPageRange: "",
    copies: 1,
  };

  const handleFilesSelected = async (filesList: any) => {
    if (!filesList || filesList.length === 0) return;
    setGlobalError(null);

    const newFiles: any[] = Array.from(filesList);
    const errors: string[] = [];

    if (items.length + newFiles.length > MAX_FILE_COUNT) {
      errors.push(`Maximum ${MAX_FILE_COUNT} files allowed per order.`);
    }
    const slotsLeft = Math.max(0, MAX_FILE_COUNT - items.length);
    const filesToAdd = newFiles.slice(0, slotsLeft);

    const localItems: any[] = [];
    for (const file of filesToAdd) {
      if (!file || file.size === 0) {
        errors.push(`"${file?.name || "File"}" is empty (0 bytes) and was rejected.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" exceeds the 20 MB file size limit.`);
        continue;
      }
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const mimeOk =
        !file.type ||
        ALLOWED_MIME.has(file.type) ||
        (file.type.startsWith("image/") && ["jpg", "jpeg", "png"].includes(ext));
      if (!ALLOWED_EXTENSIONS.includes(ext) || !mimeOk) {
        errors.push(`"${file.name}" has an unsupported file type. Allowed: PDF, DOC, DOCX, JPG, PNG.`);
        continue;
      }

      const localItem = {
        localId: "file_" + Math.random().toString(36).substring(2, 9),
        file,
        uploadStatus: "UPLOADING",
        settings: { ...defaultSpecs },
      };
      localItems.push(localItem);
    }

    if (errors.length > 0) {
      setGlobalError(errors.join(" "));
    }

    if (localItems.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    onItemsChange((prev: any) => [...prev, ...localItems]);
    for (const localItem of localItems) {
      uploadSingleFile(localItem.localId, localItem.file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadSingleFile = async (localId: any, file: any) => {
    if (!file) return;
    const controller = new AbortController();
    uploadControllersRef.current.set(localId, controller);

    try {
      const uploadedDoc = await uploadDocument(file, { signal: controller.signal });
      onItemsChange((prev: any) => {
        if (!prev.some((i: any) => i.localId === localId)) return prev;
        return prev.map((i: any) =>
          i.localId === localId
            ? { ...i, uploadedDocument: uploadedDoc, uploadStatus: "COMPLETE", error: undefined }
            : i,
        );
      });
    } catch (err: any) {
      if (controller.signal.aborted) return;
      const msg = err.response?.data?.message || err.message || "Upload failed";
      onItemsChange((prev: any) => {
        if (!prev.some((i: any) => i.localId === localId)) return prev;
        return prev.map((i: any) =>
          i.localId === localId ? { ...i, uploadStatus: "FAILED", error: msg } : i,
        );
      });
    } finally {
      if (uploadControllersRef.current.get(localId) === controller) {
        uploadControllersRef.current.delete(localId);
      }
    }
  };

  const handleRetryUpload = (itemToRetry: any) => {
    const file = itemToRetry?.file;
    if (!file) return;
    onItemsChange((prev: any) =>
      prev.map((i: any) =>
        i.localId === itemToRetry.localId
          ? { ...i, uploadStatus: "UPLOADING", error: undefined }
          : i,
      ),
    );
    uploadSingleFile(itemToRetry.localId, file);
  };

  const handleRemoveItem = (localId: any) => {
    const controller = uploadControllersRef.current.get(localId);
    if (controller) {
      controller.abort();
      uploadControllersRef.current.delete(localId);
    }
    onItemsChange((prev: any) => prev.filter((i: any) => i.localId !== localId));
  };

  useEffect(() => {
    const controllers = uploadControllersRef.current;
    return () => {
      controllers.forEach((c: any) => c.abort());
      controllers.clear();
      if (previewUrlRef.current) {
        window.URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const formatFileSize = (bytes: any) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handlePreview = async (file: any) => {
    if (!file) return;
    try {
      if (previewUrlRef.current) {
        window.URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewFile(file);
      setPreviewType(file.type);
      setIsPreviewLoading(true);
      setPreviewError(false);
      setDocxHtml(null);

      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);

      const isDocx =
        file.name.toLowerCase().endsWith(".docx") ||
        file.type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      if (isDocx) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(sanitizeDocxHtml(result.value));
        } catch (docxErr: any) {
          console.error("Mammoth docx conversion failed:", docxErr);
          setPreviewError(true);
        }
      }
    } catch (err: any) {
      console.error("Failed to load preview:", err);
      setPreviewError(true);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewUrlRef.current) {
      window.URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (previewUrl) {
      try {
        window.URL.revokeObjectURL(previewUrl);
      } catch { /* already revoked */ }
    }
    setPreviewUrl(null);
    setPreviewFile(null);
    setPreviewType("");
    setDocxHtml(null);
  };

  const allCompleted =
    items.length > 0 && items.every((i: any) => i.uploadStatus === "COMPLETE");
  const isAnyUploading = items.some((i: any) => i.uploadStatus === "UPLOADING");

  return (
    <div className="space-y-8">
      {/* Editorial Title */}
      <div>
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 mb-2 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to type selection</span>
          </button>
        )}
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
          Upload Documents
        </h2>
        <p className="text-base text-[var(--text-secondary)] mt-2 font-medium">
          Select one or multiple PDF / image files to send directly to the shop
          counter printer.
        </p>
      </div>

      {globalError && (
        <div className="p-5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-300 text-sm font-semibold flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 dark:text-rose-300 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(e: any) => handleFilesSelected(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        className="hidden"
      />

      {/* Upload Zone when empty */}
      {items.length === 0 ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e: any) => e.preventDefault()}
          onDrop={(e: any) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          className="min-h-[260px] border-2 border-dashed border-[var(--border-app)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] hover:border-[var(--color-accent-border)] rounded-3xl p-10 text-center cursor-pointer transition-all flex flex-col justify-center items-center gap-6 shadow-xs"
        >
          <div className="w-20 h-20 rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)] flex items-center justify-center shadow-xs">
            <Upload className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <p className="text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
              Tap or drag files to upload
            </p>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] font-medium">
              Supports <span className="font-bold text-[var(--text-primary)]">PDF, DOCX, JPG, PNG</span> up to <span className="font-bold text-[var(--text-primary)]">20 MB</span>
            </p>
          </div>
        </div>
      ) : (
        /* List of Uploaded Items */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              {items.length} {items.length === 1 ? "file" : "files"} selected
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-primary)] hover:underline cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add More Files</span>
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item: any) => {
              const fileName =
                item.uploadedDocument?.originalFileName ||
                item.file?.name ||
                "Document";
              const fileSize =
                item.uploadedDocument?.fileSize || item.file?.size || 0;
              const pageCount = item.uploadedDocument?.pageCount;

              return (
                <div
                  key={item.localId}
                  className="bg-[var(--bg-surface)] rounded-2xl p-4 sm:p-5 border border-[var(--border-app)] flex items-center justify-between gap-3 sm:gap-4 shadow-xs"
                >
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    {fileName.toLowerCase().endsWith(".pdf") ? (
                      <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-500 dark:text-rose-300 flex items-center justify-center shrink-0 border border-rose-500/20">
                        <FileText className="w-6 h-6" />
                      </div>
                    ) : fileName.match(/\.(jpg|jpeg|png)$/i) ? (
                      <div className="w-12 h-12 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)]">
                        <Image className="w-6 h-6" />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)]">
                        <File className="w-6 h-6" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <p className="text-sm sm:text-lg font-bold text-[var(--text-primary)] truncate">
                        {fileName}
                      </p>
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5 font-medium">
                        <span>{formatFileSize(fileSize)}</span>
                        {pageCount !== undefined && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-[var(--text-primary)]">
                              {pageCount} {pageCount === 1 ? "page" : "pages"}
                            </span>
                          </>
                        )}

                        {item.uploadStatus === "UPLOADING" && (
                          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md font-semibold text-xs border border-amber-500/20">
                            <Loader2 className="w-3 h-3 animate-spin" />{" "}
                            Uploading...
                          </span>
                        )}

                        {item.uploadStatus === "COMPLETE" && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md font-semibold text-xs border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />{" "}
                            Complete
                          </span>
                        )}

                        {item.uploadStatus === "FAILED" && (
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded-md font-semibold text-xs border border-rose-500/20">
                            <AlertCircle className="w-3 h-3 text-rose-500 dark:text-rose-300" />{" "}
                            Upload Failed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.file && (
                      <button
                        type="button"
                        onClick={() => item.file && handlePreview(item.file)}
                        className="btn-secondary-sm h-10 px-3.5 text-xs flex items-center gap-1.5"
                        title="Preview file"
                      >
                        <Eye className="w-4 h-4 text-[var(--text-secondary)]" />
                        <span className="hidden sm:inline">Preview</span>
                      </button>
                    )}

                    {item.uploadStatus === "FAILED" && (
                      <button
                        type="button"
                        onClick={() => handleRetryUpload(item)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-[var(--text-primary)] bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-app)] transition-colors cursor-pointer"
                        title="Retry upload"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.localId)}
                      className="p-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      title="Remove file"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary w-full h-13 border-dashed border-[var(--border-app)] text-base font-bold flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>Add More Files</span>
          </button>
        </div>
      )}

      {items.length > 0 && (
        <button
          type="button"
          disabled={!allCompleted || isAnyUploading}
          onClick={onContinue}
          className="btn-primary w-full h-14 font-bold"
        >
          {isAnyUploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Uploading files...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <span>
                Continue to Print Options ({items.length}{" "}
                {items.length === 1 ? "file" : "files"})
              </span>
              <ArrowRight className="w-5 h-5" />
            </span>
          )}
        </button>
      )}

      {/* Document Preview Overlay */}
      {previewFile && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
          <div className="w-full max-w-6xl h-full max-h-[95vh] flex flex-col bg-[var(--bg-surface)] rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-app)] relative animate-in zoom-in-95 duration-200 m-2 sm:m-4">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--border-app)] bg-[var(--bg-elevated)] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-secondary)] shrink-0 border border-[var(--border-app)]">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-[var(--text-primary)] text-sm sm:text-base truncate">
                    {previewFile.name}
                  </h3>
                  <p className="text-[10px] sm:text-xs text-[var(--text-secondary)] uppercase tracking-wider truncate">
                    {previewType || "Document Preview"}
                  </p>
                </div>
              </div>
              <button
                onClick={closePreview}
                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 bg-[var(--bg-app)] flex items-center justify-center overflow-hidden relative">
              {isPreviewLoading && !previewError && (
                <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--text-muted)]" />
                  <p className="font-medium">Loading document securely...</p>
                </div>
              )}

              {previewError && (
                <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 max-w-sm text-center">
                  <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center">
                    <X className="w-8 h-8 text-rose-500 dark:text-rose-300" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">
                      Preview Failed
                    </h3>
                    <p className="text-sm mt-1 text-[var(--text-secondary)]">
                      The document could not be loaded for preview.
                    </p>
                  </div>
                  <button
                    onClick={closePreview}
                    className="btn-secondary mt-4 w-full"
                  >
                    Close Preview
                  </button>
                </div>
              )}

              {!isPreviewLoading &&
                !previewError &&
                previewUrl &&
                (() => {
                  const isImage = previewType.startsWith("image/");
                  const isPdf =
                    previewType === "application/pdf" ||
                    previewFile.name.toLowerCase().endsWith(".pdf");
                  const isDocx =
                    previewFile.name.toLowerCase().endsWith(".docx") ||
                    previewType ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                  const isUnsupported = !isImage && !isPdf && !isDocx;

                  if (isImage) {
                    return (
                      <div className="w-full h-full p-8 flex items-center justify-center bg-[var(--bg-app)] overflow-auto">
                        <img
                          src={previewUrl}
                          alt={previewFile.name}
                          className="max-w-full max-h-full object-contain rounded shadow-md"
                        />
                      </div>
                    );
                  }

                  if (isPdf) {
                    return (
                      <iframe
                        src={`${previewUrl}#toolbar=0&navpanes=0`}
                        className="w-full h-full border-none bg-white/10"
                        title={previewFile.name}
                      />
                    );
                  }

                  if (isDocx && docxHtml !== null) {
                    return (
                      <div className="w-full h-full overflow-y-auto bg-[var(--bg-app)] p-4 sm:p-8 flex justify-center">
                        <div
                          className="bg-white p-8 sm:p-12 shadow-md max-w-4xl w-full min-h-full docx-preview-container text-zinc-900 rounded-xl"
                          dangerouslySetInnerHTML={{
                            __html: docxHtml || "<p>Empty document.</p>",
                          }}
                        />
                      </div>
                    );
                  }

                  if (isUnsupported || (isDocx && docxHtml === null)) {
                    return (
                      <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 max-w-sm text-center">
                        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                          <FileWarning className="w-8 h-8 text-amber-500" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">
                            Preview Not Available
                          </h3>
                          <p className="text-sm mt-1 text-[var(--text-secondary)]">
                            This file type (
                            {previewFile.name.split(".").pop()?.toUpperCase() ||
                              "Unknown"}
                            ) cannot be securely previewed in the browser.
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
