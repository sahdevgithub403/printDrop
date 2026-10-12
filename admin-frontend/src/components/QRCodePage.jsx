import React, { useState } from "react";
import { MaterialIcon } from "./ui/MaterialIcon";
import { getCustomerAppBaseUrl } from "./QRCodeModal";

export const QRCodePage = ({ user }) => {
  const [copied, setCopied] = useState(false);
  const shopName = user?.shopName || "PrintAlfa Shop";
  const shopSlug = user?.shopSlug || "";
  const customerBaseUrl = getCustomerAppBaseUrl();
  const shopUrl = `${customerBaseUrl}/shop/${shopSlug}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shopUrl)}`;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(qrCodeUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${shopSlug || "shop"}-qr-code.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to download QR code:", err);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shopUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <div className="pb-2">
        <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
          Shop Counter QR
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
          Permanent counter QR code for customers to scan, upload files, and send print orders.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Printable Standee Card */}
        <div
          id="printable-qr-poster"
          className="bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)] p-6 sm:p-8 text-center space-y-5 shadow-none transition-colors duration-200"
        >
          <div className="space-y-1.5">
            <div className="w-10 h-10 rounded-none bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto border border-[var(--color-accent-border)]">
              <MaterialIcon name="print" size={20} />
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] uppercase tracking-tight">
              {shopName}
            </h2>
            <div className="inline-block bg-[var(--bg-surface)] border border-[var(--border-app)] px-3 py-0.5 rounded-none text-[11px] font-semibold text-[var(--color-accent)] uppercase tracking-wider">
              Scan & Print Instant Documents
            </div>
          </div>

          <div className="bg-white p-4 rounded-none inline-block mx-auto shadow-none border border-neutral-200">
            <img
              src={qrCodeUrl}
              alt="Shop QR Code"
              className="w-48 h-48 sm:w-56 sm:h-56 mx-auto rounded-none"
            />
          </div>

          <div className="space-y-0.5">
            <p className="text-xs font-bold text-[var(--text-primary)] tracking-wide">
              SCAN WITH ANY SMARTPHONE CAMERA
            </p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              No app download required · Upload PDFs & Docs instantly
            </p>
          </div>
        </div>

        {/* Action Controls & Details */}
        <div className="space-y-5">
          <div className="bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)] p-5 space-y-3.5 transition-colors duration-200">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Counter Actions
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Place this QR code at your shop counter. Customers scan to configure print settings and send documents directly to your queue.
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handlePrint}
                className="w-full min-h-[40px] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-none text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer dark:text-black"
              >
                <MaterialIcon name="print" size={16} />
                <span>Print Counter Poster</span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="w-full min-h-[40px] bg-[var(--bg-surface)] hover:bg-[var(--border-app)] border border-[var(--border-app)] text-[var(--text-primary)] rounded-none text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MaterialIcon name="download" size={16} className="text-[var(--text-secondary)]" />
                <span>Download QR Image</span>
              </button>
            </div>
          </div>

          {/* Customer Link Card */}
          <div className="bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)] p-5 space-y-3.5 transition-colors duration-200">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Customer Portal Link
            </h3>
            <div className="p-2.5 bg-[var(--bg-surface)] rounded-none border border-[var(--border-app)] text-[11px] font-mono text-[var(--text-primary)] break-all select-all">
              {shopUrl}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[36px] bg-[var(--bg-surface)] hover:bg-[var(--border-app)] border border-[var(--border-app)] rounded-none text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? (
                  <MaterialIcon name="check" size={14} className="text-[#22C55E]" />
                ) : (
                  <MaterialIcon name="content_copy" size={14} className="text-[var(--text-secondary)]" />
                )}
                <span>{copied ? "Copied!" : "Copy Link"}</span>
              </button>

              <a
                href={shopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] bg-[var(--bg-surface)] hover:bg-[var(--border-app)] border border-[var(--border-app)] rounded-none text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Preview</span>
                <MaterialIcon name="open_in_new" size={14} className="text-[var(--text-secondary)]" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
