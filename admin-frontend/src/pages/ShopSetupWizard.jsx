import React, { useState, useEffect } from "react";
import { createShop, updateShopPricing } from "../api";
import { printClient } from "../services/printClient";
import { getCustomerAppBaseUrl } from "../components/QRCodeModal";
import { MaterialIcon } from "../components/ui/MaterialIcon";

export const ShopSetupWizard = ({ onSetupComplete }) => {
  const [step, setStep] = useState(1); // 1: Shop Info, 2: Printer Detection, 3: Pricing, 4: QR Code
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Shop Information
  const [shopName, setShopName] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [createdShop, setCreatedShop] = useState(null);

  // Step 2: Printer Detection
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState(
    localStorage.getItem("main_printer_name") || ""
  );
  const [detectingPrinters, setDetectingPrinters] = useState(false);
  const [printerDetectionDone, setPrinterDetectionDone] = useState(false);

  // Step 3: Print Pricing
  const [bwSingle, setBwSingle] = useState("2.00");
  const [bwDouble, setBwDouble] = useState("3.00");
  const [colorSingle, setColorSingle] = useState("10.00");
  const [colorDouble, setColorDouble] = useState("15.00");

  // Step 1 Submit
  const handleCreateShop = async (e) => {
    e.preventDefault();
    if (!shopName.trim() || !phone.trim()) {
      setError("Shop Name and Phone Number are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const shopData = {
        name: shopName.trim(),
        ownerName: shopName.trim(),
        phone: phone.trim(),
        logoUrl: logoUrl.trim() || null,
      };
      const newShop = await createShop(shopData);
      setCreatedShop(newShop);

      // Persist in localStorage
      const userData = JSON.parse(localStorage.getItem("admin_user_data") || "{}");
      userData.shopSetupComplete = true;
      userData.shopId = newShop.id;
      userData.shopName = newShop.name;
      userData.shopSlug = newShop.slug;
      userData.apiKey = newShop.apiKey;
      localStorage.setItem("admin_user_data", JSON.stringify(userData));

      setStep(2); // Proceed to Step 2: Printer Detection
      detectPrintersAutomatically();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to create shop.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Automatic Printer Detection
  const detectPrintersAutomatically = async () => {
    setDetectingPrinters(true);
    setError(null);
    try {
      if (window.electronAPI?.getPrinters) {
        const detected = await window.electronAPI.getPrinters();
        const list = Array.isArray(detected) ? detected : [];
        setPrinters(list);

        if (list.length > 0) {
          // Auto-select default printer, or first available printer
          const defaultPrinter = list.find((p) => p.isDefault) || list[0];
          setSelectedPrinter(defaultPrinter.name);
          await printClient.setPrintersConfig({ mainPrinter: defaultPrinter.name });
        }
      } else {
        // Non-electron environment simulation
        setPrinters([]);
      }
    } catch (err) {
      console.warn("Printer detection error:", err);
    } finally {
      setDetectingPrinters(false);
      setPrinterDetectionDone(true);
    }
  };

  const handleSelectPrinterAndContinue = async () => {
    if (selectedPrinter) {
      await printClient.setPrintersConfig({ mainPrinter: selectedPrinter });
    }
    setStep(3); // Proceed to Step 3: Pricing
  };

  const handleSkipPrinter = () => {
    setStep(3); // Skip and proceed to Step 3
  };

  // Step 3: Pricing Submit
  const handleSavePricing = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (createdShop?.id) {
        await updateShopPricing({
          bwA4Single: parseFloat(bwSingle) || 2.0,
          bwA4Double: parseFloat(bwDouble) || 3.0,
          colorA4Single: parseFloat(colorSingle) || 10.0,
          colorA4Double: parseFloat(colorDouble) || 15.0,
        });
      }
      setStep(4); // Proceed to Step 4: QR Code
    } catch (err) {
      console.error("Failed to save pricing during onboarding:", err);
      // Advance to step 4 anyway to prevent blocking
      setStep(4);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipPricing = () => {
    setStep(4); // Skip pricing and go to QR
  };

  // Step 4: QR Actions
  const handleDownloadQR = () => {
    const customerBaseUrl = getCustomerAppBaseUrl();
    const slug = createdShop?.slug || "shop";
    const shopUrl = `${customerBaseUrl}/shop/${slug}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(
      shopUrl
    )}`;

    const link = document.createElement("a");
    link.href = qrUrl;
    link.download = `${createdShop?.name || "Shop"}_QR.png`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const customerBaseUrl = getCustomerAppBaseUrl();
  const slug = createdShop?.slug || "";
  const shopUrl = `${customerBaseUrl}/shop/${slug}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
    shopUrl
  )}`;

  return (
    <div className="min-h-screen bg-[#0b0d10] text-zinc-100 flex items-center justify-center p-6 antialiased">
      <div className="max-w-xl w-full bg-[#111418] rounded-none border border-white/10 shadow-none p-7 sm:p-9 space-y-6">
        {/* Progress Indicator */}
        <div className="flex items-center justify-between pb-1 text-[11px] font-semibold text-zinc-500 tracking-wider uppercase">
          <span className={step >= 1 ? "text-zinc-100 font-bold" : ""}>1. Shop</span>
          <span>→</span>
          <span className={step >= 2 ? "text-zinc-100 font-bold" : ""}>2. Printer</span>
          <span>→</span>
          <span className={step >= 3 ? "text-zinc-100 font-bold" : ""}>3. Pricing</span>
          <span>→</span>
          <span className={step >= 4 ? "text-zinc-100 font-bold" : ""}>4. Counter QR</span>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-500/10 text-rose-300 rounded-none border border-rose-500/20 text-xs font-semibold flex items-center gap-2">
            <MaterialIcon name="error" size={16} className="shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: SHOP INFORMATION */}
        {step === 1 && (
          <form onSubmit={handleCreateShop} className="space-y-6">
            <div className="text-center space-y-1.5">
              <MaterialIcon name="store" size={28} className="text-zinc-100 mx-auto" />
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                Shop Information
              </h1>
              <p className="text-xs text-zinc-400">
                Set up your print shop profile to begin.
              </p>
            </div>

            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Shop Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="e.g. Apex Xerox & Print Studio"
                  className="w-full px-3.5 py-2.5 rounded-none border border-white/10 text-xs font-medium text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/40 bg-[#161a20]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3.5 py-2.5 rounded-none border border-white/10 text-xs font-medium text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/40 bg-[#161a20]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Logo URL <span className="text-zinc-500 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-3.5 py-2.5 rounded-none border border-white/10 text-xs font-medium text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/40 bg-[#161a20]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-none bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {loading ? (
                <MaterialIcon name="progress_activity" size={16} className="animate-spin" />
              ) : (
                <>
                  <span>Continue</span>
                  <MaterialIcon name="arrow_forward" size={16} />
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: AUTOMATIC PRINTER DETECTION */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center space-y-1.5">
              <MaterialIcon name="print" size={24} className="text-zinc-100 mx-auto" />
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                Automatic Printer Detection
              </h1>
              <p className="text-xs text-zinc-400">
                Scanning connected Windows physical and system printers.
              </p>
            </div>

            {detectingPrinters ? (
              <div className="p-8 text-center space-y-3 bg-[#161a20] rounded-none border border-white/10">
                <MaterialIcon name="progress_activity" size={24} className="animate-spin text-zinc-100 mx-auto" />
                <p className="text-xs text-zinc-400 font-medium">Detecting local Windows printers...</p>
              </div>
            ) : printers.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                    {printers.length} Printer{printers.length > 1 ? "s" : ""} Detected
                  </span>
                  <button
                    type="button"
                    onClick={detectPrintersAutomatically}
                    className="flex items-center gap-1.5 text-xs text-zinc-100 hover:underline cursor-pointer"
                  >
                    <MaterialIcon name="refresh" size={12} />
                    <span>Rescan</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {printers.map((p) => {
                    const isSelected = selectedPrinter === p.name;
                    return (
                      <div
                        key={p.name}
                        onClick={() => setSelectedPrinter(p.name)}
                        className={`p-3.5 rounded-none border cursor-pointer transition-colors flex items-center justify-between ${
                          isSelected
                            ? "border-white/60 bg-[#161a20]"
                            : "border-white/10 hover:bg-[#161a20]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <MaterialIcon name="print" size={16} className={isSelected ? "text-zinc-100" : "text-zinc-500"} />
                          <div>
                            <p className="text-xs font-bold text-zinc-100">{p.displayName || p.name}</p>
                            {p.isDefault && (
                              <span className="text-[10px] text-zinc-400 font-medium">Default System Printer</span>
                            )}
                          </div>
                        </div>
                        {isSelected && <MaterialIcon name="check_circle" size={16} className="text-zinc-100" />}
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleSkipPrinter}
                    className="w-1/2 h-10 rounded-none border border-white/10 bg-[#111418] text-zinc-100 hover:bg-white/[0.06] text-xs font-medium transition-colors cursor-pointer"
                  >
                    Set Up Later
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectPrinterAndContinue}
                    disabled={!selectedPrinter}
                    className="w-1/2 h-10 rounded-none bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Continue</span>
                    <MaterialIcon name="arrow_forward" size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-6 text-center space-y-2 bg-[#161a20] rounded-none border border-white/10">
                  <MaterialIcon name="print" size={24} className="text-zinc-500 mx-auto" />
                  <p className="text-xs font-bold text-zinc-100">No printer detected</p>
                  <p className="text-[11px] text-zinc-400">
                    You can connect a printer and configure it later in Settings.
                  </p>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={detectPrintersAutomatically}
                    className="w-1/2 h-10 rounded-none border border-white/10 bg-[#111418] text-zinc-100 hover:bg-white/[0.06] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <MaterialIcon name="refresh" size={12} />
                    <span>Retry Detection</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipPrinter}
                    className="w-1/2 h-10 rounded-none bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Continue</span>
                    <MaterialIcon name="arrow_forward" size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: PRINT PRICING SETUP */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center space-y-1.5">
              <MaterialIcon name="payments" size={24} className="text-zinc-100 mx-auto" />
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                Pricing Rates
              </h1>
              <p className="text-xs text-zinc-400">
                Configure standard print rates per page. Rates can be updated anytime in Settings.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="bg-[#161a20] p-4 rounded-none border border-white/10 space-y-3">
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Black & White (A4)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400 font-medium">Single Side (₹)</label>
                    <input
                      type="number"
                      step="0.50"
                      min="0"
                      value={bwSingle}
                      onChange={(e) => setBwSingle(e.target.value)}
                      className="w-full px-3 py-2 rounded-none border border-white/10 text-xs font-bold text-zinc-100 bg-[#111418] focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400 font-medium">Double Side (₹)</label>
                    <input
                      type="number"
                      step="0.50"
                      min="0"
                      value={bwDouble}
                      onChange={(e) => setBwDouble(e.target.value)}
                      className="w-full px-3 py-2 rounded-none border border-white/10 text-xs font-bold text-zinc-100 bg-[#111418] focus:outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-[#161a20] p-4 rounded-none border border-white/10 space-y-3">
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Color Print (A4)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400 font-medium">Single Side (₹)</label>
                    <input
                      type="number"
                      step="0.50"
                      min="0"
                      value={colorSingle}
                      onChange={(e) => setColorSingle(e.target.value)}
                      className="w-full px-3 py-2 rounded-none border border-white/10 text-xs font-bold text-zinc-100 bg-[#111418] focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400 font-medium">Double Side (₹)</label>
                    <input
                      type="number"
                      step="0.50"
                      min="0"
                      value={colorDouble}
                      onChange={(e) => setColorDouble(e.target.value)}
                      className="w-full px-3 py-2 rounded-none border border-white/10 text-xs font-bold text-zinc-100 bg-[#111418] focus:outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSkipPricing}
                className="w-1/2 h-10 rounded-none border border-white/10 bg-[#111418] text-zinc-100 hover:bg-white/[0.06] text-xs font-medium transition-colors cursor-pointer"
              >
                Set Up Later
              </button>
              <button
                type="button"
                onClick={handleSavePricing}
                disabled={loading}
                className="w-1/2 h-10 rounded-none bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {loading ? <MaterialIcon name="progress_activity" size={16} className="animate-spin" /> : "Save & Continue"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: QR CODE STEP */}
        {step === 4 && (
          <div className="space-y-6 text-center">
            <div className="space-y-1.5">
              <MaterialIcon name="qr_code_2" size={24} className="text-zinc-100 mx-auto" />
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                Shop Counter QR
              </h1>
              <p className="text-xs text-zinc-400">
                Customers scan this QR code at your shop counter to upload and print documents.
              </p>
            </div>

            {/* QR Poster Preview */}
            <div className="border border-white/10 rounded-none p-5 bg-[#161a20] space-y-3 max-w-xs mx-auto">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-tight truncate">
                  {createdShop?.name || shopName || "Print Shop"}
                </h3>
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Self-Service Print Counter
                </p>
              </div>

              <div className="bg-[#111418] p-3 rounded-none inline-block">
                <img
                  src={qrImageUrl}
                  alt="Shop QR Code"
                  className="w-40 h-40 mx-auto"
                />
              </div>

              <p className="text-[11px] text-zinc-500">
                Always accessible from the Shop QR tab
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleDownloadQR}
                className="w-full h-10 rounded-none border border-white/10 bg-[#111418] text-zinc-100 hover:bg-white/[0.06] text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MaterialIcon name="download" size={14} />
                <span>Download QR</span>
              </button>

              <button
                type="button"
                onClick={onSetupComplete}
                className="w-full h-10 rounded-none bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Go to Dashboard</span>
                <MaterialIcon name="arrow_forward" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShopSetupWizard;
