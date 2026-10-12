import React, { useState, useEffect } from "react";
import {
  getAdminDocuments,
  deleteAdminDocument,
  deleteAdminDocumentsBulk,
  deleteAllAdminDocuments,
  downloadDocumentFile,
  getDocumentPreviewUrl,
} from "../api";
import mammoth from "mammoth";

// Minimal sanitizer for mammoth-generated HTML before dangerouslySetInnerHTML.
const sanitizeDocxHtml = (html) => {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|form|meta|link|base)[\s\S]*?(?:<\/\1\s*>|\/>|>)/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
};
import { MaterialIcon } from "./ui/MaterialIcon";

export const FileManagementView = ({ user }) => {  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Filters and pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState("NEWEST");
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const pageSize = 20;

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Modal states
  const [singleDeleteTarget, setSingleDeleteTarget] = useState(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Download in-flight guard (prevents duplicate downloads on rapid clicks)
  const [downloadingId, setDownloadingId] = useState(null);

  // Preview states
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [docxHtml, setDocxHtml] = useState(null);

  useEffect(() => {
    fetchDocuments();
  }, [currentPage, typeFilter, sortOrder]);

  const showToast = (message, type = "success") => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchDocuments = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const data = await getAdminDocuments({
        search: searchQuery,
        type: typeFilter,
        sort: sortOrder,
        page: currentPage,
        size: pageSize,
      });

      setDocuments(data?.content || []);
      setTotalPages(data?.totalPages || 1);
      setTotalElements(data?.totalElements || 0);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to fetch documents:", err);
      setError("Unable to load shop documents. Please try again.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(0);
    fetchDocuments();
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileIcon = (fileName = "", contentType = "") => {
    const fn = fileName.toLowerCase();
    const ct = (contentType || "").toLowerCase();

    if (ct.includes("pdf") || fn.endsWith(".pdf")) {
      return <MaterialIcon name="description" size={20} className="text-red-500" />;
    }
    if (ct.startsWith("image/") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".png")) {
      return <MaterialIcon name="image" size={20} className="text-blue-500" />;
    }
    if (ct.includes("word") || ct.includes("officedocument") || fn.endsWith(".doc") || fn.endsWith(".docx")) {
      return <MaterialIcon name="article" size={20} className="text-indigo-500" />;
    }
    return <MaterialIcon name="folder_copy" size={20} className="text-neutral-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === documents.length) {
      setSelectedIds(new Set());
    } else {
      const eligibleIds = documents.filter((d) => d.canDelete).map((d) => d.id);
      setSelectedIds(new Set(eligibleIds));
    }
  };

  const toggleSelectOne = (docId) => {
    const next = new Set(selectedIds);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
    }
    setSelectedIds(next);
  };

  // Delete Handlers
  // Explicit download only: row/filename/icon clicks never reach this handler
  // (table rows carry no onClick), and stopPropagation shields it if a parent
  // click handler is ever added above the action buttons.
  const handleDownload = async (doc, e) => {
    e?.stopPropagation();
    if (!doc?.id || downloadingId) return;
    setDownloadingId(doc.id);
    try {
      await downloadDocumentFile(doc.id, doc.originalFileName);
    } catch (err) {
      console.error("Download failed:", err);
      showToast(err.response?.data?.message || "Failed to download file", "error");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmSingleDelete = async () => {
    if (!singleDeleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteAdminDocument(singleDeleteTarget.id);
      showToast(`Successfully deleted ${singleDeleteTarget.originalFileName}`);
      setSingleDeleteTarget(null);
      fetchDocuments(true);
    } catch (err) {
      console.error("Delete failed:", err);
      showToast(err.response?.data?.message || "Failed to delete document", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      const result = await deleteAdminDocumentsBulk(Array.from(selectedIds));
      showToast(`Successfully deleted ${result?.deletedCount || selectedIds.size} files`);
      setShowBulkDeleteModal(false);
      setSelectedIds(new Set());
      fetchDocuments(true);
    } catch (err) {
      console.error("Bulk delete failed:", err);
      showToast(err.response?.data?.message || "Bulk deletion failed", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteAll = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteAllAdminDocuments();
      showToast(`Cleaned up ${result?.deletedCount || 0} files (${result?.skippedActiveCount || 0} active files preserved)`);
      setShowDeleteAllModal(false);
      setSelectedIds(new Set());
      fetchDocuments(true);
    } catch (err) {
      console.error("Delete all failed:", err);
      showToast(err.response?.data?.message || "Failed to delete all shop documents", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Preview Handlers
  const handleOpenPreview = async (doc) => {
    if (!doc?.id) return;
    setPreviewDoc(doc);
    setIsPreviewLoading(true);
    setPreviewError(false);
    setDocxHtml(null);

    try {
      const url = await getDocumentPreviewUrl(doc.id, doc.contentType || "application/pdf");
      setPreviewUrl(url);

      const fn = doc.originalFileName.toLowerCase();
      if (fn.endsWith(".docx") || doc.contentType?.includes("officedocument.wordprocessingml")) {
        try {
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setDocxHtml(sanitizeDocxHtml(result.value));
        } catch (mErr) {
          console.error("Mammoth preview failed:", mErr);
          setPreviewError(true);
        }
      }
    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewError(true);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewDoc(null);
    setDocxHtml(null);
    setPreviewError(false);
  };

  // Storage calculation for current view
  const currentTotalBytes = documents.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const deletableCount = documents.filter((d) => d.canDelete).length;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-6 right-6 z-50 px-5 py-3.5 rounded-none shadow-none flex items-center gap-3 text-sm font-bold animate-in fade-in slide-in-from-top duration-200 ${
            toastMessage.type === "error"
              ? "bg-rose-600 text-white"
              : "bg-[#111111] text-white border border-neutral-700"
          }`}
        >
          {toastMessage.type === "error" ? (
            <MaterialIcon name="warning" size={20} className="text-rose-200" />
          ) : (
            <MaterialIcon name="check_circle" size={20} className="text-emerald-400" />
          )}
          <span>{toastMessage.message}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 hover:bg-white/20 rounded-none ml-2"
            aria-label="Dismiss message"
          >
            <MaterialIcon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Header Banner & Storage Overview */}
      <div className="bg-[var(--bg-panel)] rounded-none p-6 sm:p-8 border border-[var(--border-app)] shadow-none space-y-6 transition-colors duration-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <MaterialIcon name="dns" size={24} className="text-[var(--color-accent)]" />
              <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                Shop File Storage
              </h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-1 font-medium">
              Manage, preview, and securely purge documents uploaded to your shop ({user?.shopName || "Your Shop"}).
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => fetchDocuments(false)}
              disabled={isRefreshing || loading}
              className="btn-secondary cursor-pointer disabled:opacity-40"
              title="Refresh files"
            >
              <MaterialIcon name="refresh" size={16} className={`text-[var(--text-secondary)] ${isRefreshing ? "animate-spin text-[var(--color-accent)]" : ""}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteAllModal(true)}
              disabled={totalElements === 0 || isDeleting}
              className="btn-danger disabled:opacity-40"
            >
              <MaterialIcon name="delete" size={16} />
              <span>Purge All Shop Files</span>
            </button>
          </div>
        </div>

        {/* Storage Metrics — plain stat text, no nested cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div>
            <span className="text-xs text-[var(--text-secondary)] font-bold uppercase tracking-wider block">
              Total Shop Files
            </span>
            <span className="text-2xl font-extrabold text-[var(--text-primary)] mt-1 block">
              {totalElements}
            </span>
          </div>

          <div>
            <span className="text-xs text-[var(--text-secondary)] font-bold uppercase tracking-wider block">
              Page View Storage
            </span>
            <span className="text-2xl font-extrabold text-[var(--text-primary)] mt-1 block">
              {formatBytes(currentTotalBytes)}
            </span>
          </div>

          <div>
            <span className="text-xs text-[var(--text-secondary)] font-bold uppercase tracking-wider block">
              Safe to Purge
            </span>
            <span className="text-2xl font-extrabold text-emerald-500 mt-1 block">
              {deletableCount} of {documents.length}
            </span>
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Filters */}
      <div className="bg-[var(--bg-panel)] rounded-none p-4 border border-[var(--border-app)] shadow-none flex flex-col md:flex-row items-center justify-between gap-4 transition-colors duration-200">
        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <MaterialIcon name="search" size={16} className="text-[var(--text-muted)] pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by file name or order #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-4 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </form>

        {/* Filter Dropdowns */}
        <div className="flex items-center gap-3 w-full md:w-auto flex-wrap sm:flex-nowrap justify-between md:justify-end">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
            <MaterialIcon name="filter_list" size={16} className="text-[var(--text-muted)]" />
            <span>Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(0);
              }}
              className="h-10 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="ALL">All Formats</option>
              <option value="PDF">PDF Documents</option>
              <option value="IMAGE">Images (JPG/PNG)</option>
              <option value="DOC">Word Docs (DOCX)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
            <MaterialIcon name="swap_vert" size={16} className="text-[var(--text-muted)]" />
            <span>Sort:</span>
            <select
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value);
                setCurrentPage(0);
              }}
              className="h-10 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="NEWEST">Newest Uploads</option>
              <option value="OLDEST">Oldest Uploads</option>
              <option value="SIZE_DESC">Largest File Size</option>
              <option value="SIZE_ASC">Smallest File Size</option>
            </select>
          </div>
        </div>
      </div>

      {/* Multi-Selection Action Strip */}
      {selectedIds.size > 0 && (
        <div className="bg-[var(--bg-elevated)] text-[var(--text-primary)] p-4 rounded-none border border-[var(--color-accent-border)] flex items-center justify-between shadow-none animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-none bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center font-bold text-xs">
              {selectedIds.size}
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {selectedIds.size} {selectedIds.size === 1 ? "file" : "files"} selected
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 font-bold transition-colors cursor-pointer"
            >
              Deselect All
            </button>
            <button
              type="button"
              onClick={() => setShowBulkDeleteModal(true)}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-none flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <MaterialIcon name="delete" size={14} />
              <span>Delete Selected</span>
            </button>
          </div>
        </div>
      )}

      {/* Files List Table */}
      <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-none overflow-hidden transition-colors duration-200">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-4">
            <MaterialIcon name="progress_activity" size={32} className="animate-spin text-[var(--color-accent)]" />
            <p className="text-sm text-[var(--text-secondary)] font-medium animate-pulse">
              Loading shop documents...
            </p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <MaterialIcon name="warning" size={36} className="text-rose-500 mx-auto" />
            <p className="text-base font-bold text-[var(--text-primary)]">{error}</p>
            <button type="button" onClick={() => fetchDocuments(false)} className="h-9 px-4 rounded-none text-xs font-bold bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)] mx-auto cursor-pointer">
              Retry
            </button>
          </div>
        ) : documents.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <MaterialIcon name="folder_copy" size={48} className="text-[var(--text-muted)] mx-auto" />
            <p className="text-base font-bold text-[var(--text-primary)]">No Documents Found</p>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
              {searchQuery || typeFilter !== "ALL"
                ? "No uploaded files match the current search filters."
                : "Your shop hasn't received or stored any customer print files yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-app)] text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  <th className="py-4 pl-6 pr-3 w-12 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      title="Select all deletable files"
                    >
                      {selectedIds.size === documents.length && documents.length > 0 ? (
                        <MaterialIcon name="check_box" size={16} className="text-[var(--color-accent)]" />
                      ) : (
                        <MaterialIcon name="check_box_outline_blank" size={16} />
                      )}
                    </button>
                  </th>
                  <th className="py-4 px-4">File Name</th>
                  <th className="py-4 px-4">Specs & Size</th>
                  <th className="py-4 px-4">Order Link</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-4">Uploaded</th>
                  <th className="py-4 pr-6 pl-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {documents.map((doc) => {
                  const isSelected = selectedIds.has(doc.id);
                  const isProcessing = doc.isProcessing || !doc.canDelete;

                  return (
                    <tr
                      key={doc.id}
                      className={`hover:bg-[var(--bg-elevated)]/60 transition-colors ${
                        isSelected ? "bg-[var(--color-accent-soft)]" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-4 pl-6 pr-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(doc.id)}
                          disabled={isProcessing}
                          className={`text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ${
                            isProcessing ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                          }`}
                          title={isProcessing ? "File is locked by an active order" : "Select file"}
                          aria-label="Select file"
                        >
                          {isSelected ? (
                            <MaterialIcon name="check_box" size={16} className="text-[var(--color-accent)]" />
                          ) : (
                            <MaterialIcon name="check_box_outline_blank" size={16} />
                          )}
                        </button>
                      </td>

                      {/* File Name & Format Icon */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3 min-w-0 max-w-xs sm:max-w-md">
                          <span className="shrink-0 inline-flex">
                            {getFileIcon(doc.originalFileName, doc.contentType)}
                          </span>
                          <div className="min-w-0">
                            <p
                              className="font-bold text-[var(--text-primary)] truncate max-w-[220px] sm:max-w-[280px]"
                              title={doc.originalFileName}
                            >
                              {doc.originalFileName}
                            </p>
                            <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase">
                              {doc.contentType ? doc.contentType.split("/").pop() : "FILE"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Specs */}
                      <td className="py-4 px-4">
                        <div className="text-xs space-y-0.5">
                          <p className="font-bold text-[var(--text-primary)]">{formatBytes(doc.fileSize)}</p>
                          <p className="text-[var(--text-secondary)] font-medium">
                            {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                          </p>
                        </div>
                      </td>

                      {/* Order Info */}
                      <td className="py-4 px-4">
                        <div className="text-xs space-y-0.5">
                          <span className="font-mono font-bold text-[var(--text-primary)] bg-[var(--bg-surface)] px-2 py-0.5 rounded-none">
                            {doc.orderNumber || "No Order"}
                          </span>
                          {doc.customerName && (
                            <p className="text-[var(--text-secondary)] truncate max-w-[120px]">
                              {doc.customerName}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4">
                        {isProcessing ? (
                          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[var(--color-info-text)] bg-[var(--color-info-bg)] px-2.5 py-1 rounded-none border border-[var(--color-info-border)]">
                            <MaterialIcon name="lock" size={12} />
                            <span>In Print Queue</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[var(--color-success-text)] bg-[var(--color-success-bg)] px-2.5 py-1 rounded-none border border-[var(--color-success-border)]">
                            <MaterialIcon name="check_circle" size={12} />
                            <span>Completed</span>
                          </span>
                        )}
                      </td>

                      {/* Upload Time */}
                      <td className="py-4 px-4 text-xs text-[var(--text-secondary)] font-medium whitespace-nowrap">
                        {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : "Unknown"}
                      </td>

                      {/* Row Action Buttons */}
                      <td className="py-4 pr-6 pl-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenPreview(doc)}
                            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-none hover:bg-[var(--bg-elevated)] transition-colors border border-transparent hover:border-[var(--border-app)] cursor-pointer"
                            title="Preview document"
                            aria-label="Preview document"
                          >
                            <MaterialIcon name="visibility" size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDownload(doc, e)}
                            disabled={downloadingId === doc.id}
                            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-none hover:bg-[var(--bg-elevated)] transition-colors border border-transparent hover:border-[var(--border-app)] cursor-pointer disabled:opacity-50"
                            title="Download original file"
                            aria-label="Download original file"
                          >
                            {downloadingId === doc.id ? (
                              <MaterialIcon name="progress_activity" size={16} className="animate-spin" />
                            ) : (
                              <MaterialIcon name="download" size={16} />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setSingleDeleteTarget(doc)}
                            disabled={isProcessing}
                            className={`p-2 rounded-none transition-colors border ${
                              isProcessing
                                ? "text-neutral-600 border-transparent cursor-not-allowed"
                                : "text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 border-transparent hover:border-rose-500/20 cursor-pointer"
                            }`}
                            title={isProcessing ? "Cannot delete file in active print job" : "Delete file permanently"}
                            aria-label="Delete file permanently"
                          >
                            <MaterialIcon name="delete" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-Side Pagination Footer */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-[var(--border-app)] bg-[var(--bg-elevated)] flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--text-secondary)]">
              Showing page <strong className="text-[var(--text-primary)]">{currentPage + 1}</strong> of{" "}
              <strong className="text-[var(--text-primary)]">{totalPages}</strong> ({totalElements} total files)
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0 || loading}
                className="h-9 px-3 rounded-none text-xs flex items-center gap-1 font-bold bg-[var(--bg-surface)] hover:bg-[var(--border-app)] text-[var(--text-primary)] border border-[var(--border-app)] disabled:opacity-40 cursor-pointer"
              >
                <MaterialIcon name="chevron_left" size={16} />
                <span>Prev</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1 || loading}
                className="h-9 px-3 rounded-none text-xs flex items-center gap-1 font-bold bg-[var(--bg-surface)] hover:bg-[var(--border-app)] text-[var(--text-primary)] border border-[var(--border-app)] disabled:opacity-40 cursor-pointer"
              >
                <span>Next</span>
                <MaterialIcon name="chevron_right" size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SINGLE FILE DELETE CONFIRMATION MODAL */}
      {singleDeleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-none max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-[var(--text-primary)]">
            <MaterialIcon name="delete" size={28} className="text-rose-500" />

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Delete this file?</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Are you sure you want to permanently delete{" "}
                <strong className="text-[var(--text-primary)] font-semibold">{singleDeleteTarget.originalFileName}</strong>?
              </p>
              <p className="text-xs text-rose-500 font-bold bg-rose-500/10 p-2.5 rounded-none border border-rose-500/20">
                ⚠️ Warning: This will delete the physical file from server storage. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSingleDeleteTarget(null)}
                disabled={isDeleting}
                className="h-11 px-4 rounded-none text-sm font-bold bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={isDeleting}
                className="h-11 px-5 rounded-none text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors flex items-center gap-2 cursor-pointer"
              >
                {isDeleting && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
                <span>Delete File</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK DELETE CONFIRMATION MODAL */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] shadow-none max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-[var(--text-primary)]">
            <MaterialIcon name="delete" size={28} className="text-rose-500" />

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">
                Delete {selectedIds.size} Selected Files?
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                This will permanently purge the {selectedIds.size} selected documents from your shop storage.
              </p>
              <p className="text-xs text-rose-500 font-bold bg-rose-500/10 p-2.5 rounded-none border border-rose-500/20">
                ⚠️ This operation is irreversible.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={isDeleting}
                className="h-11 px-4 rounded-none text-sm font-bold bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={isDeleting}
                className="h-11 px-5 rounded-none text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors flex items-center gap-2 cursor-pointer"
              >
                {isDeleting && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
                <span>Delete ({selectedIds.size}) Files</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ALL SHOP DOCUMENTS CONFIRMATION MODAL */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-panel)] rounded-none border border-rose-500/30 shadow-none max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-[var(--text-primary)]">
            <MaterialIcon name="warning" size={28} className="text-rose-500" />

            <div className="space-y-2">
              <h3 className="text-xl font-extrabold text-[var(--text-primary)]">
                Purge ALL Shop Documents?
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                This will permanently delete all completed and historical documents stored for shop{" "}
                <strong className="text-[var(--text-primary)]">{user?.shopName}</strong>. Active print jobs will remain protected.
              </p>
              <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-none text-xs text-rose-500 font-bold space-y-1">
                <p>⚠️ DANGER ZONE: This action is permanent and cannot be undone.</p>
                <p className="text-[var(--text-secondary)] font-normal">
                  All customer files uploaded to your counter will be erased from server disk storage.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-app)]">
              <button
                type="button"
                onClick={() => setShowDeleteAllModal(false)}
                disabled={isDeleting}
                className="h-11 px-4 rounded-none text-sm font-bold bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-app)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAll}
                disabled={isDeleting}
                className="h-11 px-5 rounded-none text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors flex items-center gap-2 cursor-pointer"
              >
                {isDeleting && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
                <span>Yes, Purge All Files</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW OVERLAY */}
      {previewDoc && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
          <div className="w-full max-w-6xl h-full max-h-[95vh] flex flex-col bg-[var(--bg-panel)] rounded-none border border-[var(--border-app)] overflow-hidden shadow-none relative animate-in zoom-in-95 duration-200 m-4 text-[var(--text-primary)]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-app)] bg-[var(--bg-surface)] shrink-0">
              <div className="flex items-center gap-3">
                <span className="shrink-0 inline-flex">
                  {getFileIcon(previewDoc.originalFileName, previewDoc.contentType)}
                </span>
                <div>
                  <h3 className="font-bold text-[var(--text-primary)] text-base truncate max-w-md">
                    {previewDoc.originalFileName}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                    {previewDoc.contentType || "Document Preview"} · {formatBytes(previewDoc.fileSize)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-none hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                aria-label="Close preview"
              >
                <MaterialIcon name="close" size={24} />
              </button>
            </div>

            <div className="flex-1 bg-[var(--bg-app)] flex items-center justify-center overflow-hidden relative">
              {isPreviewLoading && !previewError && (
                <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-3">
                  <MaterialIcon name="progress_activity" size={32} className="animate-spin text-[var(--color-accent)]" />
                  <p className="font-medium">Loading document securely...</p>
                </div>
              )}

              {previewError && (
                <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 max-w-sm text-center">
                  <MaterialIcon name="error" size={40} className="text-rose-500" />
                  <div>
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">Preview Failed</h3>
                    <p className="text-sm mt-1 text-[var(--text-secondary)]">
                      The document could not be rendered for preview. Please download it directly.
                    </p>
                  </div>
                  <button type="button" onClick={closePreview} className="btn-secondary mt-4 w-full cursor-pointer">
                    Close Preview
                  </button>
                </div>
              )}

              {!isPreviewLoading && !previewError && previewUrl && (() => {
                const isImage = (previewDoc.contentType || "").startsWith("image/");
                const isPdf = (previewDoc.contentType || "").includes("pdf") || previewDoc.originalFileName.toLowerCase().endsWith(".pdf");
                const isDocx = previewDoc.originalFileName.toLowerCase().endsWith(".docx") || (previewDoc.contentType || "").includes("officedocument.wordprocessingml");

                if (isImage) {
                  return (
                    <div className="w-full h-full p-8 flex items-center justify-center bg-[var(--bg-app)] overflow-auto">
                      <img
                        src={previewUrl}
                        alt={previewDoc.originalFileName}
                        className="max-w-full max-h-full object-contain rounded-none shadow-none"
                      />
                    </div>
                  );
                }

                if (isPdf) {
                  return (
                    <iframe
                      src={`${previewUrl}#toolbar=0&navpanes=0`}
                      className="w-full h-full border-none bg-white"
                      title={previewDoc.originalFileName}
                    />
                  );
                }

                if (isDocx && docxHtml !== null) {
                  return (
                    <div className="w-full h-full overflow-y-auto bg-[var(--bg-app)] p-4 sm:p-8 flex justify-center">
                      <div
                        className="bg-white p-8 sm:p-12 shadow-none max-w-4xl w-full min-h-full docx-preview-container text-[#111111] rounded-none border border-neutral-200"
                        dangerouslySetInnerHTML={{
                          __html: docxHtml || "<p>Empty document.</p>",
                        }}
                      />
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 max-w-sm text-center">
                    <MaterialIcon name="warning" size={40} className="text-amber-500" />
                    <div>
                      <h3 className="text-lg font-bold text-[var(--text-primary)]">Preview Not Available</h3>
                      <p className="text-sm mt-1 text-[var(--text-secondary)]">
                        This file type cannot be rendered inline in browser.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDownload(previewDoc, e)}
                      disabled={downloadingId === previewDoc?.id}
                      className="h-11 px-5 rounded-none font-bold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white flex items-center justify-center gap-2 mt-4 w-full cursor-pointer dark:text-black disabled:opacity-60"
                    >
                      <MaterialIcon name="download" size={20} className="mr-1" />
                      Download File
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
