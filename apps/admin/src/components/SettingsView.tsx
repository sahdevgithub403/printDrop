"use client";
import React, { useState, useEffect } from "react";
// NOTE: the original Vite source referenced these lucide-react icons without
// importing them (a latent ReferenceError whenever Settings renders); the
// port adds the missing import so the intended icons render.
import { Printer, Store, DollarSign, Sun, Bell } from "lucide-react";
import { MaterialIcon } from "./ui/MaterialIcon";
import { printClient } from "../services/printClient";
import { getNotifPref, setNotifPref } from "../services/notifyPrefs";
import { getShopProfile, updateShopProfile, getShopPricing, updateShopPricing } from "../api";
import { useTheme } from "../context/ThemeContext";

export const SettingsView = ({ user }) => {
  const [activeSettingsSection, setActiveSettingsSection] = useState("PRINTER"); // PRINTER, SHOP, PRICING, APPEARANCE, NOTIFICATIONS
  const { theme, setTheme, isDark } = useTheme();
  
  // Shop Info State
  const [shopName, setShopName] = useState(user?.shopName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [logoUrl, setLogoUrl] = useState(user?.logoUrl || "");
  const [shopIsOpen, setShopIsOpen] = useState(user?.isOpen !== false);
  const [savingShop, setSavingShop] = useState(false);
  const [shopSaveSuccess, setShopSaveSuccess] = useState(false);

  // Printer State
  const [clientState, setClientState] = useState(printClient.getState());
  const [printers, setPrinters] = useState<any[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Pricing State
  const [pricing, setPricing] = useState({
    bwA4Single: "2.00",
    bwA4Double: "3.00",
    colorA4Single: "10.00",
    colorA4Double: "15.00",
    bwA3Single: "5.00",
    bwA3Double: "8.00",
    colorA3Single: "20.00",
    colorA3Double: "35.00",
    passportPrice: "50.00",
  });
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [pricingSaveSuccess, setPricingSaveSuccess] = useState(false);

  // Notifications State (single canonical key set shared with dashboard gating)
  const [notifications, setNotifications] = useState({
    newOrderPopup: getNotifPref("newOrderPopup", true),
    printSound: getNotifPref("printSound", true),
    printerAlerts: getNotifPref("printerAlerts", true),
  });

  useEffect(() => {
    const unsubscribe = printClient.subscribe((state) => {
      setClientState(state);
    });

    fetchPrinters();
    fetchShopAndPricing();
    return () => { unsubscribe(); };
  }, []);

  const fetchShopAndPricing = async () => {
    try {
      const profile = await getShopProfile();
      if (profile) {
        setShopName(profile.name || "");
        setPhone(profile.phone || "");
        setLogoUrl(profile.logoUrl || "");
        setShopIsOpen(profile.isOpen !== false);
      }
    } catch (e: any) {
      console.error("Failed to load shop profile:", e);
    }

    try {
      setLoadingPricing(true);
      const rates = await getShopPricing();
      if (rates) {
        setPricing({
          bwA4Single: rates.bwA4Single?.toString() || "2.00",
          bwA4Double: rates.bwA4Double?.toString() || "3.00",
          colorA4Single: rates.colorA4Single?.toString() || "10.00",
          colorA4Double: rates.colorA4Double?.toString() || "15.00",
          bwA3Single: rates.bwA3Single?.toString() || "5.00",
          bwA3Double: rates.bwA3Double?.toString() || "8.00",
          colorA3Single: rates.colorA3Single?.toString() || "20.00",
          colorA3Double: rates.colorA3Double?.toString() || "35.00",
          passportPrice: rates.passportPrice?.toString() || "50.00",
        });
      }
    } catch (e: any) {
      console.error("Failed to load pricing:", e);
    } finally {
      setLoadingPricing(false);
    }
  };

  const fetchPrinters = async () => {
    setLoadingPrinters(true);
    try {
      if (window.electronAPI?.getPrinters) {
        const list = await window.electronAPI.getPrinters();
        setPrinters(list || []);
        // Never auto-claim printers: the shopkeeper explicitly assigns
        // Main/Color queues below; defaults are left untouched.
      } else {
        // Browser build has no printer agent: show empty state, never fake inventory.
        setPrinters([]);
      }
    } catch (err: any) {
      console.error("Failed to load printers:", err);
    } finally {
      setLoadingPrinters(false);
    }
  };

  const handleSelectMainPrinter = (e) => {
    printClient.setPrintersConfig({ mainPrinter: e.target.value });
  };

  const handleSelectColorPrinter = (e) => {
    printClient.setPrintersConfig({ colorPrinter: e.target.value });
  };

  const handleTestPrint = async (printerType) => {
    const printerName = printerType === "main" ? clientState.mainPrinter : clientState.colorPrinter;
    if (!printerName) {
      setTestResult({ success: false, message: `Please select a ${printerType} printer first.` });
      return;
    }

    setTestingPrint(true);
    setTestResult(null);

    try {
      // Real path only: printClient.testPrint() throws when the printer
      // agent is unavailable — never a simulated success.
      const res = await printClient.testPrint(printerName);
      setTestResult({
        success: true,
        message: res?.message || `Test page sent to "${printerName}". Check physical printer output!`,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Test print communication error.",
      });
    } finally {
      setTestingPrint(false);
    }
  };

  const handleSaveShopInfo = async (e) => {
    e.preventDefault();
    setSavingShop(true);
    setShopSaveSuccess(false);

    try {
      const updated = await updateShopProfile({
        name: shopName,
        phone: phone,
        logoUrl: logoUrl,
        isOpen: shopIsOpen,
      });

      const userData = JSON.parse(localStorage.getItem("admin_user_data") || "{}");
      userData.shopName = updated.name;
      userData.isOpen = updated.isOpen;
      localStorage.setItem("admin_user_data", JSON.stringify(userData));

      setShopSaveSuccess(true);
      setTimeout(() => setShopSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Failed to update shop details:", err);
    } finally {
      setSavingShop(false);
    }
  };

  const handleSavePricing = async (e) => {
    e.preventDefault();
    setSavingPricing(true);
    setPricingSaveSuccess(false);
    try {
      const numericRates = {
        bwA4Single: parseFloat(pricing.bwA4Single) || 0,
        bwA4Double: parseFloat(pricing.bwA4Double) || 0,
        colorA4Single: parseFloat(pricing.colorA4Single) || 0,
        colorA4Double: parseFloat(pricing.colorA4Double) || 0,
        bwA3Single: parseFloat(pricing.bwA3Single) || 0,
        bwA3Double: parseFloat(pricing.bwA3Double) || 0,
        colorA3Single: parseFloat(pricing.colorA3Single) || 0,
        colorA3Double: parseFloat(pricing.colorA3Double) || 0,
        passportPrice: parseFloat(pricing.passportPrice) || 0,
      };
      await updateShopPricing(numericRates);
      setPricingSaveSuccess(true);
      setTimeout(() => setPricingSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Failed to save pricing:", err);
    } finally {
      setSavingPricing(false);
    }
  };

  const handleToggleNotification = (key) => {
    const nextVal = !notifications[key];
    setNotifications((prev) => ({ ...prev, [key]: nextVal }));
    setNotifPref(key, nextVal);
  };

  const sections = [
    { id: "PRINTER", label: "Printers", icon: Printer },
    { id: "SHOP", label: "Shop Details", icon: Store },
    { id: "PRICING", label: "Rates", icon: DollarSign },
    { id: "APPEARANCE", label: "Theme", icon: Sun },
    { id: "NOTIFICATIONS", label: "Alerts", icon: Bell },
  ];

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      {/* Settings Navigation Tabs */}
      <div className="flex items-center gap-1.5 pb-1 overflow-x-auto">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSettingsSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSettingsSection(sec.id)}
              className={`px-3.5 py-2 rounded-none text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer border ${
                isActive
                  ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white dark:text-black"
                  : "bg-[var(--bg-elevated)] border-[var(--border-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. PRINTER SETTINGS SECTION */}
      {activeSettingsSection === "PRINTER" && (
        <div className="space-y-6">
          <div className="pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                <MaterialIcon name="print" size={20} className="text-[var(--color-accent)]" />
                <span>Connected Printers</span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
                Manage your physical printers, default queues, and spooler test prints
              </p>
            </div>

            <button
              type="button"
              onClick={fetchPrinters}
              disabled={loadingPrinters}
              className="btn-secondary-sm cursor-pointer disabled:opacity-40 self-start"
            >
              <MaterialIcon name="refresh" size={14} className={loadingPrinters ? "animate-spin text-[var(--color-accent)]" : ""} />
              <span>Rescan Printers</span>
            </button>
          </div>

          <div className="space-y-4">
            {printers.length === 0 && !loadingPrinters && (
              <div className="p-3.5 rounded-none border border-[var(--border-app)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] leading-relaxed">
                {typeof window !== "undefined" && !window.electronAPI
                  ? "No printer agent detected in this browser. Open the PrintAlfa desktop app on the shop PC to discover Windows printers."
                  : "No printers found. Check that a Windows printer is installed, then press Rescan."}
              </div>
            )}
            {/* Main Printer */}
            <div className="bg-[var(--bg-elevated)] p-5 rounded-none border border-[var(--border-app)] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                    Default Main Printer (B/W, Documents, Xerox)
                  </label>
                  <select
                    value={clientState.mainPrinter || ""}
                    onChange={handleSelectMainPrinter}
                    disabled={loadingPrinters || printers.length === 0}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="" disabled>
                      {loadingPrinters ? "Scanning..." : printers.length === 0 ? "No printers found" : "-- Select Main Printer --"}
                    </option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} {p.isDefault ? "(System Default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => handleTestPrint("main")}
                  disabled={testingPrint || !clientState.mainPrinter}
                  className="px-3.5 py-1.5 rounded-none border border-[var(--border-app)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-panel)] text-xs font-semibold h-9 mt-auto flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <MaterialIcon name="description" size={14} className="text-[var(--color-accent)]" />
                  <span>Test Print</span>
                </button>
              </div>
            </div>

            {/* Color Printer */}
            <div className="bg-[var(--bg-elevated)] p-5 rounded-none border border-[var(--border-app)] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                    Color & Photo Printer (Color, Photos)
                  </label>
                  <select
                    value={clientState.colorPrinter || ""}
                    onChange={handleSelectColorPrinter}
                    disabled={loadingPrinters || printers.length === 0}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="" disabled>
                      {loadingPrinters ? "Scanning..." : printers.length === 0 ? "No printers found" : "-- Select Color Printer --"}
                    </option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => handleTestPrint("color")}
                  disabled={testingPrint || !clientState.colorPrinter}
                  className="px-3.5 py-1.5 rounded-none border border-[var(--border-app)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-panel)] text-xs font-semibold h-9 mt-auto flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <MaterialIcon name="description" size={14} className="text-[var(--color-accent)]" />
                  <span>Test Print</span>
                </button>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3.5 rounded-none border text-xs font-medium flex items-center gap-2 ${
                  testResult.success
                    ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
                    : "bg-[var(--color-error-bg)] text-[var(--color-error-text)] border-[var(--color-error-border)]"
                }`}
              >
                {testResult.success ? (
                  <MaterialIcon name="check_circle" size={16} className="text-[#22C55E] shrink-0" />
                ) : (
                  <MaterialIcon name="error" size={16} className="text-[#EF4444] shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. SHOP INFORMATION SECTION */}
      {activeSettingsSection === "SHOP" && (
        <form onSubmit={handleSaveShopInfo} className="space-y-6">
          <div className="pb-2">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <MaterialIcon name="store" size={20} className="text-[var(--color-accent)]" />
              <span>Shop Information</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
              Update your shop name, contact number, and branding
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Shop Name
              </label>
              <input
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Business Phone Number
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Logo Image URL <span className="text-[var(--text-muted)] font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            {/* Shop Availability Toggle */}
            <div className="bg-[var(--bg-elevated)] p-4 rounded-none border border-[var(--border-app)] flex items-center justify-between gap-4">
              <div className="space-y-0.5 select-none">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--text-primary)]">Shop Availability</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-none text-[10px] font-semibold ${
                      shopIsOpen
                        ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]"
                        : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-app)]"
                    }`}
                  >
                    {shopIsOpen ? "Active" : "Closed"}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {shopIsOpen ? "Accepting customer print orders" : "Not accepting new customer orders"}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={shopIsOpen}
                onClick={() => setShopIsOpen(!shopIsOpen)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-[var(--border-app)] transition-colors duration-200 ease-in-out focus:outline-none ${
                  shopIsOpen ? "bg-[#22C55E]" : isDark ? "bg-[#333333]" : "bg-[#D1D5DB]"
                }`}
              >
                <span className="sr-only">Toggle shop availability</span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-none ring-0 transition duration-200 ease-in-out ${
                    shopIsOpen ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {shopSaveSuccess && (
              <span className="text-xs font-medium text-[#22C55E] flex items-center gap-1.5">
                <MaterialIcon name="check" size={16} className="text-[#22C55E]" />
                <span>Shop details updated successfully!</span>
              </span>
            )}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={savingShop}
                className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-30 text-white font-semibold text-xs rounded-none transition-colors flex items-center justify-center gap-2 cursor-pointer dark:text-black"
              >
                {savingShop ? <MaterialIcon name="progress_activity" size={14} className="animate-spin" /> : <MaterialIcon name="save" size={14} />}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 3. PRICING SETTINGS SECTION */}
      {activeSettingsSection === "PRICING" && (
        <form onSubmit={handleSavePricing} className="space-y-6">
          <div className="pb-2">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <MaterialIcon name="payments" size={20} className="text-[var(--color-accent)]" />
              <span>Print Pricing Rates</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
              Set rate per page for B/W, Color, A4, A3, and photo prints
            </p>
          </div>

          <div className="space-y-4">
            {/* B/W A4 Rates */}
            <div className="bg-[var(--bg-elevated)] p-4 rounded-none border border-[var(--border-app)] space-y-3">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Black & White (A4)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Single Sided (₹)</label>
                  <input
                    type="number"
                    step="0.50"
                    value={pricing.bwA4Single}
                    onChange={(e) => setPricing({ ...pricing, bwA4Single: e.target.value })}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Double Sided (₹)</label>
                  <input
                    type="number"
                    step="0.50"
                    value={pricing.bwA4Double}
                    onChange={(e) => setPricing({ ...pricing, bwA4Double: e.target.value })}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>
            </div>

            {/* Color A4 Rates */}
            <div className="bg-[var(--bg-elevated)] p-4 rounded-none border border-[var(--border-app)] space-y-3">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Color Print (A4)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Single Sided (₹)</label>
                  <input
                    type="number"
                    step="0.50"
                    value={pricing.colorA4Single}
                    onChange={(e) => setPricing({ ...pricing, colorA4Single: e.target.value })}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Double Sided (₹)</label>
                  <input
                    type="number"
                    step="0.50"
                    value={pricing.colorA4Double}
                    onChange={(e) => setPricing({ ...pricing, colorA4Double: e.target.value })}
                    className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>
            </div>

            {/* Passport Photo */}
            <div className="bg-[var(--bg-elevated)] p-4 rounded-none border border-[var(--border-app)] space-y-3">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Passport / Photo Prints</h3>
              <div className="space-y-1 max-w-xs">
                <label className="text-xs text-[var(--text-secondary)] font-medium">Price per Sheet (₹)</label>
                <input
                  type="number"
                  step="1.00"
                  value={pricing.passportPrice}
                  onChange={(e) => setPricing({ ...pricing, passportPrice: e.target.value })}
                  className="w-full h-9 px-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {pricingSaveSuccess && (
              <span className="text-xs font-medium text-[#22C55E] flex items-center gap-1.5">
                <MaterialIcon name="check" size={16} className="text-[#22C55E]" />
                <span>Pricing rates saved successfully!</span>
              </span>
            )}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={savingPricing}
                className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-30 text-white font-semibold text-xs rounded-none transition-colors flex items-center justify-center gap-2 cursor-pointer dark:text-black"
              >
                {savingPricing ? <MaterialIcon name="progress_activity" size={14} className="animate-spin" /> : <MaterialIcon name="save" size={14} />}
                <span>Save Pricing</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 4. APPEARANCE SETTINGS SECTION */}
      {activeSettingsSection === "APPEARANCE" && (
        <div className="space-y-6">
          <div className="pb-2">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <MaterialIcon name="palette" size={20} className="text-[var(--color-accent)]" />
              <span>Appearance</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
              Customize the look and feel of the Admin Desktop interface
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Dark Mode Option */}
            <div
              onClick={() => setTheme("dark")}
              className={`p-5 rounded-none border cursor-pointer transition-all space-y-2 ${
                isDark
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-[var(--border-app)] bg-[var(--bg-elevated)] hover:bg-[var(--border-app)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="dark_mode" size={16} className="text-[var(--color-accent)]" />
                  <span className="text-xs font-bold text-[var(--text-primary)]">Dark Desktop Mode</span>
                </div>
                {isDark && <MaterialIcon name="check" size={16} className="text-[var(--color-accent)]" />}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                High-contrast professional dark software theme optimized for counters
              </p>
            </div>

            {/* Light Mode Option */}
            <div
              onClick={() => setTheme("light")}
              className={`p-5 rounded-none border cursor-pointer transition-all space-y-2 ${
                !isDark
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-[var(--border-app)] bg-[var(--bg-elevated)] hover:bg-[var(--border-app)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="light_mode" size={16} className="text-amber-500" />
                  <span className="text-xs font-bold text-[var(--text-primary)]">Light Desktop Mode</span>
                </div>
                {!isDark && <MaterialIcon name="check" size={16} className="text-[var(--color-accent)]" />}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Clean and bright high-visibility theme for daylight store environments
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5. NOTIFICATIONS SETTINGS SECTION */}
      {activeSettingsSection === "NOTIFICATIONS" && (
        <div className="space-y-6">
          <div className="pb-2">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <MaterialIcon name="notifications" size={20} className="text-[var(--color-accent)]" />
              <span>Notifications & Alerts</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
              Configure real-time incoming order popups, audio cues, and hardware alerts
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">New Order Accept / Decline Popup</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Show instant desktop notification popup when a customer sends a print job
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifications.newOrderPopup}
                onClick={() => handleToggleNotification("newOrderPopup")}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border border-[var(--border-app)] ${
                  notifications.newOrderPopup ? "bg-[var(--color-accent)]" : "bg-[var(--bg-surface)]"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                    notifications.newOrderPopup ? "left-6 bg-white dark:bg-black" : "left-1 bg-[var(--text-muted)]"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">Print Sound Notification</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Play audible chime when print job starts or finishes
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifications.printSound}
                onClick={() => handleToggleNotification("printSound")}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border border-[var(--border-app)] ${
                  notifications.printSound ? "bg-[var(--color-accent)]" : "bg-[var(--bg-surface)]"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                    notifications.printSound ? "left-6 bg-white dark:bg-black" : "left-1 bg-[var(--text-muted)]"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] rounded-none border border-[var(--border-app)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">Printer Hardware Issue Alerts</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Notify immediately if printer is offline, out of paper, or disconnected
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifications.printerAlerts}
                onClick={() => handleToggleNotification("printerAlerts")}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border border-[var(--border-app)] ${
                  notifications.printerAlerts ? "bg-[var(--color-accent)]" : "bg-[var(--bg-surface)]"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                    notifications.printerAlerts ? "left-6 bg-white dark:bg-black" : "left-1 bg-[var(--text-muted)]"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
