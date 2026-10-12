import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  MoveHorizontal,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Type,
  Highlighter,
  Square,
  Circle,
  ArrowRight,
  PenLine,
  Crop,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Sun,
  Contrast,
  Palette,
  Image as ImageIcon,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  Eye,
  EyeOff,
  Save,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileWarning,
  X,
} from "lucide-react";
import {
  getAdminOrder,
  fetchDocumentBytes,
  uploadEditedCopy,
  swapItemDocument,
} from "../api";
import {
  loadPdfDocument,
  renderPdfPage,
  exportEditedPdf,
  capturePageGeometry,
  displayedSize,
  totalRotation,
} from "../studio/pdfEngine";
import {
  loadImageFromBlob,
  applyPhotoOps,
  canvasToBlob,
} from "../studio/photoEngine";
import { PAPER_SIZES_MM, composePhotoSheets } from "../studio/photoSheet";
import { parseStudioHash } from "../studio/studioRoute";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const detectKind = (doc) => {
  const ct = String(doc?.contentType || "").toLowerCase();
  const fn = String(doc?.originalFileName || "").toLowerCase();
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("image/") || /\.(jpg|jpeg|png)$/.test(fn)) return "photo";
  return "unsupported";
};

const editedNameFor = (name, ext) => {
  const base = String(name || "document").replace(/\.[^.]+$/, "") || "document";
  return `${base} (edited).${ext}`;
};

const snapshotOf = (s) => JSON.parse(JSON.stringify({
  pageOrder: s.pageOrder,
  rotations: s.rotations,
  annotations: s.annotations,
  crops: s.crops,
  photoOps: s.photoOps,
  adjust: s.adjust,
}));

