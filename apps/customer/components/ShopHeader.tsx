"use client";
import React from "react";
import { Printer, MapPin, Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export const ShopHeader = ({shop }: any) => {
  const { toggleTheme, isDark } = useTheme();

  return (
    <header className="bg-[var(--bg-surface)] border-b border-[var(--border-app)] py-3 sm:py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs transition-colors duration-200">
      <div className="max-w-xl mx-auto flex items-center justify-between gap-3 sm:gap-4">
        {/* Shop Info */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[var(--color-accent)] text-[var(--pill-active-text)] flex items-center justify-center font-bold shrink-0 shadow-xs">
            <Printer className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-extrabold text-[var(--text-primary)] truncate leading-tight tracking-tight">
              {shop.name}
            </h1>
            <p className="text-[11px] sm:text-sm text-[var(--text-secondary)] flex items-center gap-1 mt-0.5 truncate font-medium">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
              <span>
                {shop.address || "Instant Print Counter · Print & Xerox"}
              </span>
            </p>
          </div>
        </div>

        {/* Right side controls: Status badge & Theme toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 hidden sm:inline-block">
            Open Counter
          </span>
          <span className="text-[10px] sm:text-xs font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 sm:hidden">
            Open
          </span>

          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-center border border-[var(--border-app)] bg-[var(--bg-surface)] cursor-pointer shrink-0"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? (
              <Moon className="w-4 h-4 text-blue-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
