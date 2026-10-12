"use client";
import React from "react";

/**
 * MaterialIcon
 * Renders a Google Material Symbol Outlined icon from the locally bundled font.
 * Fully offline-capable — zero external or CDN dependencies.
 *
 * @param {string} name - Material symbol ligature name (e.g. 'dashboard', 'receipt_long', 'print')
 * @param {number|string} size - Pixel size (default 20)
 * @param {string} className - Optional Tailwind or utility classes
 * @param {boolean} filled - Optional filled state (default false)
 * @param {object} style - Optional inline styles
 * @param {string} ariaLabel - Optional accessible label for icon-only controls
 */
export const MaterialIcon = ({
  name,
  size = 20,
  className = "",
  filled = false,
  style = {},
  ariaLabel,
  ...props
}: any) => {
  if (!name) return null;

  const sizeStyle = typeof size === "number" ? `${size}px` : size;
  const fontVariationSettings = filled
    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
    : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";

  return (
    <span
      className={`material-symbols-outlined shrink-0 select-none inline-flex items-center justify-center leading-none ${className}`}
      style={{
        fontSize: sizeStyle,
        width: sizeStyle,
        height: sizeStyle,
        fontVariationSettings,
        ...style,
      }}
      aria-hidden={ariaLabel ? undefined : "true"}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      {name}
    </span>
  );
};

export default MaterialIcon;
