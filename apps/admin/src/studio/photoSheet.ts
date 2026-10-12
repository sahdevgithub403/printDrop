"use client";
/* Photo sheet composer for N-up print layouts.
 * Composes the edited photo onto paper sheets at print resolution.
 * Pure function of (imageCanvas, layout) — used for preview AND export,
 * so the preview is exactly what gets saved. */

export const PAPER_SIZES_MM = {
  A4: { w: 210, h: 297, label: "A4" },
  A3: { w: 297, h: 420, label: "A3" },
  LETTER: { w: 215.9, h: 279.4, label: "Letter" },
};

const DPI = 200;
const MM_TO_PX = DPI / 25.4;

export function sheetPixelSize(paperKey, orientation) {
  const p = PAPER_SIZES_MM[paperKey] || PAPER_SIZES_MM.A4;
  const wMm = orientation === "landscape" ? p.h : p.w;
  const hMm = orientation === "landscape" ? p.w : p.h;
  return { w: Math.round(wMm * MM_TO_PX), h: Math.round(hMm * MM_TO_PX) };
}

/* Grid for N-up: returns {cols, rows} that best fits N cells. */
export function gridForCount(n) {
  const c = Math.ceil(Math.sqrt(n));
  const r = Math.ceil(n / c);
  return { cols: c, rows: r };
}

/* Compose sheets. Returns { sheets:[canvas...], perSheet, pageCount }.
 * fit: "fit" (contain) | "fill" (cover, crops overflow). */
export function composePhotoSheets(imageCanvas, layout) {
  const {
    paper = "A4",
    orientation = "portrait",
    marginMm = 10,
    spacingMm = 3,
    perSheet = 1,
    fit = "fit",
    background = "#ffffff",
  } = layout || {};
  const { w: sheetW, h: sheetH } = sheetPixelSize(paper, orientation);
  const margin = Math.round(marginMm * MM_TO_PX);
  const spacing = Math.round(spacingMm * MM_TO_PX);
  const { cols, rows } = gridForCount(Math.max(1, perSheet));
  const cellsPerSheet = cols * rows;

  const sheets: HTMLCanvasElement[] = [];
  // One source image repeated to fill the requested cells across sheets.
  const totalCells = Math.max(1, perSheet);
  const sheetCount = Math.ceil(totalCells / cellsPerSheet);
  let placed = 0;

  for (let s = 0; s < sheetCount; s++) {
    const sheet = document.createElement("canvas");
    sheet.width = sheetW;
    sheet.height = sheetH;
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, sheetW, sheetH);

    const areaW = sheetW - margin * 2;
    const areaH = sheetH - margin * 2;
    const cellW = (areaW - spacing * (cols - 1)) / cols;
    const cellH = (areaH - spacing * (rows - 1)) / rows;
    const iw = imageCanvas.width;
    const ih = imageCanvas.height;

    for (let r = 0; r < rows && placed < totalCells; r++) {
      for (let c = 0; c < cols && placed < totalCells; c++) {
        const cx = margin + c * (cellW + spacing);
        const cy = margin + r * (cellH + spacing);
        let dw = cellW;
        let dh = (cellW * ih) / iw;
        if (fit === "fill") {
          if (dh < cellH) {
            dh = cellH;
            dw = (cellH * iw) / ih;
          }
        } else if (dh > cellH) {
          dh = cellH;
          dw = (cellH * iw) / ih;
        }
        const dx = cx + (cellW - dw) / 2;
        const dy = cy + (cellH - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cellW, cellH);
        ctx.clip();
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imageCanvas, dx, dy, dw, dh);
        ctx.restore();
        placed++;
      }
    }
    sheets.push(sheet);
  }
  return { sheets, perSheet: cellsPerSheet, pageCount: sheets.length };
}
