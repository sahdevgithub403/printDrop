"use client";
import React, { useState, useCallback, useRef } from "react";
import Cropper from "react-easy-crop";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { uploadDocument, calculatePrice } from "../api";

const MAX_PHOTO_SIZE = 20 * 1024 * 1024;

export const PassportPhotoStep = ({shopId, onComplete, onBack }: any) => {
  const [imageSrc, setImageSrc] = useState<any>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [quantity, setQuantity] = useState(8);
  const [photoSize, setPhotoSize] = useState("PASSPORT"); // PASSPORT or STAMP
  const [isProcessing, setIsProcessing] = useState(false);
  const [photoError, setPhotoError] = useState<any>(null);
  
  const fileInputRef = useRef<any>(null);

  const handleFileChange = (e: any) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setPhotoError(null);
      if (file.type && !file.type.startsWith("image/")) {
        setPhotoError("Please select an image file (JPG/PNG).");
        e.target.value = "";
        return;
      }
      if (file.size === 0) {
        setPhotoError("Selected file is empty (0 bytes).");
        e.target.value = "";
        return;
      }
      if (file.size > MAX_PHOTO_SIZE) {
        setPhotoError("Photo exceeds the 20 MB file size limit.");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => setImageSrc(reader.result));
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createCroppedImage = async (imageSrc: any, cropPixels: any) => {
    return new Promise<Blob>((resolve: any, reject: any) => {
      const image = new Image();
      image.src = imageSrc;
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context is unavailable"));
          return;
        }
        
        canvas.width = cropPixels.width;
        canvas.height = cropPixels.height;
        
        ctx.drawImage(
          image,
          cropPixels.x,
          cropPixels.y,
          cropPixels.width,
          cropPixels.height,
          0,
          0,
          cropPixels.width,
          cropPixels.height
        );
        
        canvas.toBlob((blob: any) => {
          if (!blob) {
            reject(new Error("Canvas is empty"));
            return;
          }
          blob.name = "passport_photo.jpg";
          resolve(blob);
        }, "image/jpeg", 0.95);
      };
      image.onerror = () => reject(new Error("Failed to load image"));
    });
  };

  const computeLayoutPlan = (qty: any, size: any) => {
    const cols = 2;
    const rows = Math.ceil(qty / cols);
    const photoWidth = size === "PASSPORT" ? 413 : 300;
    const photoHeight = size === "PASSPORT" ? 531 : 380;
    const spacingX = (1200 - cols * photoWidth) / (cols + 1);
    const spacingY = 50;
    const startY = 100;
    const bottomPad = 100;
    const requiredHeight = startY + rows * photoHeight + (rows - 1) * spacingY + bottomPad;
    const canvasWidth = 1200;
    const canvasHeight = Math.max(1800, Math.ceil(requiredHeight));
    const rects = [];
    let count = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (count >= qty) break;
        const x = spacingX + col * (photoWidth + spacingX);
        const y = startY + row * (photoHeight + spacingY);
        rects.push({ x, y, w: photoWidth, h: photoHeight });
        count++;
      }
    }
    const allInside = rects.every(
      (r: any) => r.x >= 0 && r.y >= 0 && r.x + r.w <= canvasWidth && r.y + r.h <= canvasHeight,
    );
    return { cols, rows, photoWidth, photoHeight, spacingX, spacingY, startY, canvasWidth, canvasHeight, rects, allInside };
  };

  const layoutPlan = computeLayoutPlan(quantity, photoSize);

  const generateLayoutCanvas = async (croppedImageBlob: any) => {
    return new Promise<File>((resolve: any, reject: any) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(croppedImageBlob);
      image.onload = () => {
        try {
          const plan = computeLayoutPlan(quantity, photoSize);
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Canvas 2D context is unavailable"));
            return;
          }

          canvas.width = plan.canvasWidth;
          canvas.height = plan.canvasHeight;

          // Fill white background
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          for (const rect of plan.rects) {
            // Assert all rects inside canvas before drawing
            if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height) {
              URL.revokeObjectURL(objectUrl);
              reject(new Error("Photo layout exceeds canvas bounds"));
              return;
            }
            // Draw photo
            ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);

            // Draw subtle border
            ctx.strokeStyle = "#CCCCCC";
            ctx.lineWidth = 2;
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
          }
        
        canvas.toBlob((blob: any) => {
          if (!blob) {
            reject(new Error("Canvas is empty"));
            return;
          }
          // We can name the file based on quantity
          const filename = `layout_${quantity}_photos.jpg`;
          const file = new File([blob], filename, { type: "image/jpeg" });
          URL.revokeObjectURL(objectUrl);
          resolve(file);
        }, "image/jpeg", 0.9);
        } catch (e: any) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to load image"));
      };
      image.src = objectUrl;
    });
  };

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels || !layoutPlan.allInside) return;
    setIsProcessing(true);
    setPhotoError(null);
    
    try {
      const croppedBlob = await createCroppedImage(imageSrc, croppedAreaPixels);
      const layoutFile = await generateLayoutCanvas(croppedBlob);
      
      // Upload the generated layout file to the server
      const uploadedDoc = await uploadDocument(layoutFile);
      
      const settings = {
        printType: "PASSPORT_PHOTO",
        colorMode: "COLOR",
        paperSize: "A4", 
        printSide: "SINGLE",
        pageRange: "ALL",
        copies: 1, // 1 sheet
      };

      // Calculate price
      const pricingData = await calculatePrice({
        shopId,
        documentId: uploadedDoc.id,
        ...settings,
      });

      const item = {
        localId: Date.now().toString(),
        file: layoutFile,
        uploadedDocument: uploadedDoc,
        settings,
        pricing: pricingData || null,
      };

      onComplete([item]);
    } catch (err: any) {
      console.error("Error processing passport photo", err);
      setPhotoError(err?.response?.data?.message || err?.message || "Failed to process photo. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>Back to type selection</span>
      </button>

      <div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
          Passport Photo
        </h2>
        <p className="text-base text-[var(--text-secondary)] mt-2 font-medium">
          Upload and adjust your photo for printing.
        </p>
      </div>

      {!imageSrc ? (
        <div>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="bg-[var(--bg-surface)] border-2 border-dashed border-[var(--border-app)] rounded-2xl p-8 sm:p-12 text-center cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--color-accent-border)] transition-all group shadow-xs"
          >
          <div className="w-16 h-16 mx-auto bg-[var(--bg-elevated)] rounded-2xl flex items-center justify-center shadow-xs border border-[var(--border-app)] group-hover:scale-105 transition-transform duration-300">
            <UploadCloud className="w-8 h-8 text-[var(--text-primary)]" />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-primary)] mt-4">
            Upload your photo
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1 font-medium max-w-xs mx-auto">
            Choose a clear, front-facing photo from your gallery.
          </p>
          <button className="mt-6 px-6 py-2.5 bg-[var(--bg-elevated)] text-[var(--text-primary)] font-bold text-sm rounded-xl border border-[var(--border-app)] shadow-xs hover:bg-[var(--bg-surface)] cursor-pointer">
            Select Photo
          </button>
          </div>
          {photoError && (
            <p className="text-sm font-semibold text-rose-500 dark:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mt-4">
              {photoError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-[var(--bg-surface)] rounded-2xl p-4 sm:p-5 border border-[var(--border-app)] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-[var(--text-primary)]">Adjust Photo</span>
              <button 
                onClick={() => setImageSrc(null)}
                className="text-sm font-bold text-rose-500 dark:text-rose-300 hover:underline cursor-pointer"
              >
                Change Photo
              </button>
            </div>
            
            <div className="relative w-full h-[400px] sm:h-[450px] bg-neutral-900 rounded-xl overflow-hidden">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={photoSize === "PASSPORT" ? 3.5 / 4.5 : 1}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={(z: any) => setZoom(parseFloat(z) || 1)}
              />
            </div>
            <div className="mt-4 px-2">
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                Zoom
              </label>
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e: any) => setZoom(parseFloat(e.target.value) || 1)}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Photo Size
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div 
                onClick={() => setPhotoSize("PASSPORT")}
                className={`selection-row min-h-[64px] px-4 cursor-pointer ${photoSize === "PASSPORT" ? "selection-row-active" : "bg-[var(--bg-surface)] border border-[var(--border-app)]"}`}
              >
                <span className="font-bold text-sm">Passport Size</span>
              </div>
              <div 
                onClick={() => setPhotoSize("STAMP")}
                className={`selection-row min-h-[64px] px-4 cursor-pointer ${photoSize === "STAMP" ? "selection-row-active" : "bg-[var(--bg-surface)] border border-[var(--border-app)]"}`}
              >
                <span className="font-bold text-sm">Stamp Size</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              How many photos?
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[4, 6, 8, 12].map((num: any) => (
                <div 
                  key={num}
                  onClick={() => setQuantity(num)}
                  className={`selection-row min-h-[64px] px-4 cursor-pointer ${quantity === num ? "selection-row-active" : "bg-[var(--bg-surface)] border border-[var(--border-app)]"}`}
                >
                  <span className="font-bold text-sm">{num} Photos</span>
                </div>
              ))}
            </div>
          </div>
          
          {photoError && (
            <p className="text-sm font-semibold text-rose-500 dark:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
              {photoError}
            </p>
          )}
          {!layoutPlan.allInside && (
            <p className="text-sm font-semibold text-rose-500 dark:text-rose-300">
              Photo layout does not fit — try a smaller quantity.
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={isProcessing || !croppedAreaPixels || !layoutPlan.allInside}
            className="btn-primary w-full"
          >
            {isProcessing ? "Processing Layout..." : "Confirm & Continue"}
          </button>
        </div>
      )}
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
    </div>
  );
};