export const DocumentStudioPage = () => {
  const route = useMemo(() => parseStudioHash(window.location.hash), []);
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [order, setOrder] = useState(null);
  const [item, setItem] = useState(null);
  const [doc, setDoc] = useState(null);
  const [kind, setKind] = useState(null);

  // Source media (never mutated)
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [geom, setGeom] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [photoImg, setPhotoImg] = useState(null);
  const [photoMime, setPhotoMime] = useState("image/png");

  // Edit state (PDF)
  const [pageOrder, setPageOrder] = useState([]);
  const [rotations, setRotations] = useState({});
  const [annotations, setAnnotations] = useState([]);
  const [crops, setCrops] = useState({});
  const [curPos, setCurPos] = useState(0);
  const [selectedAnnId, setSelectedAnnId] = useState(null);
  // Edit state (photo)
  const [photoOps, setPhotoOps] = useState([]);

  // History (op descriptors only — no binary duplication)
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [, forceHist] = useState(0);

  // View
  const [tool, setTool] = useState("select");
  const [panelTab, setPanelTab] = useState("tools"); // tools | layout
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState("width"); // width | page | custom
  const [showOverlay, setShowOverlay] = useState(true);
  const [toolColor, setToolColor] = useState("#e11d48");
  const [toolWidth, setToolWidth] = useState(3);
  const [toolText, setToolText] = useState("");
  const [toolTextSize, setToolTextSize] = useState(16);
  const [cropAspect, setCropAspect] = useState("free");
  const [adjust, setAdjust] = useState({ brightness: 1, contrast: 1, saturate: 1, grayscale: false, bw: false });
  const [resizeW, setResizeW] = useState("");
  const [exportFormat, setExportFormat] = useState("png");
  const [layout, setLayout] = useState({
    paper: "A4", orientation: "portrait", marginMm: 10, spacingMm: 3,
    perSheet: 1, fit: "fit",
  });

  // Save flow
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedDoc, setSavedDoc] = useState(null);
  const [swapping, setSwapping] = useState(false);
  const [swapDone, setSwapDone] = useState(false);
  const [swapError, setSwapError] = useState("");

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef(null);

  /* ---------------- load ---------------- */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!route) {
        setLoadError("Missing order or document reference in the URL.");
        setPhase("error");
        return;
      }
      try {
        const ord = await getAdminOrder(route.orderId);
        if (cancelled) return;
        const it = (ord.items || []).find((i) => String(i.id) === String(route.itemId));
        if (!it) throw new Error("Order item not found.");
        const d = it.document;
        if (!d?.id) throw new Error("This order item has no document attached.");
        const k = detectKind(d);
        setOrder(ord);
        setItem(it);
        setDoc(d);
        setKind(k);
        if (k === "unsupported") {
          setPhase("ready");
          return;
        }
        const blob = await fetchDocumentBytes(d.id);
        if (cancelled) return;
        if (k === "pdf") {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const { pdf, numPages: n } = await loadPdfDocument(bytes);
          if (cancelled) return;
          const g = await capturePageGeometry(pdf, n);
          if (cancelled) return;
          setPdfDoc(pdf);
          setPdfBytes(bytes);
          setGeom(g);
          setNumPages(n);
          setPageOrder(Array.from({ length: n }, (_, i) => i));
          setCurPos(0);
          const ct = String(d.contentType || "").toLowerCase();
          if (ct.includes("pdf")) setExportFormat("pdf");
        } else {
          const img = await loadImageFromBlob(blob);
          if (cancelled) return;
          setPhotoImg(img);
          const ct = String(d.contentType || "").toLowerCase();
          const fn = String(d.originalFileName || "").toLowerCase();
          const isJpeg = ct.includes("jpeg") || ct.includes("jpg") || fn.endsWith(".jpg") || fn.endsWith(".jpeg");
          setPhotoMime(isJpeg ? "image/jpeg" : "image/png");
          setExportFormat(isJpeg ? "jpeg" : "png");
        }
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("Studio load failed:", err);
        const status = err.response?.status;
        setLoadError(
          status === 401 ? "Your session expired. Please log in again."
          : status === 403 ? "You are not authorized to edit this document."
          : status === 404 ? "Order or document not found."
          : (err.message || "Could not load the document.")
        );
        setPhase("error");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [route?.orderId, route?.itemId]);

  /* ---------------- history ---------------- */
  const commit = useCallback((mutator) => {
    const before = snapshotOf({ pageOrder, rotations, annotations, crops, photoOps, adjust });
    const draft = JSON.parse(JSON.stringify(before));
    mutator(draft);
    pastRef.current.push(before);
    if (pastRef.current.length > 60) pastRef.current.shift();
    futureRef.current = [];
    setPageOrder(draft.pageOrder);
    setRotations(draft.rotations);
    setAnnotations(draft.annotations);
    setCrops(draft.crops);
    setPhotoOps(draft.photoOps);
    setAdjust(draft.adjust);
    setSelectedAnnId(null);
    setDirty(true);
    forceHist((n) => n + 1);
  }, [pageOrder, rotations, annotations, crops, photoOps, adjust]);

  // Checkpoint slider-driven adjustments (they apply live without ops).
  const checkpoint = useCallback(() => {
    pastRef.current.push(snapshotOf({ pageOrder, rotations, annotations, crops, photoOps, adjust }));
    if (pastRef.current.length > 60) pastRef.current.shift();
    futureRef.current = [];
    setDirty(true);
    forceHist((n) => n + 1);
  }, [pageOrder, rotations, annotations, crops, photoOps, adjust]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(snapshotOf({ pageOrder, rotations, annotations, crops, photoOps, adjust }));
    setPageOrder(prev.pageOrder);
    setRotations(prev.rotations);
    setAnnotations(prev.annotations);
    setCrops(prev.crops);
    setPhotoOps(prev.photoOps);
    setAdjust(prev.adjust || { brightness: 1, contrast: 1, saturate: 1, grayscale: false, bw: false });
    setSelectedAnnId(null);
    setDirty(true);
    forceHist((n) => n + 1);
  }, [pageOrder, rotations, annotations, crops, photoOps, adjust]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(snapshotOf({ pageOrder, rotations, annotations, crops, photoOps, adjust }));
    setPageOrder(next.pageOrder);
    setRotations(next.rotations);
    setAnnotations(next.annotations);
    setCrops(next.crops);
    setPhotoOps(next.photoOps);
    setAdjust(next.adjust || { brightness: 1, contrast: 1, saturate: 1, grayscale: false, bw: false });
    setSelectedAnnId(null);
    setDirty(true);
    forceHist((n) => n + 1);
  }, [pageOrder, rotations, annotations, crops, photoOps, adjust]);

  /* ---------------- dirty guard ---------------- */
  const goBack = useCallback(() => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    try { sessionStorage.setItem("studioReturnOrder", route?.orderId || ""); } catch {}
    window.location.hash = "";
  }, [dirty, route]);

  useEffect(() => {
    const handler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ---------------- PDF render ---------------- */
  const curOrigIdx = pageOrder.length ? pageOrder[Math.min(curPos, pageOrder.length - 1)] : 0;
  const curTotalRot = geom ? totalRotation(geom.embedded?.[curOrigIdx], rotations[curOrigIdx]) : 0;
  const [dispPts, setDispPts] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (kind !== "pdf" || !pdfDoc || !geom || !pageOrder.length) return;
    let cancelled = false;
    const render = async () => {
      try {
        const wrap = wrapRef.current;
        const availW = wrap ? wrap.clientWidth - 48 : 700;
        let scale = zoom;
        if (fitMode === "width") {
          const probe = await pdfDoc.getPage(curOrigIdx + 1);
          const v = probe.getViewport({ scale: 1, rotation: curTotalRot });
          probe.cleanup();
          scale = availW / v.width;
        } else if (fitMode === "page") {
          const probe = await pdfDoc.getPage(curOrigIdx + 1);
          const v = probe.getViewport({ scale: 1, rotation: curTotalRot });
          probe.cleanup();
          const availH = wrap ? wrap.clientHeight - 48 : 800;
          scale = Math.min(availW / v.width, availH / v.height);
        }
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { width, height } = await renderPdfPage(pdfDoc, curOrigIdx + 1, canvas, scale, curTotalRot);
        if (cancelled) return;
        setDispPts({ w: width / scale, h: height / scale });
      } catch (err) {
        console.error("PDF render failed:", err);
      }
    };
    render();
    return () => { cancelled = true; };
  }, [kind, pdfDoc, geom, pageOrder, curPos, curOrigIdx, curTotalRot, zoom, fitMode, rotations]);

  /* ---------------- photo pipeline ---------------- */
  const [photoCanvas, setPhotoCanvas] = useState(null);
  const photoDataUrl = useMemo(
    () => (photoCanvas ? photoCanvas.toDataURL() : null),
    [photoCanvas]
  );
  useEffect(() => {
    if (kind !== "photo" || !photoImg) return;
    const t = setTimeout(() => {
      try {
        const withAdjust = [...photoOps];
        const a = adjust;
        if (a.brightness !== 1 || a.contrast !== 1 || a.saturate !== 1 || a.grayscale || a.bw) {
          withAdjust.push({
            type: "adjust", brightness: a.brightness, contrast: a.contrast,
            saturate: a.saturate, grayscale: a.grayscale, bw: a.bw,
          });
        }
        setPhotoCanvas(applyPhotoOps(photoImg, withAdjust));
      } catch (err) {
        console.error("Photo pipeline failed:", err);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [kind, photoImg, photoOps, adjust]);

  const pushPhotoOp = useCallback((op) => {
    commit((d) => { d.photoOps = [...d.photoOps, op]; });
  }, [commit]);

  /* ---------------- overlay pointer (PDF annotations + crop) ---------------- */
  const toPdfPts = useCallback((clientX, clientY) => {
    const svg = overlayRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * dispPts.w,
      y: ((clientY - r.top) / r.height) * dispPts.h,
    };
  }, [dispPts]);

  const onOverlayPointerDown = useCallback((e) => {
    if (kind !== "pdf" || panelTab !== "tools") return;
    const svg = overlayRef.current;
    if (svg) svg.setPointerCapture?.(e.pointerId);
    const p = toPdfPts(e.clientX, e.clientY);
    if (tool === "select") {
      const pageAnns = annotations.filter((a) => a.page === curOrigIdx);
      const hit = [...pageAnns].reverse().find((a) => {
        if (a.type === "text") {
          return p.x >= a.x - 4 && p.x <= a.x + 220 && p.y >= a.y - 4 && p.y <= a.y + (a.size || 14) + 8;
        }
        if (a.type === "line" || a.type === "arrow" || a.type === "pen") {
          const pts = a.type === "pen" ? (a.points || []) : [[a.x1, a.y1], [a.x2, a.y2]];
          return pts.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 10);
        }
        return p.x >= Math.min(a.x, a.x + a.w) - 4 && p.x <= Math.max(a.x, a.x + a.w) + 4
          && p.y >= Math.min(a.y, a.y + a.h) - 4 && p.y <= Math.max(a.y, a.y + a.h) + 4;
      });
      setSelectedAnnId(hit ? hit.id : null);
      if (hit) dragRef.current = { mode: "move", id: hit.id, start: p, orig: { ...hit } };
      return;
    }
    if (tool === "crop") {
      dragRef.current = { mode: "crop", start: p, cur: p };
      forceHist((n) => n + 1);
      return;
    }
    if (["highlight", "rect", "ellipse", "arrow", "pen"].includes(tool)) {
      dragRef.current = { mode: "draw", start: p, cur: p, points: tool === "pen" ? [[p.x, p.y]] : null };
      forceHist((n) => n + 1);
      return;
    }
    if (tool === "text") {
      const text = toolText.trim() || "Note";
      commit((d) => {
        d.annotations = [...d.annotations, {
          id: uid(), page: curOrigIdx, type: "text", x: p.x, y: p.y,
          text, size: toolTextSize, color: toolColor,
        }];
      });
    }
  }, [kind, panelTab, tool, annotations, curOrigIdx, toPdfPts, toolText, toolTextSize, toolColor, commit]);

  const onOverlayPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toPdfPts(e.clientX, e.clientY);
    if (drag.mode === "move") {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      setAnnotations((prev) => prev.map((a) => {
        if (a.id !== drag.id) return a;
        const o = drag.orig;
        if (a.type === "text") return { ...a, x: o.x + dx, y: o.y + dy };
        if (a.type === "line" || a.type === "arrow") {
          return { ...a, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
        }
        if (a.type === "pen") {
          return { ...a, points: (o.points || []).map(([x, y]) => [x + dx, y + dy]) };
        }
        return { ...a, x: o.x + dx, y: o.y + dy };
      }));
    } else {
      drag.cur = p;
      if (drag.mode === "draw" && drag.points) drag.points.push([p.x, p.y]);
      forceHist((n) => n + 1);
    }
  }, [toPdfPts]);

  const onOverlayPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.mode === "select" || !drag.start || !drag.cur) return;
    const s = drag.start;
    const c = drag.cur;
    const x = Math.min(s.x, c.x);
    const y = Math.min(s.y, c.y);
    const w = Math.abs(c.x - s.x);
    const h = Math.abs(c.y - s.y);
    if (drag.mode === "crop") {
      if (w < 8 || h < 8) return;
      let rect = { x, y, w, h };
      if (cropAspect && cropAspect !== "free") {
        const [aw, ah] = cropAspect.split(":").map(Number);
        const target = aw / ah;
        if (rect.w / Math.max(rect.h, 1e-6) > target) {
          const nw = rect.h * target;
          rect = { ...rect, x: rect.x + (rect.w - nw) / 2, w: nw };
        } else {
          const nh = rect.w / target;
          rect = { ...rect, y: rect.y + (rect.h - nh) / 2, h: nh };
        }
      }
      commit((d) => { d.crops = { ...d.crops, [curOrigIdx]: rect }; });
      setTool("select");
      return;
    }
    if (drag.mode === "draw") {
      if (tool === "pen") {
        if (!drag.points || drag.points.length < 2) return;
        commit((d) => {
          d.annotations = [...d.annotations, {
            id: uid(), page: curOrigIdx, type: "pen",
            points: drag.points, color: toolColor, width: toolWidth,
          }];
        });
      } else {
        if (w < 6 || h < 6) return;
        const map = { highlight: "highlight", rect: "rect", ellipse: "ellipse", arrow: "arrow" };
        commit((d) => {
          const base = { id: uid(), page: curOrigIdx, color: toolColor, width: toolWidth };
          if (tool === "arrow") {
            d.annotations = [...d.annotations, { ...base, type: "arrow", x1: s.x, y1: s.y, x2: c.x, y2: c.y }];
          } else if (tool === "highlight") {
            d.annotations = [...d.annotations, { ...base, type: "highlight", x, y, w, h }];
          } else {
            d.annotations = [...d.annotations, { ...base, type: map[tool], x, y, w, h }];
          }
        });
      }
      return;
    }
    // move: commit once
    commit((d) => {
      d.annotations = annotations.map((a) => ({ ...a }));
    });
  }, [tool, toolColor, toolWidth, curOrigIdx, annotations, cropAspect, commit]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnId && tool === "select") {
        const tag = String(e.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        commit((d) => { d.annotations = d.annotations.filter((a) => a.id !== selectedAnnId); });
        setSelectedAnnId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAnnId, tool, commit]);

  /* ---------------- photo crop overlay ---------------- */
  const [cropDrag, setCropDrag] = useState(null);
  const photoBoxRef = useRef(null);
  const toPhotoFrac = useCallback((clientX, clientY) => {
    const el = photoBoxRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }, []);

  const applyAspect = (rect, aspect) => {
    if (!aspect || aspect === "free") return rect;
    const [aw, ah] = aspect.split(":").map(Number);
    const target = aw / ah;
    let { x, y, w, h } = rect;
    const cur = w / Math.max(h, 1e-6);
    if (cur > target) {
      const nw = h * target;
      x += (w - nw) / 2;
      w = nw;
    } else {
      const nh = w / target;
      y += (h - nh) / 2;
      h = nh;
    }
    return { x, y, w, h };
  };

  // Rotate-all (layout panel) implemented through real per-page rotations.
  useEffect(() => {
    const handler = () => {
      commit((d) => {
        const next = { ...d.rotations };
        for (const idx of d.pageOrder) {
          next[idx] = ((next[idx] || 0) + 90) % 360;
        }
        d.rotations = next;
      });
    };
    window.addEventListener("studio:rotate-all", handler);
    return () => window.removeEventListener("studio:rotate-all", handler);
  }, [commit]);

  /* ---------------- export + save ---------------- */
  const exportBytes = useCallback(async () => {
    if (kind === "pdf") {
      if (!pdfBytes || !geom) throw new Error("PDF not loaded yet.");
      const out = await exportEditedPdf(pdfBytes, { pageOrder, rotations, annotations, crops }, geom);
      return { bytes: out, mime: "application/pdf", ext: "pdf" };
    }
    if (!photoCanvas) throw new Error("Photo not rendered yet.");
    if (panelTab === "layout" && layout.perSheet > 1) {
      // N-up grid always fits on exactly one sheet by construction.
      const { sheets } = composePhotoSheets(photoCanvas, layout);
      const blob = await canvasToBlob(sheets[0], exportFormat === "jpeg" ? "image/jpeg" : "image/png", 0.92);
      const buf = new Uint8Array(await blob.arrayBuffer());
      return { bytes: buf, mime: blob.type, ext: blob.type.includes("jpeg") ? "jpg" : "png" };
    }
    const blob = await canvasToBlob(photoCanvas, exportFormat === "jpeg" ? "image/jpeg" : "image/png", 0.92);
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { bytes: buf, mime: blob.type, ext: blob.type.includes("jpeg") ? "jpg" : "png" };
  }, [kind, pdfBytes, geom, pageOrder, rotations, annotations, crops, photoCanvas, panelTab, layout, exportFormat]);

  const handleDownloadLocal = useCallback(async () => {
    try {
      const { bytes, mime, ext } = await exportBytes();
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = editedNameFor(doc?.originalFileName, ext);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setSaveError(err.message || "Export failed.");
    }
  }, [exportBytes, doc]);

  const handleSaveCopy = useCallback(async () => {
    setSaving(true);
    setSaveError("");
    setSavedDoc(null);
    try {
      const { bytes, mime, ext } = await exportBytes();
      const file = new File([bytes], editedNameFor(doc?.originalFileName, ext), { type: mime });
      const saved = await uploadEditedCopy(file, doc?.id);
      setSavedDoc(saved);
      setDirty(false);
    } catch (err) {
      console.error("Save edited copy failed:", err);
      setSaveError(err.response?.data?.message || err.message || "Could not save the edited copy. Your edits are preserved — try again.");
    } finally {
      setSaving(false);
    }
  }, [exportBytes, doc]);

  const handleUseForPrinting = useCallback(async () => {
    if (!savedDoc?.id || !item?.id) return;
    setSwapping(true);
    setSwapError("");
    try {
      const updated = await swapItemDocument(order.id, item.id, savedDoc.id);
      setOrder(updated);
      const freshItem = (updated.items || []).find((i) => String(i.id) === String(item.id));
      if (freshItem) setItem(freshItem);
      setSwapDone(true);
    } catch (err) {
      console.error("Use-for-printing failed:", err);
      setSwapError(err.response?.data?.message || err.message || "Could not switch the print version.");
    } finally {
      setSwapping(false);
    }
  }, [savedDoc, item, order]);

  const printLocked = order && (order.paymentStatus === "PAID" || order.printStatus === "PRINTING");

  /* ---------------- render helpers ---------------- */
  const pdfTools = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "text", label: "Text", icon: Type },
    { id: "highlight", label: "Highlight", icon: Highlighter },
    { id: "rect", label: "Rectangle", icon: Square },
    { id: "ellipse", label: "Ellipse", icon: Circle },
    { id: "arrow", label: "Arrow", icon: ArrowRight },
    { id: "pen", label: "Draw", icon: PenLine },
    { id: "crop", label: "Crop", icon: Crop },
  ];
  const photoTools = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "crop", label: "Crop", icon: Crop },
    { id: "text", label: "Text", icon: Type },
    { id: "rect", label: "Shape", icon: Square },
    { id: "arrow", label: "Arrow", icon: ArrowRight },
    { id: "pen", label: "Draw", icon: PenLine },
  ];

  const pageAnns = annotations.filter((a) => a.page === curOrigIdx);
  const previewDrag = dragRef.current && (dragRef.current.mode === "draw" || dragRef.current.mode === "crop")
    ? dragRef.current : null;

  if (phase === "loading") {
    return (
      <div className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--text-secondary)]" />
        <span className="ml-3 text-sm text-[var(--text-secondary)]">Opening Document Studio…</span>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <FileWarning className="w-10 h-10 text-[var(--color-error-text)] mx-auto" />
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Could not open the editor</h2>
          <p className="text-sm text-[var(--text-secondary)]">{loadError}</p>
          <button type="button" onClick={() => { window.location.hash = ""; }}
            className="btn-secondary mx-auto">
            <ArrowLeft className="w-4 h-4" /> Back to orders
          </button>
        </div>
      </div>
    );
  }

  if (kind === "unsupported") {
    return (
      <div className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <FileWarning className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Editing not supported</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            “{doc?.originalFileName}” is a {String(doc?.contentType || "document")} file.
            Document Studio edits PDF, JPG and PNG files. Word documents can still be
            previewed and printed unchanged from the order.
          </p>
          <button type="button" onClick={goBack} className="btn-secondary mx-auto">
            <ArrowLeft className="w-4 h-4" /> Back to order
          </button>
        </div>
      </div>
    );
  }

  const tools = kind === "pdf" ? pdfTools : photoTools;

  return (
    <div data-testid="studio-root" className="h-screen w-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col overflow-hidden">
      {/* Top toolbar */}
      <header className="flex items-center gap-3 px-4 h-14 shrink-0 bg-[var(--bg-surface)]">
        <button type="button" onClick={goBack} title="Back to order"
          className="btn-icon-ghost" aria-label="Back to order">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-bold truncate leading-tight" title={doc?.originalFileName}>
            {doc?.originalFileName}
            {dirty && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" title="Unsaved changes" />}
          </p>
          <p className="text-[11px] text-[var(--text-secondary)] leading-tight">
            {kind === "pdf" ? `PDF · ${pageOrder.length} page${pageOrder.length === 1 ? "" : "s"}` : `Photo · ${photoCanvas ? `${photoCanvas.width}×${photoCanvas.height}` : ""}`}
            {" · "}Order #{order?.orderNumber}
          </p>
        </div>

        <div className="flex-1" />

        {/* History + zoom */}
        <div className="hidden md:flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!pastRef.current.length} title="Undo"
            className="btn-icon-ghost disabled:opacity-40" aria-label="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={redo} disabled={!futureRef.current.length} title="Redo"
            className="btn-icon-ghost disabled:opacity-40" aria-label="Redo">
            <Redo2 className="w-4 h-4" />
          </button>
          {kind === "pdf" && (
            <>
              <span className="w-px h-5 bg-[var(--border-app)] mx-1" />
              <button type="button" onClick={() => { setFitMode("custom"); setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2))); }}
                className="btn-icon-ghost" aria-label="Zoom out"><ZoomOut className="w-4 h-4" /></button>
              <span className="text-xs font-semibold w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => { setFitMode("custom"); setZoom((z) => Math.min(4, +(z + 0.1).toFixed(2))); }}
                className="btn-icon-ghost" aria-label="Zoom in"><ZoomIn className="w-4 h-4" /></button>
              <button type="button" onClick={() => setFitMode("page")} title="Fit to page"
                className="btn-icon-ghost" style={fitMode === "page" ? { color: "var(--color-accent)" } : undefined} aria-label="Fit to page">
                <Maximize className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setFitMode("width")} title="Fit to width"
                className="btn-icon-ghost" style={fitMode === "width" ? { color: "var(--color-accent)" } : undefined} aria-label="Fit to width">
                <MoveHorizontal className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        <div className="flex-1 md:hidden" />

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowOverlay((v) => !v)} title="Toggle annotation preview"
            className="btn-icon-ghost" aria-label="Toggle preview">
            {showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button type="button" onClick={handleSaveCopy} disabled={saving}
            className="btn-primary-sm cursor-pointer disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saving ? "Saving…" : "Save Edited Copy"}</span>
          </button>
          <button type="button" onClick={handleDownloadLocal} title="Download export to this computer"
            className="btn-icon-ghost" aria-label="Download export">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Save status strip */}
      {(saveError || savedDoc) && (
        <div className={`px-4 py-2 text-xs font-medium flex items-center gap-2 shrink-0 ${
          saveError ? "bg-[var(--color-error-bg)] text-[var(--color-error-text)]"
          : "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"}`}>
          {saveError ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          <span className="flex-1">
            {saveError || (
              <>Saved “{savedDoc.originalFileName}” ({savedDoc.pageCount} pg). Original untouched.</>
            )}
          </span>
          {!saveError && savedDoc && (
            printLocked ? (
              <span className="font-semibold">Printing locked — order {order?.paymentStatus === "PAID" ? "already paid" : "is printing"}.</span>
            ) : (
              <button type="button" onClick={handleUseForPrinting} disabled={swapping || swapDone}
                className="font-bold underline underline-offset-2 cursor-pointer disabled:no-underline">
                {swapDone ? "✓ Now printing this version" : swapping ? "Switching…" : "Use this version for printing"}
              </button>
            )
          )}
          {swapError && <span className="font-semibold">{swapError}</span>}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Left panel */}
        <nav className="w-[76px] shrink-0 py-3 flex flex-col items-center gap-1 overflow-y-auto">
          <div className="flex rounded-none bg-[var(--bg-surface)] p-1 mb-1 border border-[var(--border-app)]">
            {(["tools", "layout"]).map((t) => (
              <button key={t} type="button" onClick={() => setPanelTab(t)}
                className={`px-2 py-1 rounded-none text-[11px] font-bold capitalize cursor-pointer ${
                  panelTab === t ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                }`}>
                {t}
              </button>
            ))}
          </div>
          {(panelTab === "tools" ? tools : [{ id: "__layout", label: "Layout", icon: LayoutGrid }]).map((t) => {
            const Icon = t.icon;
            const active = panelTab === "tools" ? tool === t.id : true;
            return (
              <button key={t.id} type="button"
                onClick={() => { if (panelTab === "tools") setTool(t.id); }}
                title={t.label}
                className={`w-14 py-2 rounded-none flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors cursor-pointer border ${
                  active ? "bg-[var(--bg-elevated)] border-[var(--border-app)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                }`}>
                <Icon className="w-[18px] h-[18px]" />
                <span>{t.label}</span>
              </button>
            );
          })}
          {kind === "pdf" && panelTab === "tools" && (
            <div className="mt-2 w-full px-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] text-center mb-1">Pages</p>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {pageOrder.map((origIdx, pos) => (
                  <button key={`${origIdx}-${pos}`} type="button"
                    onClick={() => setCurPos(pos)}
                    title={`Page ${pos + 1}${rotations[origIdx] ? ` · rotated ${rotations[origIdx]}°` : ""}${crops[origIdx] ? " · cropped" : ""}`}
                    className={`w-full h-8 rounded-none text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                      pos === curPos ? "bg-[var(--color-accent)] text-white dark:text-black"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    }`}>
                    {pos + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Canvas */}
        <div ref={wrapRef} className="flex-1 min-w-0 overflow-auto bg-[var(--bg-elevated)] relative">
          {kind === "pdf" ? (
            <div className="min-h-full flex flex-col items-center py-6 px-6">
              <div className="flex items-center gap-2 mb-3">
                <button type="button" disabled={curPos <= 0} onClick={() => setCurPos((p) => Math.max(0, p - 1))}
                  className="btn-icon-ghost disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs font-semibold tabular-nums">
                  {pageOrder.length ? `${Math.min(curPos + 1, pageOrder.length)} / ${pageOrder.length}` : "—"}
                </span>
                <button type="button" disabled={curPos >= pageOrder.length - 1}
                  onClick={() => setCurPos((p) => Math.min(pageOrder.length - 1, p + 1))}
                  className="btn-icon-ghost disabled:opacity-40" aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
                {panelTab === "tools" && (
                  <span className="flex items-center gap-1 ml-2">
                    <button type="button" title="Rotate page left" aria-label="Rotate page left"
                      onClick={() => commit((d) => { d.rotations[curOrigIdx] = ((d.rotations[curOrigIdx] || 0) - 90 + 360) % 360; })}
                      className="btn-icon-ghost"><RotateCcw className="w-4 h-4" /></button>
                    <button type="button" title="Rotate page right" aria-label="Rotate page right"
                      onClick={() => commit((d) => { d.rotations[curOrigIdx] = ((d.rotations[curOrigIdx] || 0) + 90) % 360; })}
                      className="btn-icon-ghost"><RotateCw className="w-4 h-4" /></button>
                    <button type="button" title="Move page earlier" aria-label="Move page earlier"
                      onClick={() => { if (curPos <= 0) return; commit((d) => { const a = [...d.pageOrder]; const [p] = a.splice(curPos, 1); a.splice(curPos - 1, 0, p); d.pageOrder = a; }); setCurPos((p) => p - 1); }}
                      className="btn-icon-ghost"><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" title="Move page later" aria-label="Move page later"
                      onClick={() => { if (curPos >= pageOrder.length - 1) return; commit((d) => { const a = [...d.pageOrder]; const [p] = a.splice(curPos, 1); a.splice(curPos + 1, 0, p); d.pageOrder = a; }); setCurPos((p) => p + 1); }}
                      className="btn-icon-ghost"><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" title="Duplicate page" aria-label="Duplicate page"
                      onClick={() => { commit((d) => { const a = [...d.pageOrder]; a.splice(curPos + 1, 0, curOrigIdx); d.pageOrder = a; }); }}
                      className="btn-icon-ghost"><Copy className="w-4 h-4" /></button>
                    <button type="button" title="Delete page from edited copy" aria-label="Delete page"
                      disabled={pageOrder.length <= 1}
                      onClick={() => { commit((d) => { d.pageOrder = d.pageOrder.filter((_, i) => i !== curPos); }); setCurPos((p) => Math.max(0, p - 1)); }}
                      className="btn-icon-ghost disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                    {crops[curOrigIdx] && (
                      <button type="button" title="Remove crop" aria-label="Remove crop"
                        onClick={() => commit((d) => { const c = { ...d.crops }; delete c[curOrigIdx]; d.crops = c; })}
                        className="text-[11px] font-bold text-[var(--color-error-text)] hover:underline cursor-pointer ml-1">
                        Clear crop
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="relative" style={{ touchAction: "none" }}>
                <canvas ref={canvasRef} className="block max-w-full bg-white" />
                {showOverlay && dispPts.w > 0 && (
                  <svg
                    ref={overlayRef}
                    viewBox={`0 0 ${dispPts.w} ${dispPts.h}`}
                    className="absolute inset-0 w-full h-full"
                    style={{ cursor: tool === "select" ? "default" : "crosshair" }}
                    onPointerDown={onOverlayPointerDown}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                  >
                    {pageAnns.map((a) => (
                      <AnnotationShape key={a.id} ann={a} selected={a.id === selectedAnnId} />
                    ))}
                    {previewDrag && previewDrag.start && previewDrag.cur && (
                      <PreviewRect drag={previewDrag} tool={tool} color={toolColor} />
                    )}
                    {tool === "crop" && crops[curOrigIdx] && (
                      <rect x={crops[curOrigIdx].x} y={crops[curOrigIdx].y} width={crops[curOrigIdx].w} height={crops[curOrigIdx].h}
                        fill="none" stroke="#22C55E" strokeWidth={2 / Math.max(zoom, 0.2)} strokeDasharray="6 4" />
                    )}
                  </svg>
                )}
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                {tool === "select" ? "Click an annotation to select · drag to move · Del removes it."
                : tool === "crop" ? "Drag a crop rectangle on the page."
                : tool === "text" ? "Click on the page to place text."
                : "Drag on the page to draw."}
              </p>
            </div>
          ) : (
            /* Photo canvas */
            <div className="min-h-full flex flex-col items-center justify-center py-6 px-6">
              <div
                ref={photoBoxRef}
                className="relative bg-white"
                style={{ touchAction: "none", maxWidth: "100%" }}
                onPointerDown={(e) => {
                  if (tool !== "crop" && tool !== "text" && !["rect", "ellipse", "arrow", "pen"].includes(tool)) return;
                  const el = photoBoxRef.current;
                  if (!el) return;
                  el.setPointerCapture?.(e.pointerId);
                  const f = toPhotoFrac(e.clientX, e.clientY);
                  if (tool === "text") {
                    const text = toolText.trim() || "Note";
                    pushPhotoOp({ type: "text", x: f.x, y: f.y, text, size: toolTextSize / 100, color: toolColor });
                    return;
                  }
                  setCropDrag({ start: f, cur: f, points: tool === "pen" ? [[f.x, f.y]] : null });
                }}
                onPointerMove={(e) => {
                  setCropDrag((prev) => {
                    if (!prev) return prev;
                    if (tool === "pen" && prev.points) {
                      return { ...prev, cur: toPhotoFrac(e.clientX, e.clientY), points: [...prev.points, [toPhotoFrac(e.clientX, e.clientY).x, toPhotoFrac(e.clientX, e.clientY).y]] };
                    }
                    return { ...prev, cur: toPhotoFrac(e.clientX, e.clientY) };
                  });
                }}
                onPointerUp={() => {
                  setCropDrag((prev) => {
                    if (!prev) return prev;
                    const finish = (rect) => {
                      if (tool === "crop") {
                        const r = applyAspect(rect, cropAspect === "free" ? null : cropAspect);
                        if (r.w > 0.01 && r.h > 0.01) pushPhotoOp({ type: "crop", ...r });
                        setTool("select");
                      } else if (tool === "pen") {
                        if (prev.points && prev.points.length > 1) {
                          pushPhotoOp({ type: "pen", points: prev.points, color: toolColor, width: toolWidth / 100 });
                        }
                      } else {
                        const x = Math.min(prev.start.x, prev.cur.x);
                        const y = Math.min(prev.start.y, prev.cur.y);
                        const ww = Math.abs(prev.cur.x - prev.start.x);
                        const hh = Math.abs(prev.cur.y - prev.start.y);
                        if (ww > 0.01 && hh > 0.01) {
                          if (tool === "arrow") pushPhotoOp({ type: "arrow", x, y, w: prev.cur.x - prev.start.x, h: prev.cur.y - prev.start.y, color: toolColor, width: toolWidth / 100 });
                          else pushPhotoOp({ type: tool, x, y, w: ww, h: hh, color: toolColor, width: toolWidth / 100 });
                        }
                      }
                    };
                    finish();
                    return null;
                  });
                }}
              >
                {photoDataUrl && (
                  <img
                    src={photoDataUrl}
                    alt="Edited preview"
                    className="block max-w-full max-h-[70vh] select-none"
                    draggable={false}
                  />
                )}
                {tool === "crop" && cropDrag && (
                  <CropOverlay drag={cropDrag} aspect={cropAspect} />
                )}
                {(["rect", "ellipse", "arrow", "pen"].includes(tool)) && cropDrag && (
                  <ShapeOverlay drag={cropDrag} tool={tool} color={toolColor} />
                )}
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                {tool === "crop" ? "Drag a crop rectangle · aspect applies on release."
                : tool === "text" ? "Click on the photo to place text."
                : ["rect", "ellipse", "arrow", "pen"].includes(tool) ? "Drag on the photo to draw."
                : "Adjustments apply live · every edit is undoable."}
              </p>
            </div>
          )}
        </div>

        {/* Right contextual panel */}
        <aside className="w-60 shrink-0 overflow-y-auto p-4 space-y-5 bg-[var(--bg-surface)] hidden lg:block">
          {panelTab === "layout" ? (
            <LayoutPanel kind={kind} layout={layout} setLayout={setLayout} photoCanvas={photoCanvas} />
          ) : (
            <>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Style</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {["#e11d48", "#111111", "#2563eb", "#16a34a", "#d97706", "#ffffff"].map((c) => (
                    <button key={c} type="button" onClick={() => setToolColor(c)} aria-label={`Color ${c}`}
                      className={`w-6 h-6 rounded-none border cursor-pointer ${toolColor === c ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30" : "border-black/20"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <label className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">
                  Stroke width: {toolWidth}px
                  <input type="range" min={1} max={12} value={toolWidth}
                    onChange={(e) => setToolWidth(Number(e.target.value))} className="w-full mt-1" />
                </label>
              </div>
              {(tool === "text") && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Text</p>
                  <textarea value={toolText} onChange={(e) => setToolText(e.target.value)} rows={3}
                    placeholder="Type annotation text, then click on the document"
                    className="w-full text-sm rounded-none border border-[var(--border-app)] bg-[var(--bg-input)] p-2 outline-none focus:border-[var(--color-accent)]" />
                  <label className="mt-2 block text-[11px] font-semibold text-[var(--text-secondary)]">
                    Size: {toolTextSize}{kind === "photo" ? "% of width" : "pt"}
                    <input type="range" min={kind === "photo" ? 2 : 8} max={kind === "photo" ? 20 : 48} value={toolTextSize}
                      onChange={(e) => setToolTextSize(Number(e.target.value))} className="w-full mt-1" />
                  </label>
                </div>
              )}
              {tool === "crop" && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Crop aspect</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["free", "1:1", "4:3", "3:2", "16:9"].map((a) => (
                      <button key={a} type="button" onClick={() => setCropAspect(a)}
                        className={`px-2.5 py-1 rounded-none text-xs font-bold cursor-pointer border ${
                          cropAspect === a ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--border-app)] text-[var(--text-secondary)]"
                        }`}>{a}</button>
                    ))}
                  </div>
                  {kind === "pdf" && <p className="mt-2 text-[11px] text-[var(--text-muted)]">Crop applies to the exported PDF page.</p>}
                </div>
              )}
              {kind === "photo" && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Adjust</p>
                  {[
                    ["brightness", "Brightness", 0.4, 1.8, 0.01, adjust.brightness],
                    ["contrast", "Contrast", 0.4, 1.8, 0.01, adjust.contrast],
                    ["saturate", "Saturation", 0, 2, 0.01, adjust.saturate],
                  ].map(([key, label, min, max, step, val]) => (
                    <label key={key} className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-2">
                      {label}: {Number(val).toFixed(2)}
                      <input type="range" min={min} max={max} step={step} value={val}
                        onChange={(e) => { setAdjust((a) => ({ ...a, [key]: Number(e.target.value) })); setDirty(true); }}
                        onPointerUp={checkpoint} onKeyUp={checkpoint} onBlur={checkpoint}
                        onDoubleClick={() => { setAdjust((a) => ({ ...a, [key]: 1 })); setDirty(true); }}
                        className="w-full mt-1" />
                    </label>
                  ))}
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => { commit((d) => { d.photoOps = [...d.photoOps, { type: "adjust", grayscale: true }]; }); }}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer">Grayscale</button>
                    <button type="button" onClick={() => { commit((d) => { d.photoOps = [...d.photoOps, { type: "adjust", bw: true }]; }); }}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer">B&amp;W</button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" title="Rotate left" onClick={() => pushPhotoOp({ type: "rotate", dir: -1 })}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer inline-flex items-center justify-center gap-1">
                      <RotateCcw className="w-3.5 h-3.5" /> Left</button>
                    <button type="button" title="Rotate right" onClick={() => pushPhotoOp({ type: "rotate", dir: 1 })}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer inline-flex items-center justify-center gap-1">
                      <RotateCw className="w-3.5 h-3.5" /> Right</button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" title="Flip horizontal" onClick={() => pushPhotoOp({ type: "flip", axis: "h" })}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer inline-flex items-center justify-center gap-1">
                      <FlipHorizontal2 className="w-3.5 h-3.5" /> Flip H</button>
                    <button type="button" title="Flip vertical" onClick={() => pushPhotoOp({ type: "flip", axis: "v" })}
                      className="flex-1 px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer inline-flex items-center justify-center gap-1">
                      <FlipVertical2 className="w-3.5 h-3.5" /> Flip V</button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input value={resizeW} onChange={(e) => setResizeW(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Width px"
                      className="w-full text-xs rounded-none border border-[var(--border-app)] bg-[var(--bg-input)] px-2 py-1.5 outline-none" inputMode="numeric" />
                    <button type="button"
                      onClick={() => {
                        const w = parseInt(resizeW, 10);
                        if (!w || !photoCanvas) return;
                        const h = Math.round((photoCanvas.height * w) / photoCanvas.width);
                        pushPhotoOp({ type: "resize", w: Math.min(6000, w), h: Math.min(6000, h) });
                        setResizeW(""); setResizeH("");
                      }}
                      className="px-2.5 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer">Resize</button>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Resize keeps aspect ratio{photoCanvas ? ` (now ${photoCanvas.width}×${photoCanvas.height})` : ""}.</p>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

/* ---------- SVG annotation shapes (displayed-frame PDF points) ---------- */
const AnnotationShape = ({ ann, selected }) => {
  const sel = selected ? { stroke: "#2563eb", strokeWidth: 1.5, strokeDasharray: "4 3" } : {};
  const common = { style: { pointerEvents: "none" } };
  if (ann.type === "text") {
    return (
      <g {...common}>
        <text x={ann.x} y={(ann.y || 0) + (ann.size || 14)} fontSize={ann.size || 14} fill={ann.color || "#111111"} fontWeight={600}
          fontFamily="Inter, system-ui, sans-serif">{ann.text}</text>
        {selected && <rect x={ann.x - 3} y={ann.y - 3} width={Math.max(60, String(ann.text || "").length * ((ann.size || 14) * 0.6))} height={(ann.size || 14) + 10} fill="none" {...sel} />}
      </g>
    );
  }
  if (ann.type === "highlight") {
    return <rect x={ann.x} y={ann.y} width={ann.w} height={ann.h} fill={ann.color || "#facc15"} opacity={0.35} {...common} />;
  }
  if (ann.type === "rect") {
    return <rect x={ann.x} y={ann.y} width={ann.w} height={ann.h} fill="none" stroke={ann.color} strokeWidth={ann.width || 2} {...common} />;
  }
  if (ann.type === "ellipse") {
    return <ellipse cx={ann.x + ann.w / 2} cy={ann.y + ann.h / 2} rx={Math.abs(ann.w) / 2} ry={Math.abs(ann.h) / 2}
      fill="none" stroke={ann.color} strokeWidth={ann.width || 2} {...common} />;
  }
  if (ann.type === "line" || ann.type === "arrow") {
    const ang = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
    const head = 10;
    return (
      <g {...common}>
        <line x1={ann.x1} y1={ann.y1} x2={ann.x2} y2={ann.y2} stroke={ann.color} strokeWidth={ann.width || 2} strokeLinecap="round" />
        {ann.type === "arrow" && (
          <polygon
            points={`${ann.x2},${ann.y2} ${ann.x2 - head * Math.cos(ang - Math.PI / 7)},${ann.y2 - head * Math.sin(ang - Math.PI / 7)} ${ann.x2 - head * Math.cos(ang + Math.PI / 7)},${ann.y2 - head * Math.sin(ang + Math.PI / 7)}`}
            fill={ann.color} />
        )}
      </g>
    );
  }
  if (ann.type === "pen" && Array.isArray(ann.points) && ann.points.length > 1) {
    const d = ann.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    return <path d={d} fill="none" stroke={ann.color} strokeWidth={ann.width || 2} strokeLinecap="round" strokeLinejoin="round" {...common} />;
  }
  return null;
};

const PreviewRect = ({ drag, tool, color }) => {
  if (!drag?.start || !drag?.cur) return null;
  const x = Math.min(drag.start.x, drag.cur.x);
  const y = Math.min(drag.start.y, drag.cur.y);
  const w = Math.abs(drag.cur.x - drag.start.x);
  const h = Math.abs(drag.cur.y - drag.start.y);
  if (tool === "crop") {
    return <rect x={x} y={y} width={w} height={h} fill="rgba(34,197,94,0.08)" stroke="#22C55E" strokeWidth={2} strokeDasharray="6 4" />;
  }
  if (tool === "pen" && drag.points?.length > 1) {
    const d = drag.points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ");
    return <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />;
  }
  return <rect x={x} y={y} width={w} height={h} fill={tool === "highlight" ? color : "none"} fillOpacity={0.35}
    stroke={color} strokeWidth={tool === "highlight" ? 0 : 2} strokeDasharray={tool === "arrow" ? "none" : undefined} />;
};

const CropOverlay = ({ drag, aspect }) => {
  if (!drag) return null;
  let r = {
    x: Math.min(drag.start.x, drag.cur.x),
    y: Math.min(drag.start.y, drag.cur.y),
    w: Math.abs(drag.cur.x - drag.start.x),
    h: Math.abs(drag.cur.y - drag.start.y),
  };
  if (aspect && aspect !== "free") {
    const [aw, ah] = aspect.split(":").map(Number);
    const t = aw / ah;
    if (r.w / Math.max(r.h, 1e-6) > t) {
      const nw = r.h * t;
      r = { ...r, x: r.x + (r.w - nw) / 2, w: nw };
    } else {
      const nh = r.w / t;
      r = { ...r, y: r.y + (r.h - nh) / 2, h: nh };
    }
  }
  return (
    <div className="absolute pointer-events-none" style={{
      left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
      boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", border: "2px solid #22C55E",
    }} />
  );
};

const ShapeOverlay = ({ drag, tool, color }) => {
  if (!drag) return null;
  if (tool === "pen" && drag.points?.length > 1) {
    const d = drag.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x * 100},${y * 100}`).join(" ");
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const r = {
    x: Math.min(drag.start.x, drag.cur.x),
    y: Math.min(drag.start.y, drag.cur.y),
    w: Math.abs(drag.cur.x - drag.start.x),
    h: Math.abs(drag.cur.y - drag.start.y),
  };
  return (
    <div className="absolute pointer-events-none border-2"
      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderColor: color }} />
  );
};

const LayoutPanel = ({ kind, layout, setLayout, photoCanvas }) => {
  const set = (patch) => setLayout((l) => ({ ...l, ...patch }));
  const sheetInfo = (() => {
    if (kind !== "photo" || !photoCanvas || layout.perSheet <= 1) return null;
    try {
      const { pageCount } = composePhotoSheets(photoCanvas, layout);
      return `${pageCount} sheet${pageCount === 1 ? "" : "s"}`;
    } catch {
      return null;
    }
  })();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Paper</p>
        <div className="flex gap-1.5 flex-wrap">
          {Object.keys(PAPER_SIZES_MM).map((p) => (
            <button key={p} type="button" onClick={() => set({ paper: p })}
              className={`px-2.5 py-1 rounded-none text-xs font-bold border cursor-pointer ${
                layout.paper === p ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--border-app)] text-[var(--text-secondary)]"}`}>{p}</button>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          {(["portrait", "landscape"]).map((o) => (
            <button key={o} type="button" onClick={() => set({ orientation: o })}
              className={`flex-1 px-2 py-1 rounded-none text-xs font-bold border capitalize cursor-pointer ${
                layout.orientation === o ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--border-app)] text-[var(--text-secondary)]"}`}>{o}</button>
          ))}
        </div>
      </div>
      {kind === "photo" ? (
        <>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Images per sheet</p>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 2, 4, 6, 8].map((n) => (
                <button key={n} type="button" onClick={() => set({ perSheet: n })}
                  className={`px-2.5 py-1 rounded-none text-xs font-bold border cursor-pointer ${
                    layout.perSheet === n ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--border-app)] text-[var(--text-secondary)]"}`}>{n}</button>
              ))}
            </div>
            {sheetInfo && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Export produces {sheetInfo}.</p>}
          </div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
            Fit
            <select value={layout.fit} onChange={(e) => set({ fit: e.target.value })}
              className="mt-1 w-full text-xs rounded-none border border-[var(--border-app)] bg-[var(--bg-input)] px-2 py-1.5 outline-none">
              <option value="fit">Fit inside cell</option>
              <option value="fill">Fill cell (crop overflow)</option>
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
            Margin: {layout.marginMm}mm
            <input type="range" min={0} max={25} value={layout.marginMm}
              onChange={(e) => set({ marginMm: Number(e.target.value) })} className="w-full mt-1" />
          </label>
          <p className="text-[10px] text-[var(--text-muted)]">Sheet export applies on Save when more than 1 image per sheet. Printer driver settings still apply at print time.</p>
        </>
      ) : (
        <>
          <p className="text-[11px] text-[var(--text-secondary)]">
            PDF pages keep their original size; use Rotate and Crop per page. Paper and margins are handled by the printer driver at print time.
          </p>
          <button type="button"
            onClick={() => {
              // Rotate-all is a real op implemented through per-page rotations.
              window.dispatchEvent(new CustomEvent("studio:rotate-all"));
            }}
            className="w-full px-2 py-1.5 rounded-none text-xs font-bold border border-[var(--border-app)] cursor-pointer">
            Rotate all pages 90°
          </button>
        </>
      )}
    </div>
  );
};
