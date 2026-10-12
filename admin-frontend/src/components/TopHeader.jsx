import React from "react";
import { MaterialIcon } from "./ui/MaterialIcon";
import { useTheme } from "../context/ThemeContext";

export const TopHeader = ({
  activeTab = "DASHBOARD",
  setActiveTab,
  shopIsOpen = true,
  isTogglingShopStatus = false,
  onToggleShopStatus,
  isRefreshing = false,
  onRefresh,
  user,
}) => {
  const { theme, toggleTheme, isDark } = useTheme();

  const getPageTitle = () => {
    switch (activeTab) {
      case "DASHBOARD":
        return { title: "Dashboard", subtitle: "Live shop counter overview and metrics" };
      case "ORDERS":
        return { title: "Orders Queue", subtitle: "Incoming and active print requests" };
      case "FILES":
        return { title: "Shop File Storage", subtitle: "Manage and purge customer print documents" };
      case "PRICING":
        return { title: "Pricing Rates", subtitle: "Configure print rates per page" };
      case "QR":
        return { title: "Shop Counter QR", subtitle: "Printable counter QR for customer upload" };
      case "SETTINGS":
        return { title: "Settings", subtitle: "Shop profile, password, and preferences" };
      default:
        return { title: "Dashboard", subtitle: "Live shop counter overview" };
    }
  };

  const { title, subtitle } = getPageTitle();

  return (
    <header className="bg-[var(--bg-surface)] border-b border-[var(--border-app)] sticky top-0 z-10 select-none transition-colors duration-200">
      <div className="w-full px-4 sm:px-8 py-2.5 flex items-center justify-between gap-4">
        {/* Left: Active Page Title & Subtitle */}
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-[var(--text-primary)] uppercase tracking-wider leading-tight truncate">
            {title}
          </h1>
          <p className="text-[11px] text-[var(--text-secondary)] font-normal hidden sm:block truncate">
            {subtitle}
          </p>
        </div>

        {/* Right: [ ● Active (Accepting orders) ON/OFF Toggle ] [ Theme Toggle ] [ Refresh ] [ Profile ] */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Shop Status Control */}
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-none border border-[var(--border-app)] bg-[var(--bg-panel)] text-[var(--text-primary)] transition-colors duration-200">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-none shrink-0 ${
                  shopIsOpen ? "bg-black dark:bg-white" : "bg-[var(--text-muted)]"
                }`}
              />
              <div className="leading-tight flex items-center gap-1.5">
                <span className="text-xs font-bold font-mono uppercase tracking-wider text-[var(--text-primary)]">
                  {shopIsOpen ? "Active" : "Closed"}
                </span>
                <span className="hidden sm:inline text-[11px] text-[var(--text-secondary)] font-normal">
                  ({shopIsOpen ? "Accepting orders" : "Not accepting"})
                </span>
              </div>
            </div>

            {/* Dedicated Accessible Switch Button */}
            <button
              type="button"
              role="switch"
              aria-checked={shopIsOpen}
              aria-label="Toggle Shop Active Status"
              disabled={isTogglingShopStatus}
              onClick={(e) => {
                e.stopPropagation();
                if (onToggleShopStatus) onToggleShopStatus();
              }}
              className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-[var(--border-app)] transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                shopIsOpen ? "bg-[#22C55E]" : isDark ? "bg-[#222222]" : "bg-[#D1D5DB]"
              }`}
              title={shopIsOpen ? "Click switch to close shop" : "Click switch to activate shop"}
            >
              <span className="sr-only">Toggle shop status</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                  shopIsOpen ? "translate-x-3.5" : "translate-x-0"
                } flex items-center justify-center`}
              >
                {isTogglingShopStatus ? (
                  <span className="w-1.5 h-1.5 rounded-none bg-white dark:bg-black animate-ping" />
                ) : null}
              </span>
            </button>
          </div>

          {/* Theme Toggle Button (Light/Dark Mode) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="btn-icon-ghost"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <MaterialIcon
              name={isDark ? "light_mode" : "dark_mode"}
              size={18}
              className="text-[var(--text-primary)]"
            />
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => onRefresh && onRefresh()}
            disabled={isRefreshing}
            className="btn-icon-ghost disabled:opacity-50"
            title="Refresh orders"
            aria-label="Refresh orders"
          >
            <MaterialIcon
              name="refresh"
              size={18}
              className={isRefreshing ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>
    </header>
  );
};
