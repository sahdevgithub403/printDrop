"use client";
/* Tiny route helper kept dependency-free so App.jsx can match the
 * Document Studio route without pulling pdf.js/pdf-lib into the main bundle. */
export const parseStudioHash = (hash) => {
  const m = /^#\/studio\/([^/]+)\/([^/?]+)/.exec(hash || "");
  return m ? { orderId: m[1], itemId: m[2] } : null;
};
