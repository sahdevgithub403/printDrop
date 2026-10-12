"use client";
import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getShopBySlug } from "../../../api";
import { ShopHeader } from "../../../components/ShopHeader";
import { FileUploadStep } from "../../../components/FileUploadStep";
import { PrintOptionsStep } from "../../../components/PrintOptionsStep";
import { OrderReviewStep } from "../../../components/OrderReviewStep";
import { JobTypeSelectionStep } from "../../../components/JobTypeSelectionStep";
import { PassportPhotoStep } from "../../../components/PassportPhotoStep";
import { Loader2, AlertCircle } from "lucide-react";

const CustomerShopPage = () => {
  const params = useParams();
  const shopSlug = params.shopSlug as string;
  const router = useRouter();

  const [shop, setShop] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [step, setStep] = useState(0); // 0 = type selection
  const [printJobType, setPrintJobType] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const shopAbortRef = useRef<any>(null);

  useEffect(() => {
    if (shopAbortRef.current) {
      shopAbortRef.current.abort();
    }
    const controller = new AbortController();
    shopAbortRef.current = controller;
    fetchShopDetails(controller.signal);
    return () => {
      controller.abort();
    };
  }, [shopSlug]);

  const fetchShopDetails = async (signal: any) => {
    setLoading(true);
    setError(null);
    try {
      const slug = shopSlug || "";
      const shopData = await getShopBySlug(slug, { signal });
      if (signal?.aborted) return;
      setShop(shopData);
    } catch (err: any) {
      if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || signal?.aborted) return;
      setError("Shop not found or link is invalid.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  const handleSelectJobType = (type: any) => {
    // Isolate items per job type: clear stale items on switch
    if (printJobType && printJobType !== type && items.length > 0) {
      setItems([]);
    }
    setPrintJobType(type);
    setStep(1);
  };

  const handleOrderCompleted = (publicToken: any, orderNumber: any) => {
    router.push(`/order/${publicToken}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col items-center justify-center p-6 transition-colors duration-200">
        <Loader2 className="w-8 h-8 text-[var(--text-primary)] animate-spin mb-3" />
        <span className="text-[var(--text-secondary)] font-semibold text-base">
          Loading shop counter...
        </span>
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] p-6 flex flex-col items-center justify-center text-center transition-colors duration-200">
        <div className="bg-[var(--bg-surface)] p-8 rounded-2xl border border-[var(--border-app)] max-w-sm space-y-4 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Shop Not Found</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {error || "Please verify the QR code or URL link."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col transition-colors duration-200">
      <ShopHeader shop={shop} />

      {/* Main Editorial Flow */}
      <main className="flex-1 max-w-xl w-full mx-auto px-5 sm:px-6 pt-8 pb-16">
        {/* Step Progression Bar */}
        <div className="mb-8 sm:mb-10 bg-[var(--bg-surface)] rounded-xl p-3 border border-[var(--border-app)] flex items-center justify-between text-sm font-bold shadow-xs">
          <div
            className={`flex items-center gap-2 sm:gap-2.5 ${step >= 1 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
          >
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold shadow-xs ${step >= 1 ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)]" : "bg-[var(--bg-subtle)] border border-[var(--border-app)] text-[var(--text-muted)]"}`}
            >
              1
            </span>
            <span className="hidden sm:inline">Upload</span>
          </div>
          <div className={`h-1 rounded-full flex-1 mx-2 sm:mx-4 ${step >= 2 ? "bg-[var(--pill-active-bg)]" : "bg-[var(--border-app)]"}`} />
          <div
            className={`flex items-center gap-2 sm:gap-2.5 ${step >= 2 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
          >
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold shadow-xs ${step >= 2 ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)]" : "bg-[var(--bg-subtle)] border border-[var(--border-app)] text-[var(--text-muted)]"}`}
            >
              2
            </span>
            <span className="hidden sm:inline">Options</span>
          </div>
          <div className={`h-1 rounded-full flex-1 mx-2 sm:mx-4 ${step >= 3 ? "bg-[var(--pill-active-bg)]" : "bg-[var(--border-app)]"}`} />
          <div
            className={`flex items-center gap-2 sm:gap-2.5 ${step >= 3 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
          >
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold shadow-xs ${step >= 3 ? "bg-[var(--pill-active-bg)] text-[var(--pill-active-text)]" : "bg-[var(--bg-subtle)] border border-[var(--border-app)] text-[var(--text-muted)]"}`}
            >
              3
            </span>
            <span className="hidden sm:inline">Review</span>
          </div>
        </div>

        {step === 0 && (
          <JobTypeSelectionStep
            onSelect={handleSelectJobType}
          />
        )}

        {step === 1 && printJobType === "DOCUMENT" && (
          <FileUploadStep
            items={items}
            onItemsChange={setItems}
            onContinue={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}

        {step === 1 && printJobType === "PASSPORT_PHOTO" && (
          <PassportPhotoStep
            shopId={shop.id}
            onComplete={(newItems: any) => {
              setItems(newItems);
              setStep(3); // Skip options, go straight to review
            }}
            onBack={() => setStep(0)}
          />
        )}

        {step === 2 && items.length > 0 && printJobType === "DOCUMENT" && (
          <PrintOptionsStep
            shopId={shop.id}
            items={items}
            onItemsChange={setItems}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        )}

        {step === 3 && items.length > 0 && (
          <OrderReviewStep
            shopId={shop.id}
            items={items}
            onBack={() => {
              if (printJobType === "PASSPORT_PHOTO") {
                setStep(1);
              } else {
                setStep(2);
              }
            }}
            onOrderCompleted={handleOrderCompleted}
          />
        )}
      </main>
    </div>
  );
};


export default CustomerShopPage;
