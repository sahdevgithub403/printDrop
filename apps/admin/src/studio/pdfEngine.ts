"use client";
/* PDF engine: pdf.js for rendering, pdf-lib for lossless page ops + export.
 * All annotation/crop coordinates live in the DISPLAYED frame (PDF points,
 * top-left origin, including the page's extra rotation). Export maps them
 * back to unrotated page space (exact for 90-degree steps). */

import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, degrees, rgb, PDFName, StandardFonts } from "pdf-lib";

// PDF.js worker served same-origin (/pdf.worker.min.mjs, copied verbatim from
// the installed pdfjs-dist package into public/) so rendering works on http://,
// in Electron, and in the packaged app with no CDN dependency. The original
// Vite build inlined the worker as a blob via the `?worker&inline` import
// suffix, which webpack/Next.js does not support — hence the same-origin file.
// All downstream logic (loadPdfDocument/renderPdfPage/exportEditedPdf) is
// unchanged.
let workerReady = false;
let workerTried = false;
async function ensureWorker() {
  if (workerTried) return workerReady;
  workerTried = true;
  try {
    if (typeof window === "undefined") {
      console.error("Studio: PDF worker unavailable during server rendering.");
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      workerReady = true;
    }
  } catch (err: any) {
    console.error("Studio: worker init failed:", err?.message || err);
    workerReady = false;
  }
  return workerReady;
}

export async function loadPdfDocument(data) {
  await ensureWorker();
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer?.() ?? data);
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  } catch (err: any) {
    if (!workerReady || /worker/i.test(err?.message || "")) {
      throw new Error("PDF renderer failed to initialize on this machine.");
    }
    throw err;
  }
  return { pdf, numPages: pdf.numPages, bytes };
}

export async function renderPdfPage(pdf, pageNumber1Based, canvas, scale, totalRotationDeg) {
  const page = await pdf.getPage(pageNumber1Based);
  const viewport = page.getViewport({ scale, rotation: totalRotationDeg || 0 });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return { width: viewport.width, height: viewport.height };
}

/* Rotation composition: pdf.js viewport rotation and pdf-lib setRotation
 * both take the TOTAL rotation (embedded /Rotate + user extra). */
export function totalRotation(embeddedDeg, extraDeg) {
  return (((embeddedDeg || 0) + (extraDeg || 0)) % 360 + 360) % 360;
}
export function displayedSize(W, H, rot) {
  const r = ((rot % 360) + 360) % 360;
  return r === 90 || r === 270 ? { w: H, h: W } : { w: W, h: H };
}

export function toUnrotated(px, py, rot, W, H) {
  const r = ((rot % 360) + 360) % 360;
  if (r === 90) return { x: py, y: H - px };
  if (r === 180) return { x: W - px, y: H - py };
  if (r === 270) return { x: W - py, y: px };
  return { x: px, y: py };
}

