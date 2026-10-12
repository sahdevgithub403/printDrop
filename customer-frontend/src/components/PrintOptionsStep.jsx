import React, { useEffect, useRef, useState } from "react";
import { calculatePrice } from "../api";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Edit2,
  Loader2,
  Sliders,
  X,
} from "lucide-react";

const PAGE_RANGE_RE = /^\d+(-\d+)?(,\s*\d+(-\d+)?)*$/;
const clampCopies = (n) => Math.min(100, Math.max(1, Number(n) || 1));

export const PrintOptionsStep = ({
  shopId,
  items,
  onItemsChange,
  onBack,
  onContinue,
}) => {
  const [editingItem, setEditingItem] = useState(null);
  const [editingSpecs, setEditingSpecs] = useState(null);
  const [editingPrice, setEditingPrice] = useState(null);
  const [isCalculatingEditPrice, setIsCalculatingEditPrice] = useState(false);
  const [rangeError, setRangeError] = useState(null);
  const priceGenRef = useRef(0);
  const editPriceGenRef = useRef(0);
  const editDebounceRef = useRef(null);

  // Default global settings bar
  const [defaultSpecs, setDefaultSpecs] = useState({
    printType: "PRINT",
    colorMode: "BW",
    paperSize: "A4",
    printSide: "SINGLE",
    pageRangeOption: "ALL",
    customPageRange: "",
    copies: 1,
  });

  useEffect(() => {
    // Initial pricing calculation for all items if needed
    const gen = ++priceGenRef.current;
    let cancelled = false;
    calculateAllPrices(items, gen, () => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  const calculateItemPrice = async (item, specs) => {
    if (!item.uploadedDocument) return null;
    try {
      const pageRangeStr =
        specs.pageRangeOption === "ALL" ? "ALL" : (specs.customPageRange || "").trim() || "ALL";
      const res = await calculatePrice({
        shopId,
        documentId: item.uploadedDocument.id,
        printType: specs.printType,
        colorMode: specs.colorMode,
        paperSize: specs.paperSize,
        printSide: specs.printSide,
        pageRange: pageRangeStr,
        copies: clampCopies(specs.copies),
      });
      return res;
    } catch (err) {
      console.error("Failed to calculate price for item:", item.localId, err);
      return null;
    }
  };

  const calculateAllPrices = async (targetItems, gen, isCancelled) => {
    const activeGen = gen ?? ++priceGenRef.current;
    const cancelled = isCancelled ?? (() => false);
    const withFlag = targetItems.map((item) =>
      item.uploadedDocument ? { ...item, isCalculatingPrice: true } : item,
    );
    onItemsChange(withFlag);

    // Limited concurrency (3), preserve order of results
    const CONCURRENCY = 3;
    const results = new Array(withFlag.length).fill(undefined);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= withFlag.length) return;
        const item = withFlag[idx];
        if (!item.uploadedDocument) {
          results[idx] = { pricing: item.pricing, isCalculatingPrice: false };
          continue;
        }
        const pricingRes = await calculateItemPrice(item, item.settings);
        results[idx] = { pricing: pricingRes ?? null, isCalculatingPrice: false };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, withFlag.length) }, () => worker()),
    );
    if (cancelled() || priceGenRef.current !== activeGen) return;

    onItemsChange((prev) =>
      prev.map((p) => {
        const idx = withFlag.findIndex((w) => w.localId === p.localId);
        if (idx === -1) return p;
        const r = results[idx];
        if (!r) return p;
        return {
          ...p,
          ...(r.pricing !== undefined ? { pricing: r.pricing } : {}),
          isCalculatingPrice: false,
        };
      }),
    );
  };

  const handleApplyToAll = async () => {
    // Merge only exposed default fields; preserve per-file customizations
    const { colorMode, paperSize, printSide, copies } = defaultSpecs;
    const merged = items.map((item) => ({
      ...item,
      settings: {
        ...item.settings,
        colorMode,
        paperSize,
        printSide,
        copies: clampCopies(copies),
      },
      pricing: null,
      isCalculatingPrice: true,
    }));
    onItemsChange(merged);

    const gen = ++priceGenRef.current;
    const CONCURRENCY = 3;
    const results = new Array(merged.length).fill(undefined);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= merged.length) return;
        const item = merged[idx];
        if (!item.uploadedDocument) {
          results[idx] = null;
          continue;
        }
        results[idx] = await calculateItemPrice(item, item.settings);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, merged.length) }, () => worker()),
    );
    if (priceGenRef.current !== gen) return;
    onItemsChange((prev) =>
      prev.map((p) => {
        const idx = merged.findIndex((m) => m.localId === p.localId);
        if (idx === -1) return p;
        const pricingRes = results[idx];
        return {
          ...p,
          ...(pricingRes ? { pricing: pricingRes } : { pricing: null }),
          isCalculatingPrice: false,
        };
      }),
    );
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setEditingSpecs({ ...item.settings });
    setEditingPrice(item.pricing || null);
    setRangeError(null);
  };

  useEffect(() => {
    if (!editingItem || !editingSpecs) return;
    const gen = ++editPriceGenRef.current;
    setIsCalculatingEditPrice(true);
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editDebounceRef.current = setTimeout(() => {
      fetchEditPrice(editingItem, editingSpecs, gen);
    }, 450);
    return () => {
      if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSpecs, editingItem?.localId]);

  const fetchEditPrice = async (item, specs, gen) => {
    const activeGen = gen ?? editPriceGenRef.current;
    setRangeError(null);

    if (specs.pageRangeOption === "CUSTOM") {
      const raw = (specs.customPageRange || "").trim();
      if (!raw) {
        setRangeError("Please enter a custom page range (e.g. 1-5, 8, 11-14).");
        setIsCalculatingEditPrice(false);
        return;
      }
      const pageCount = item.uploadedDocument?.pageCount || 1;
      const valid = validatePageRange(raw, pageCount);
      if (!valid.isValid) {
        if (editPriceGenRef.current !== activeGen) return;
        setRangeError(valid.message);
        setIsCalculatingEditPrice(false);
        return;
      }
    }

    const priceRes = await calculateItemPrice(item, specs);
    if (editPriceGenRef.current !== activeGen) return;
    if (priceRes) {
      setEditingPrice(priceRes);
    } else {
      setEditingPrice(null);
    }
    setIsCalculatingEditPrice(false);
  };

  const validatePageRange = (rangeStr, totalPages) => {
    try {
      const raw = (rangeStr || "").trim();
      if (!raw) {
        return { isValid: false, message: "Custom page range cannot be empty." };
      }
      if (!PAGE_RANGE_RE.test(raw)) {
        return { isValid: false, message: "Invalid page range format. Use e.g. 1-5, 8, 11-14." };
      }
      const parts = raw.split(",");
      for (const part of parts) {
        const p = part.trim();
        if (p.includes("-")) {
          const [startStr, endStr] = p.split("-");
          const start = parseInt(startStr.trim());
          const end = parseInt(endStr.trim());
          if (
            isNaN(start) ||
            isNaN(end) ||
            start < 1 ||
            end > totalPages ||
            start > end
          ) {
            return {
              isValid: false,
              message: `Page range must be between 1 and ${totalPages}`,
            };
          }
        } else if (p) {
          const num = parseInt(p);
          if (isNaN(num) || num < 1 || num > totalPages) {
            return {
              isValid: false,
              message: `Page number ${num} exceeds document total of ${totalPages}`,
            };
          }
        }
      }
      return { isValid: true, message: "" };
    } catch {
      return { isValid: false, message: "Invalid page range format" };
    }
  };

  const saveEditChanges = () => {
    if (!editingItem || !editingSpecs || rangeError) return;
    const updated = items.map((item) => {
      if (item.localId === editingItem.localId) {
        return {
          ...item,
          settings: { ...editingSpecs },
          pricing: editingPrice || item.pricing,
        };
      }
      return item;
    });
    onItemsChange(updated);
    setEditingItem(null);
    setEditingSpecs(null);
  };

  const calculateOrderTotal = () => {
    return items.reduce(
      (sum, item) => sum + (item.pricing?.totalPrice || 0),
      0,
    );
  };

  const isAnyCalculating = items.some((i) => i.isCalculatingPrice);
  const hasMissingPrice = items.some((i) => i.pricing == null);
  const canContinue = !isAnyCalculating && !hasMissingPrice && items.length > 0;

  return (
    <div className="space-y-8 pb-32">
      {/* Back Button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>Change files</span>
      </button>

      {/* Title */}
      <div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
          Print Specifications
        </h2>
        <p className="text-base text-[var(--text-secondary)] mt-2 font-medium">
          Set default options for all files or customize individual file
          settings.
        </p>
      </div>

      {/* Default Print Settings Section */}
      <div className="bg-[var(--bg-surface)] rounded-2xl p-6 border border-[var(--border-app)] space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5 pb-4 border-b border-[var(--border-app)] text-[var(--text-primary)]">
          <Sliders className="w-5 h-5 text-[var(--text-primary)]" />
          <span className="text-base font-extrabold">
            Default Print Settings
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Color Mode */}
          <div>
            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Color
            </label>
            <div className="grid grid-cols-2 gap-1 bg-[var(--bg-subtle)] p-1 rounded-xl border border-[var(--border-app)]">
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, colorMode: "BW" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.colorMode === "BW"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                B&W
              </button>
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, colorMode: "COLOR" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.colorMode === "COLOR"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Color
              </button>
            </div>
          </div>

          {/* Paper Size */}
          <div>
            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Paper
            </label>
            <div className="grid grid-cols-2 gap-1 bg-[var(--bg-subtle)] p-1 rounded-xl border border-[var(--border-app)]">
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, paperSize: "A4" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.paperSize === "A4"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                A4
              </button>
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, paperSize: "A3" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.paperSize === "A3"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                A3
              </button>
            </div>
          </div>

          {/* Print Side */}
          <div>
            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Sides
            </label>
            <div className="grid grid-cols-2 gap-1 bg-[var(--bg-subtle)] p-1 rounded-xl border border-[var(--border-app)]">
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, printSide: "SINGLE" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.printSide === "SINGLE"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({ ...defaultSpecs, printSide: "DOUBLE" })
                }
                className={`h-9 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  defaultSpecs.printSide === "DOUBLE"
                    ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Double
              </button>
            </div>
          </div>

          {/* Copies */}
          <div>
            <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5">
              Copies
            </label>
            <div className="flex items-center justify-between bg-[var(--bg-subtle)] p-1 rounded-xl border border-[var(--border-app)] h-11 px-2">
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({
                    ...defaultSpecs,
                    copies: clampCopies(defaultSpecs.copies - 1),
                  })
                }
                className="w-7 h-7 bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-md font-bold text-sm border border-[var(--border-app)] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                -
              </button>
              <span className="font-extrabold text-sm text-[var(--text-primary)]">
                {defaultSpecs.copies}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDefaultSpecs({
                    ...defaultSpecs,
                    copies: clampCopies(defaultSpecs.copies + 1),
                  })
                }
                className="w-7 h-7 bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-md font-bold text-sm border border-[var(--border-app)] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Apply to All Files Button below controls */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleApplyToAll}
            className="btn-primary h-12 px-6 text-xs font-bold uppercase tracking-wider w-full"
          >
            Apply to All Files
          </button>
        </div>
      </div>

      {/* Individual File Settings List */}
      <div className="space-y-4">
        <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
          Print Files ({items.length})
        </span>

        <div className="space-y-3">
          {items.map((item, idx) => {
            const doc = item.uploadedDocument;
            const fileName =
              doc?.originalFileName || item.file?.name || `File ${idx + 1}`;
            const pageCount = doc?.pageCount || 1;
            const price = item.pricing?.totalPrice;

            return (
              <div
                key={item.localId}
                className="bg-[var(--bg-surface)] rounded-2xl p-5 border border-[var(--border-app)] flex items-center justify-between gap-4 shadow-xs"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)] font-extrabold text-base">
                    {idx + 1}
                  </div>

                  <div className="min-w-0">
                    <p className="text-base font-bold text-[var(--text-primary)] truncate">
                      {fileName}
                    </p>
                    <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5 font-medium">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {item.settings.colorMode === "BW" ? "B&W" : "Color"} ·{" "}
                        {item.settings.paperSize} ·{" "}
                        {item.settings.printSide === "SINGLE"
                          ? "Single-sided"
                          : "Double-sided"}
                      </span>
                      <span>
                        {" "}
                        · {pageCount} {pageCount === 1 ? "page" : "pages"}
                      </span>
                      <span>
                        {" "}
                        · {item.settings.copies}{" "}
                        {item.settings.copies === 1 ? "copy" : "copies"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0 mt-3 sm:mt-0">
                  <div className="text-left sm:text-right">
                    <span className="text-xs font-bold text-[var(--text-secondary)] uppercase block sm:hidden">
                      Item Price
                    </span>
                    <span className="text-base font-extrabold text-[var(--text-primary)] block">
                      {item.isCalculatingPrice ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
                      ) : price != null ? (
                        `₹${price.toFixed(2)}`
                      ) : (
                        <span className="text-xs font-bold text-rose-500 dark:text-rose-300">price unavailable</span>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="btn-secondary h-11 px-4 text-xs font-bold flex items-center justify-center gap-1.5 w-full sm:w-auto"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit File Settings Drawer / Modal */}
      {editingItem && editingSpecs && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] rounded-2xl p-6 w-full max-w-lg border border-[var(--border-app)] shadow-2xl space-y-6 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border-app)]">
              <div>
                <h3 className="text-xl font-extrabold text-[var(--text-primary)]">
                  Customize Print File
                </h3>
                <p className="text-sm font-medium text-[var(--text-secondary)] truncate max-w-xs mt-0.5">
                  {editingItem.uploadedDocument?.originalFileName ||
                    editingItem.file?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Color Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Color Output
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() =>
                    setEditingSpecs({ ...editingSpecs, colorMode: "BW" })
                  }
                  className={`selection-row min-h-[56px] ${editingSpecs.colorMode === "BW" ? "selection-row-active" : ""}`}
                >
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Black & White
                  </span>
                  {editingSpecs.colorMode === "BW" && (
                    <Check className="w-5 h-5 text-[var(--text-primary)]" />
                  )}
                </div>
                <div
                  onClick={() =>
                    setEditingSpecs({ ...editingSpecs, colorMode: "COLOR" })
                  }
                  className={`selection-row min-h-[56px] ${editingSpecs.colorMode === "COLOR" ? "selection-row-active" : ""}`}
                >
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Full Color
                  </span>
                  {editingSpecs.colorMode === "COLOR" && (
                    <Check className="w-5 h-5 text-[var(--text-primary)]" />
                  )}
                </div>
              </div>
            </div>

            {/* Paper Size & Sides */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Paper Size
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSpecs({ ...editingSpecs, paperSize: "A4" })
                    }
                    className={`h-11 rounded-xl border text-sm font-bold cursor-pointer transition-all ${
                      editingSpecs.paperSize === "A4"
                        ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] border-[var(--pill-active-bg)] shadow-xs"
                        : "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-app)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    A4
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSpecs({ ...editingSpecs, paperSize: "A3" })
                    }
                    className={`h-11 rounded-xl border text-sm font-bold cursor-pointer transition-all ${
                      editingSpecs.paperSize === "A3"
                        ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] border-[var(--pill-active-bg)] shadow-xs"
                        : "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-app)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    A3
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Sides
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSpecs({ ...editingSpecs, printSide: "SINGLE" })
                    }
                    className={`h-11 rounded-xl border text-sm font-bold cursor-pointer transition-all ${
                      editingSpecs.printSide === "SINGLE"
                        ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] border-[var(--pill-active-bg)] shadow-xs"
                        : "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-app)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSpecs({ ...editingSpecs, printSide: "DOUBLE" })
                    }
                    className={`h-11 rounded-xl border text-sm font-bold cursor-pointer transition-all ${
                      editingSpecs.printSide === "DOUBLE"
                        ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)] border-[var(--pill-active-bg)] shadow-xs"
                        : "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-app)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    Double
                  </button>
                </div>
              </div>
            </div>

            {/* Page Range */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Page Range
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() =>
                    setEditingSpecs({
                      ...editingSpecs,
                      pageRangeOption: "ALL",
                      customPageRange: "",
                    })
                  }
                  className={`selection-row min-h-[56px] ${editingSpecs.pageRangeOption === "ALL" ? "selection-row-active" : ""}`}
                >
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    All ({editingItem.uploadedDocument?.pageCount} pgs)
                  </span>
                  {editingSpecs.pageRangeOption === "ALL" && (
                    <Check className="w-5 h-5 text-[var(--text-primary)]" />
                  )}
                </div>
                <div
                  onClick={() =>
                    setEditingSpecs({
                      ...editingSpecs,
                      pageRangeOption: "CUSTOM",
                    })
                  }
                  className={`selection-row min-h-[56px] ${editingSpecs.pageRangeOption === "CUSTOM" ? "selection-row-active" : ""}`}
                >
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Custom Range
                  </span>
                  {editingSpecs.pageRangeOption === "CUSTOM" && (
                    <Check className="w-5 h-5 text-[var(--text-primary)]" />
                  )}
                </div>
              </div>

              {editingSpecs.pageRangeOption === "CUSTOM" && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={editingSpecs.customPageRange}
                    onChange={(e) =>
                      setEditingSpecs({
                        ...editingSpecs,
                        customPageRange: e.target.value,
                      })
                    }
                    placeholder="e.g. 1-5, 8, 11-14"
                    className="input-field"
                  />

                  {rangeError && (
                    <p className="text-xs font-bold text-rose-500 dark:text-rose-300 mt-1">
                      {rangeError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Copies */}
            <div className="bg-[var(--bg-elevated)] p-4 rounded-xl border border-[var(--border-app)] flex items-center justify-between">
              <span className="text-base font-bold text-[var(--text-primary)]">Copies</span>
              <div className="flex items-center gap-3 bg-[var(--bg-surface)] p-1 rounded-lg border border-[var(--border-app)]">
                <button
                  type="button"
                  onClick={() =>
                    setEditingSpecs({
                      ...editingSpecs,
                      copies: clampCopies(editingSpecs.copies - 1),
                    })
                  }
                  className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] font-bold text-base flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  -
                </button>
                <span className="w-6 text-center font-extrabold text-base text-[var(--text-primary)]">
                  {editingSpecs.copies}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingSpecs({
                      ...editingSpecs,
                      copies: clampCopies(editingSpecs.copies + 1),
                    })
                  }
                  className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] font-bold text-base flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            {/* Price Preview & Save Action */}
            <div className="pt-4 border-t border-[var(--border-app)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex justify-between items-center sm:block">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase block">
                  Item Price
                </span>
                <span className="text-2xl font-extrabold text-[var(--text-primary)]">
                  {isCalculatingEditPrice ? (
                    <Loader2 className="w-5 h-5 animate-spin inline text-[var(--text-muted)]" />
                  ) : (
                    `₹${editingPrice?.totalPrice ? editingPrice.totalPrice.toFixed(2) : "0.00"}`
                  )}
                </span>
              </div>

              <button
                type="button"
                disabled={isCalculatingEditPrice || !!rangeError}
                onClick={saveEditChanges}
                className="btn-primary w-full sm:w-auto min-w-[160px] h-14 font-bold text-base"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Bar (Overall Order Total Sum) */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--bg-surface)] border-t border-[var(--border-app)] p-4 sm:p-5 z-40 shadow-lg">
        <div className="max-w-xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex justify-between items-center sm:block">
            <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
              Order Total ({items.length} files)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
                ₹{calculateOrderTotal().toFixed(2)}
              </span>
              {isAnyCalculating && (
                <Loader2 className="w-4 h-4 text-[var(--text-muted)] animate-spin" />
              )}
            </div>
            {hasMissingPrice && !isAnyCalculating && (
              <p className="text-xs font-bold text-rose-500 dark:text-rose-300 mt-1">
                Price unavailable for one or more files — edit options or retry.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={!canContinue}
            onClick={onContinue}
            className="btn-primary w-full sm:w-auto sm:min-w-[200px] h-14 flex items-center justify-center"
          >
            <span className="hidden sm:inline">
              Review Order · ₹{calculateOrderTotal().toFixed(2)}
            </span>
            <span className="sm:hidden">Review Order</span>
            <ArrowRight className="w-5 h-5 ml-2" />
          </button>
        </div>
      </div>
    </div>
  );
};
