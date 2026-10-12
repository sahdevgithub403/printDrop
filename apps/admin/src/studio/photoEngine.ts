"use client";
/* Photo editing pipeline — pure functions over canvases.
 * Ops apply strictly in order; each op consumes the previous canvas output,
 * so geometry ops (crop/rotate/…) naturally transform earlier annotations.
 * No binary data is stored in history: ops are small JSON descriptors. */

export const createCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image file"));
    };
    img.src = url;
  });
}

export function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(8, width * 4);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx, op, W, H) {
  const x = op.x * W;
  const y = op.y * H;
  const w = op.w * W;
  const h = op.h * H;
  ctx.strokeStyle = op.color || "#111111";
  ctx.fillStyle = op.color || "#111111";
  ctx.lineWidth = op.width || 3;
  if (op.type === "rect") {
    ctx.strokeRect(x, y, w, h);
  } else if (op.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (op.type === "arrow") {
    drawArrow(ctx, x, y, x + w, y + h, op.color || "#111111", op.width || 3);
  } else if (op.type === "pen" && Array.isArray(op.points) && op.points.length > 1) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    op.points.forEach(([px, py], i) => {
      const ax = px * W;
      const ay = py * H;
      if (i === 0) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
    });
    ctx.stroke();
  } else if (op.type === "text" && op.text) {
    const size = Math.max(8, (op.size || 0.05) * W);
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = op.color || "#111111";
    ctx.textBaseline = "top";
    const maxW = W - x - 8;
    const words = String(op.text).split(/\s+/);
    let line = "";
    let ly = y;
    const lh = size * 1.25;
    words.forEach((word) => {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, ly);
        line = word;
        ly += lh;
      } else {
        line = test;
      }
    });
    if (line) ctx.fillText(line, x, ly);
  }
}

/* Apply the full op list to the source image. Returns a fresh canvas. */
export function applyPhotoOps(sourceImage, ops) {
  let canvas = createCanvas(sourceImage.naturalWidth || sourceImage.width, sourceImage.naturalHeight || sourceImage.height);
  let ctx = canvas.getContext("2d")!;
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

  for (const op of ops) {
    if (op.type === "rotate") {
      const dir = op.dir === -1 ? -1 : 1;
      const next = createCanvas(canvas.height, canvas.width);
      const nctx = next.getContext("2d")!;
      nctx.translate(next.width / 2, next.height / 2);
      nctx.rotate((dir * Math.PI) / 2);
      nctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = next;
      ctx = canvas.getContext("2d")!;
    } else if (op.type === "flip") {
      const nctx = canvas.getContext("2d")!;
      nctx.save();
      nctx.translate(op.axis === "v" ? 0 : canvas.width, op.axis === "v" ? canvas.height : 0);
      nctx.scale(op.axis === "v" ? 1 : -1, op.axis === "v" ? -1 : 1);
      const tmp = createCanvas(canvas.width, canvas.height);
      tmp.getContext("2d")!.drawImage(canvas, 0, 0);
      nctx.clearRect(-canvas.width, -canvas.height, canvas.width * 3, canvas.height * 3);
      nctx.drawImage(tmp, 0, 0);
      nctx.restore();
    } else if (op.type === "crop") {
      const sx = Math.round(op.x * canvas.width);
      const sy = Math.round(op.y * canvas.height);
      const sw = Math.round(op.w * canvas.width);
      const sh = Math.round(op.h * canvas.height);
      if (sw < 4 || sh < 4) continue;
      const next = createCanvas(sw, sh);
      next.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      canvas = next;
      ctx = canvas.getContext("2d")!;
    } else if (op.type === "resize") {
      const next = createCanvas(op.w, op.h);
      const nctx = next.getContext("2d")!;
      nctx.imageSmoothingQuality = "high";
      nctx.drawImage(canvas, 0, 0, op.w, op.h);
      canvas = next;
      ctx = canvas.getContext("2d")!;
    } else if (op.type === "adjust") {
      const parts: string[] = [];
      if (typeof op.brightness === "number") parts.push(`brightness(${op.brightness})`);
      if (typeof op.contrast === "number") parts.push(`contrast(${op.contrast})`);
      if (typeof op.saturate === "number") parts.push(`saturate(${op.saturate})`);
      if (op.grayscale) parts.push("grayscale(1)");
      const tmp = createCanvas(canvas.width, canvas.height);
      const tctx = tmp.getContext("2d")!;
      tctx.filter = parts.join(" ") || "none";
      tctx.drawImage(canvas, 0, 0);
      if (op.bw) {
        const img = tctx.getImageData(0, 0, tmp.width, tmp.height);
        const d = img.data;
        const threshold = typeof op.bwThreshold === "number" ? op.bwThreshold : 128;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = lum >= threshold ? 255 : 0;
          d[i] = v; d[i + 1] = v; d[i + 2] = v;
        }
        tctx.putImageData(img, 0, 0);
      }
      ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tmp, 0, 0);
    } else if (["rect", "ellipse", "arrow", "pen", "text"].includes(op.type)) {
      drawShape(ctx, op, canvas.width, canvas.height);
    }
  }
  return canvas;
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Export failed"))),
      mime,
      quality
    );
  });
}