export function unrotateRect(rect, rot, W, H) {
  const a = toUnrotated(rect.x, rect.y, rot, W, H);
  const b = toUnrotated(rect.x + rect.w, rect.y + rect.h, rot, W, H);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function hexToRgb(hex, fallback = "#111111") {
  const h = String(hex || fallback).replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  if (Number.isNaN(n)) return rgb(0.07, 0.07, 0.07);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawAnnotationOnPage(page, font, ann, colorFor?: any) {
  const c = hexToRgb(ann.color);
  const t = ann.type;
  if (t === "text" && ann.text) {
    page.drawText(String(ann.text).slice(0, 500), {
      x: ann.x,
      y: ann.y,
      size: Math.max(6, ann.size || 14),
      font,
      color: c,
      maxWidth: ann.maxWidth,
    });
  } else if (t === "highlight") {
    page.drawRectangle({
      x: ann.x, y: ann.y, width: ann.w, height: ann.h,
      color: c, opacity: 0.35, borderWidth: 0,
    });
  } else if (t === "rect") {
    page.drawRectangle({
      x: ann.x, y: ann.y, width: ann.w, height: ann.h,
      borderColor: c, borderWidth: ann.width || 2,
    });
  } else if (t === "ellipse") {
    page.drawEllipse({
      x: ann.x + ann.w / 2, y: ann.y + ann.h / 2,
      xScale: Math.abs(ann.w) / 2, yScale: Math.abs(ann.h) / 2,
      borderColor: c, borderWidth: ann.width || 2,
    });
  } else if (t === "line" || t === "arrow") {
    page.drawLine({
      start: { x: ann.x1, y: ann.y1 },
      end: { x: ann.x2, y: ann.y2 },
      thickness: ann.width || 2, color: c,
    });
    if (t === "arrow") {
      const ang = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
      const head = Math.max(8, (ann.width || 2) * 5);
      for (const s of [-1, 1]) {
        page.drawLine({
          start: { x: ann.x2, y: ann.y2 },
          end: {
            x: ann.x2 - head * Math.cos(ang + (s * Math.PI) / 7),
            y: ann.y2 - head * Math.sin(ang + (s * Math.PI) / 7),
          },
          thickness: ann.width || 2, color: c,
        });
      }
    }
  } else if (t === "pen" && Array.isArray(ann.points) && ann.points.length > 1) {
    const d = ann.points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    page.drawSvgPath(d, { borderColor: c, borderWidth: ann.width || 2 });
  }
}

/* Map a displayed-frame annotation to the final rotated page frame.
 * Final page rotation == displayed rotation, so coordinates transfer 1:1 —
 * only the PDF y-flip (top-left -> bottom-left origin) is required. */
function flipRectForPdf(r, pageH) {
  return { x: r.x, y: pageH - r.y - r.h, w: r.w, h: r.h };
}

/* Export: returns Uint8Array of the edited PDF.
 * state = { pageOrder:[origIdx...], rotations:{origIdx:extraDeg}, annotations:[...], crops:{origIdx:rect} }
 * geom = { sizes:{origIdx:{w,h}} (unrotated), embedded:{origIdx:deg} }.
 * The displayed frame uses total rotation, and the exported page is set to
 * the same total — so displayed coordinates transfer with only a y-flip. */
export async function exportEditedPdf(sourceBytes, state, geom) {
  const sizes = geom?.sizes || {};
  const embedded = geom?.embedded || {};
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  for (const origIdx of state.pageOrder) {
    const [copied] = await out.copyPages(src, [origIdx]);
    const media = sizes[origIdx];
    if (!media) throw new Error("Missing page geometry; re-open the document and retry.");
    const total = totalRotation(embedded[origIdx], state.rotations?.[origIdx]);

    copied.setRotation(degrees(total));

    // Crop (displayed frame -> unrotated CropBox).
    const crop = state.crops?.[origIdx];
    if (crop && crop.w > 2 && crop.h > 2) {
      const u = unrotateRect(crop, total, media.w, media.h);
      const cx = Math.max(0, u.x);
      const cy = Math.max(0, u.y);
      const cw = Math.min(media.w - cx, u.w);
      const ch = Math.min(media.h - cy, u.h);
      if (cw > 4 && ch > 4) {
        // CropBox in unrotated user space, bottom-left origin.
        copied.node.set(
          PDFName.of("CropBox"),
          out.context.obj([cx, media.h - cy - ch, cx + cw, media.h - cy])
        );
      }
    }

    out.addPage(copied);

    // Annotations for this page (displayed frame == final frame).
    const disp = displayedSize(media.w, media.h, total);
    for (const ann of state.annotations || []) {
      if (ann.page !== origIdx) continue;
      const mapped = { ...ann };
      const flipY = (y) => disp.h - y;
      if (ann.type === "text") {
        mapped.y = flipY(ann.y) - (ann.size || 14);
        mapped.maxWidth = Math.max(20, disp.w - ann.x - 4);
      } else if (["highlight", "rect", "ellipse"].includes(ann.type)) {
        Object.assign(mapped, flipRectForPdf(ann, disp.h));
      } else if (ann.type === "line" || ann.type === "arrow") {
        mapped.y1 = flipY(ann.y1);
        mapped.y2 = flipY(ann.y2);
      } else if (ann.type === "pen") {
        mapped.points = (ann.points || []).map(([x, y]) => [x, flipY(y)]);
      } else {
        continue;
      }
      drawAnnotationOnPage(copied, font, mapped);
    }
  }

  if (out.getPageCount() === 0) {
    throw new Error("The edited copy has no pages left to export.");
  }
  return out.save();
}

/* Capture unrotated mediabox sizes + embedded rotation for every page. */
export async function capturePageGeometry(pdf, numPages) {
  const sizes = {};
  const embedded = {};
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    // page.view is the raw MediaBox in unrotated user space.
    const view = page.view;
    sizes[i - 1] = { w: view[2] - view[0], h: view[3] - view[1] };
    embedded[i - 1] = ((page.rotate || 0) % 360 + 360) % 360;
    page.cleanup();
  }
  return { sizes, embedded };
}
