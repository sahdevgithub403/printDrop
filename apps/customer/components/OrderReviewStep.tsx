"use client";
import React, { useState, useRef } from "react";
import { createOrder, verifyPayment, cancelPayment } from "../api";
import {
  ArrowLeft,
  CreditCard,
  Wallet,
  Check,
  Loader2,
  FileText,
  X,
  AlertCircle,
  UserSquare2,
} from "lucide-react";

export const OrderReviewStep = ({shopId,
  items,
  onBack,
  onOrderCompleted,
}: any) => {
  const [paymentMethod, setPaymentMethod] = useState("PAY_AT_SHOP");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<any>(null);
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef<any>(null);
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }

  const calculateOrderTotal = () => {
    return items.reduce(
      (sum: any, item: any) => sum + (item.pricing?.totalPrice || 0),
      0,
    );
  };

  const handleSubmitOrder = async (e: any) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setErrorMessage(null);

    // Validate valid uploaded documents exist
    const validItems = items.filter(
      (item: any) => item.uploadedDocument && item.uploadedDocument.id,
    );
    if (validItems.length === 0) {
      setErrorMessage(
        "No uploaded documents found. Please re-upload your files before submitting.",
      );
      submitLockRef.current = false;
      return;
    }

    // Validate name (no silent Walk-in override) + phone format
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setErrorMessage("Please enter your name to place the order.");
      submitLockRef.current = false;
      return;
    }
    const trimmedPhone = customerPhone.trim();
    if (trimmedPhone && !/^\d{10,15}$/.test(trimmedPhone)) {
      setErrorMessage("Please enter a valid mobile number (10-15 digits).");
      submitLockRef.current = false;
      return;
    }

    setIsSubmitting(true);

    try {
      const orderItemsReq = validItems.map((item: any) => {
        const docId = item.uploadedDocument.id;
        const pageRangeStr =
          item.settings.pageRangeOption === "ALL" ||
          !item.settings.customPageRange?.trim()
            ? "ALL"
            : item.settings.customPageRange.trim();

        return {
          documentId: docId,
          printType: item.settings.printType || "PRINT",
          colorMode: item.settings.colorMode || "BW",
          paperSize: item.settings.paperSize || "A4",
          printSide: item.settings.printSide || "SINGLE",
          pageRange: pageRangeStr,
          copies: Math.min(100, Math.max(1, item.settings.copies || 1)),
        };
      });

      const firstItem = orderItemsReq[0];

      // Populate both multi-item list and top-level properties for maximum backend compatibility
      const orderReq = {
        shopId,
        paymentMethod,
        customerName: trimmedName,
        customerPhone: trimmedPhone,
        idempotencyKey: idempotencyKeyRef.current,
        items: orderItemsReq,

        // Top-level legacy fields compatibility
        documentId: firstItem.documentId,
        printType: firstItem.printType,
        colorMode: firstItem.colorMode,
        paperSize: firstItem.paperSize,
        printSide: firstItem.printSide,
        pageRange: firstItem.pageRange,
        copies: firstItem.copies,
      };

      const order = await createOrder(orderReq, idempotencyKeyRef.current);

      if (paymentMethod === "ONLINE") {
        if (!(window as any).Razorpay) {
          let cancelErrMsg = "";
          try {
            await cancelPayment(order.id);
          } catch (cancelErr: any) {
            cancelErrMsg =
              cancelErr?.response?.data?.message ||
              cancelErr?.message ||
              "Could not cancel the created order.";
          }
          setErrorMessage(
            "Online payment is unavailable (payment script failed to load). Your order was not charged." +
              (cancelErrMsg ? ` Order cancel note: ${cancelErrMsg}` : " The created order was cancelled."),
          );
          setIsSubmitting(false);
          submitLockRef.current = false;
          return;
        }
        const options = {
          key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_dummy",
          amount: Math.round(order.totalPrice * 100),
          currency: "INR",
          name: "PrintAlfa",
          description: `Order #${order.orderNumber}`,
          order_id: order.razorpayOrderId,
          handler: async function (response: any) {
            try {
              await verifyPayment({
                orderId: order.id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
                success: true,
              });
              onOrderCompleted(order.publicToken, order.orderNumber);
            } catch (err: any) {
              let cancelNote = "";
              try {
                await cancelPayment(order.id);
              } catch (cancelErr: any) {
                cancelNote = ` Cancel note: ${cancelErr?.response?.data?.message || cancelErr?.message || "could not cancel order"}.`;
              }
              const verifyMsg =
                err?.response?.data?.message ||
                err?.message ||
                "Payment verification failed.";
              setErrorMessage(`${verifyMsg} The order was cancelled and you were not charged.${cancelNote}`);
              setIsSubmitting(false);
              submitLockRef.current = false;
            }
          },
          prefill: {
            name: customerName,
            contact: customerPhone,
          },
          theme: {
            color: "#111111",
          },
          modal: {
            ondismiss: function () {
              setIsSubmitting(false);
              submitLockRef.current = false;
              cancelPayment(order.id).catch((cancelErr: any) => {
                setErrorMessage(
                  `Payment window closed. Order cancelled.${cancelErr?.message ? ` Note: ${cancelErr.message}` : ""}`,
                );
              });
            },
          },
        };

        let rzp;
        try {
          rzp = new (window as any).Razorpay(options);
        } catch (rzpErr: any) {
          try {
            await cancelPayment(order.id);
          } catch (cancelErr: any) {
            setErrorMessage(
              `Could not open payment window. ${cancelErr?.response?.data?.message || cancelErr?.message || "Order cancel attempted."}`,
            );
            setIsSubmitting(false);
            submitLockRef.current = false;
            return;
          }
          setErrorMessage("Could not open payment window. The order was cancelled. Please try again.");
          setIsSubmitting(false);
          submitLockRef.current = false;
          return;
        }
        rzp.on("payment.failed", function (response: any) {
          setErrorMessage(
            response?.error?.description ||
              "Payment failed or was cancelled. Please try again.",
          );
          setIsSubmitting(false);
          submitLockRef.current = false;
          cancelPayment(order.id).catch((cancelErr: any) => {
            setErrorMessage(
              `Payment failed. Order cancel note: ${cancelErr?.response?.data?.message || cancelErr?.message || "could not confirm cancellation"}.`,
            );
          });
        });
        rzp.open();
      } else {
        onOrderCompleted(order.publicToken, order.orderNumber);
      }
    } catch (err: any) {
      console.error("Order creation failed:", err);
      const apiMessage =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to submit print order. Please try again.";
      setErrorMessage(apiMessage);
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const totalAmount = calculateOrderTotal();

  return (
    <form onSubmit={handleSubmitOrder} className="space-y-8 pb-16">
      {/* Back Button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>Back to print options</span>
      </button>

      {/* Editorial Heading */}
      <div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
          Review & Payment
        </h2>
        <p className="text-base text-[var(--text-secondary)] mt-2 font-medium">
          Verify your {items.length} print file items and choose payment option
          before sending to shop counter.
        </p>
      </div>

      {/* Error Alert Box */}
      {errorMessage && (
        <div className="p-5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-300 text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 dark:text-rose-300 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 hover:bg-rose-500/20 rounded-lg transition-colors text-rose-500 dark:text-rose-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Container */}
      <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-app)] p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[var(--border-app)]">
          <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
            Order Items ({items.length})
          </span>
          <span className="text-xs font-bold text-[var(--text-secondary)]">Price</span>
        </div>

        {/* Item Rows */}
        <div className="space-y-4 divide-y divide-[var(--border-app)]">
          {items.map((item: any, idx: any) => {
            const fileName =
              item.uploadedDocument?.originalFileName ||
              item.file?.name ||
              `File ${idx + 1}`;
            const pageCount =
              item.pricing?.calculatedPages ||
              item.uploadedDocument?.pageCount ||
              1;
            const price = item.pricing?.totalPrice || 0;

            return (
              <div
                key={item.localId}
                className={`flex items-start justify-between gap-3 sm:gap-4 ${idx > 0 ? "pt-3 sm:pt-4" : ""}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)] mt-0.5">
                    {item.settings.printType === "PASSPORT_PHOTO" ? (
                      <UserSquare2 className="w-5 h-5" />
                    ) : (
                      <FileText className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-[var(--text-primary)] truncate">
                      {item.settings.printType === "PASSPORT_PHOTO" ? "Passport Photo" : fileName}
                    </p>
                    <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5 font-medium">
                      {item.settings.printType === "PASSPORT_PHOTO" ? (
                        "Ready to Print Layout"
                      ) : (
                        <>
                          {item.settings.colorMode === "BW" ? "B&W" : "Color"} ·{" "}
                          {item.settings.paperSize} ·{" "}
                          {item.settings.printSide === "SINGLE"
                            ? "Single-sided"
                            : "Double-sided"}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {pageCount} {pageCount === 1 ? "page" : "pages"} ·{" "}
                      {item.settings.copies}{" "}
                      {item.settings.copies === 1 ? "copy" : "copies"}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-base font-extrabold text-[var(--text-primary)]">
                    ₹{price.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Total Cost Row */}
        <div className="pt-5 border-t border-[var(--border-app)] flex items-center justify-between">
          <span className="text-base font-bold text-[var(--text-primary)]">
            Total Order Amount
          </span>
          <span className="text-2xl font-extrabold text-[var(--text-primary)]">
            ₹{totalAmount.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Customer Contact Info */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
          Your Info (Optional)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <input
            type="text"
            placeholder="Your Name"
            value={customerName}
            onChange={(e: any) => setCustomerName(e.target.value)}
            className="input-field"
          />

          <input
            type="tel"
            placeholder="Mobile Number"
            value={customerPhone}
            onChange={(e: any) => setCustomerPhone(e.target.value)}
            className="input-field"
          />
        </div>
      </div>

      {/* Payment Selection Options */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
          Payment Method
        </label>

        {/* Option 1: Pay at Shop Counter */}
        <div
          onClick={() => setPaymentMethod("PAY_AT_SHOP")}
          className={`selection-row min-h-[76px] cursor-pointer ${paymentMethod === "PAY_AT_SHOP" ? "selection-row-active" : ""}`}
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center border border-[var(--border-app)] shrink-0">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-bold text-[var(--text-primary)]">
                Pay at Shop Counter
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5 font-medium">
                Pay cash or UPI upon collecting prints
              </p>
            </div>
          </div>
          {paymentMethod === "PAY_AT_SHOP" && (
            <Check className="w-6 h-6 text-[var(--text-primary)]" />
          )}
        </div>

        {/* Option 2: Pay Online Now */}
        <div
          onClick={() => setPaymentMethod("ONLINE")}
          className={`selection-row min-h-[76px] cursor-pointer ${paymentMethod === "ONLINE" ? "selection-row-active" : ""}`}
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center border border-[var(--border-app)] shrink-0">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-bold text-[var(--text-primary)]">
                Pay Online Now
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5 font-medium">
                Pay instantly via UPI or Card
              </p>
            </div>
          </div>
          {paymentMethod === "ONLINE" && (
            <Check className="w-6 h-6 text-[var(--text-primary)]" />
          )}
        </div>
      </div>

      {/* Primary Action Button (Solid Black 56px height) */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full h-14 text-base font-bold mt-4"
      >
        {isSubmitting ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : paymentMethod === "ONLINE" ? (
          <span>Pay ₹{totalAmount.toFixed(2)}</span>
        ) : (
          <span>Send Order ({items.length} files)</span>
        )}
      </button>
    </form>
  );
};
