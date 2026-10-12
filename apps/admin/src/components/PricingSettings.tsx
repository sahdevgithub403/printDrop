"use client";
import React, { useEffect, useState } from "react";
import { getShopPricing, updateShopPricing } from "../api";
import { MaterialIcon } from "./ui/MaterialIcon";

export const PricingSettings = () => {
  const [pricing, setPricing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchPricing();
  }, []);

  const fetchPricing = async () => {
    setLoading(true);
    try {
      const data = await getShopPricing();
      setPricing(data);
    } catch (err: any) {
      console.error("Failed to fetch pricing:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field, value) => {
    if (!pricing) return;
    const numValue = parseFloat(value) || 0;
    setPricing({ ...pricing, [field]: numValue });
    setHasChanges(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!pricing) return;
    setSaving(true);
    setSuccessMsg(false);
    try {
      const updated = await updateShopPricing(pricing);
      setPricing(updated);
      setSuccessMsg(true);
      setHasChanges(false);
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-7 w-48 bg-[var(--bg-elevated)] rounded-none animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-56 bg-[var(--bg-elevated)] rounded-none animate-pulse" />
          <div className="h-56 bg-[var(--bg-elevated)] rounded-none animate-pulse" />
        </div>
      </div>
    );
  }

  if (!pricing) return null;

  return (
    <form onSubmit={handleSave} className="space-y-6 text-[var(--text-primary)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Printing Rates</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-normal">
            Configure per-page rates for automated price calculation on customer orders.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || !hasChanges}
          className="btn-primary-sm cursor-pointer disabled:opacity-30 self-start"
        >
          {saving ? (
            <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
          ) : (
            <MaterialIcon name="save" size={14} />
          )}
          <span>Save Changes</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-none bg-[var(--color-success-bg)] border border-[var(--color-success-border)] text-[var(--color-success-text)] text-xs font-medium flex items-center gap-2.5">
          <MaterialIcon name="check_circle" size={16} className="text-[#22C55E] shrink-0" />
          <span>Pricing rates saved successfully.</span>
        </div>
      )}

      {/* Grid of rates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section 1: A4 Paper Rates */}
        <div className="space-y-4 bg-[var(--bg-elevated)] p-5 rounded-none border border-[var(--border-app)]">
          <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
            A4 Paper Rates
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                B&W Single Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={pricing.bwA4Single}
                  onChange={(e) =>
                    handleFieldChange("bwA4Single", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                B&W Double Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={pricing.bwA4Double}
                  onChange={(e) =>
                    handleFieldChange("bwA4Double", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Color Single Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.colorA4Single}
                  onChange={(e) =>
                    handleFieldChange("colorA4Single", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Color Double Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.colorA4Double}
                  onChange={(e) =>
                    handleFieldChange("colorA4Double", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: A3 Paper Rates */}
        <div className="space-y-4 bg-[var(--bg-elevated)] p-5 rounded-none border border-[var(--border-app)]">
          <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
            A3 Paper Rates
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                B&W Single Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.bwA3Single}
                  onChange={(e) =>
                    handleFieldChange("bwA3Single", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                B&W Double Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.bwA3Double}
                  onChange={(e) =>
                    handleFieldChange("bwA3Double", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Color Single Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.colorA3Single}
                  onChange={(e) =>
                    handleFieldChange("colorA3Single", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Color Double Side
              </label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  step="1"
                  value={pricing.colorA3Double}
                  onChange={(e) =>
                    handleFieldChange("colorA3Double", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Special Services Rates (Passport Photo) */}
        <div className="space-y-4 bg-[var(--bg-elevated)] p-5 rounded-none border border-[var(--border-app)] md:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Special Services Rates
            </h3>
            <span className="text-xs text-[var(--text-secondary)]">
              Standard 8-photo layout grid creation and print
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
            <div className="flex items-center justify-between gap-4 bg-[var(--bg-surface)] p-3.5 rounded-none border border-[var(--border-app)]">
              <div>
                <label htmlFor="passport-price-input" className="text-xs font-bold text-[var(--text-primary)] block">
                  Passport Photo Sheet
                </label>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 font-normal">
                  8 photos on 4x6 / A4 glossy photo sheet
                </p>
              </div>
              <div className="relative w-32 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] pointer-events-none">
                  ₹
                </span>
                <input
                  id="passport-price-input"
                  type="number"
                  step="1"
                  min="0"
                  value={pricing.passportPrice !== undefined && pricing.passportPrice !== null ? pricing.passportPrice : ""}
                  onChange={(e) =>
                    handleFieldChange("passportPrice", e.target.value)
                  }
                  className="w-full h-9 pl-7 pr-3 bg-[var(--bg-input)] border border-[var(--border-app)] rounded-none text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
};
