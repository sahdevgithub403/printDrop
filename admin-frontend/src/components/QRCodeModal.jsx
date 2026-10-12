import React, { useState } from "react";
import { MaterialIcon } from "./ui/MaterialIcon";

export const getCustomerAppBaseUrl = () => {
  const normalize = (raw) => {
    const trimmed = (raw || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    // Prepend https:// when the scheme is missing (e.g. "host.vercel.app").
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  };
  if (import.meta.env.VITE_CUSTOMER_APP_URL) {
    return normalize(import.meta.env.VITE_CUSTOMER_APP_URL);
  }
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname, port } = window.location;
    if (protocol === "http:" || protocol === "https:") {
      if (port === "5174") {
        return `${protocol}//${hostname}:5173`;
      }
      return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    }
  }
  return "http://localhost:5173";
};

export const QRCodeModal = ({ shopName, shopSlug, onClose }) => {
  const [copied, setCopied] = useState(false);
  const customerBaseUrl = getCustomerAppBaseUrl();
  const shopUrl = `${customerBaseUrl}/shop/${shopSlug}`;

  const handlePrintPoster = () => {
    window.print();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shopUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#111418] rounded-none border border-white/10 p-8 w-full max-w-md space-y-6 shadow-none relative animate-in fade-in zoom-in duration-150">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-zinc-500 hover:text-zinc-100 rounded-none hover:bg-white/[0.06] cursor-pointer"
          aria-label="Close"
        >
          <MaterialIcon name="close" size={20} />
        </button>

        {/* Printable Counter Poster Card */}
        <div
          id="printable-qr-poster"
          className="border-2 border-[#111111] rounded-none p-6 text-center space-y-4 bg-white"
        >
          <div className="space-y-1">
            <div className="w-10 h-10 rounded-none bg-[#111111] text-white flex items-center justify-center mx-auto mb-2">
              <MaterialIcon name="print" size={24} />
            </div>
            <h2 className="text-lg font-extrabold text-zinc-900 uppercase tracking-tight">
              {shopName}
            </h2>
            <p className="text-xs font-bold text-zinc-800 uppercase tracking-wider bg-neutral-100 py-1 px-3 rounded-none inline-block border border-neutral-300">
              Scan & Print Instant Documents
            </p>
          </div>

          {/* SVG QR Code Frame */}
          <div className="bg-white p-4 rounded-none border border-neutral-200 inline-block mx-auto">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shopUrl)}`}
              alt="Shop QR Code"
              className="w-52 h-52 mx-auto"
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-extrabold text-zinc-900">
              SCAN WITH YOUR PHONE
            </p>
            <p className="text-xs text-zinc-600">
              Upload PDF / Docs · Pay Online or Counter
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handlePrintPoster}
            className="btn-primary w-full min-h-[52px]"
          >
            <MaterialIcon name="print" size={20} />
            <span>Print Counter Poster</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCopyLink}
              className="btn-secondary min-h-[48px] text-sm"
            >
              {copied ? (
                <MaterialIcon name="check" size={16} className="text-emerald-600" />
              ) : (
                <MaterialIcon name="content_copy" size={16} />
              )}
              <span>{copied ? "Copied!" : "Copy Link"}</span>
            </button>

            <a
              href={shopUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary min-h-[48px] text-sm"
            >
              <span>Preview Portal</span>
              <MaterialIcon name="open_in_new" size={16} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
