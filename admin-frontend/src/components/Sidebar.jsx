import React, { useState, useRef, useEffect } from "react";
import { MaterialIcon } from "./ui/MaterialIcon";
import { useTheme } from "../context/ThemeContext";

export const Sidebar = ({
  isCollapsed = false,
  onToggleCollapse,
  activeTab,
  setActiveTab,
  user,
  onLogout,
  pendingCount = 0,
  printingCount = 0,
  isRefreshing = false,
  wsStatus = "CONNECTED",
  onRefresh,
}) => {
  const { theme, toggleTheme, isDark } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const shopName = user?.shopName || "Sahdeva 403";
  const userEmail = user?.email || "sahdeva403@gmail.com";
  const userPlan = user?.plan || "FREE";
  const userInitial = (shopName || userEmail || "S")[0].toUpperCase();

  const navItems = [
    {
      id: "DASHBOARD",
      label: "Dashboard",
      icon: "dashboard",
      badge: pendingCount > 0 ? pendingCount : null,
    },
    {
      id: "ORDERS",
      label: "Orders",
      icon: "receipt_long",
    },
    {
      id: "FILES",
      label: "Files",
      icon: "folder_open",
    },
    {
      id: "HISTORY",
      label: "History",
      icon: "history",
    },
    {
      id: "PRICING",
      label: "Pricing",
      icon: "payments",
    },
    {
      id: "QR",
      label: "Shop QR",
      icon: "qr_code_2",
    },
    {
      id: "SETTINGS",
      label: "Settings",
      icon: "settings",
    },
  ];

  const renderConnectionDot = () => {
    switch (wsStatus) {
      case "CONNECTED":
        return <span className="w-2 h-2 rounded-none bg-white" title="Live Sync Active" />;
      case "CONNECTING":
      case "RECONNECTING":
        return <span className="w-2 h-2 rounded-none bg-zinc-500 animate-pulse" title="Connecting..." />;
      case "DISCONNECTED":
        return <span className="w-2 h-2 rounded-none bg-zinc-600" title="Disconnected" />;
      default:
        return <span className="w-2 h-2 rounded-none bg-zinc-500" title="Sync Ready" />;
    }
  };

  return (
    <aside
      className={`h-screen sticky top-0 bg-[#09090b] text-zinc-100 border-r border-zinc-800 flex flex-col justify-between transition-all duration-200 ease-in-out shrink-0 z-20 select-none ${
        isCollapsed ? "w-[64px] p-2.5" : "w-64 p-3.5"
      }`}
    >
      {/* Top Section: Brand Header & Navigation */}
      <div className="space-y-5">
        {/* Header / Brand */}
        <div
          className={`flex items-center ${
            isCollapsed ? "justify-center" : "justify-between"
          } pb-1 border-b border-zinc-800/60 pb-3`}
        >
          {!isCollapsed ? (
            <>
              <div className="flex items-center space-x-2.5 min-w-0">
                <MaterialIcon name="print" size={18} className="text-white" />
                <div className="min-w-0">
                  <h2 className="text-xs font-bold text-white tracking-wider uppercase truncate leading-tight">
                    PrintDrop
                  </h2>
                  <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider truncate">
                    Admin Terminal
                  </p>
                </div>
              </div>

              {/* Collapse Button */}
              <button
                type="button"
                onClick={onToggleCollapse}
                className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 rounded-none transition-colors cursor-pointer"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <MaterialIcon name="first_page" size={18} />
              </button>
            </>
          ) : (
            /* Collapsed Brand Toggle Button */
            <button
              type="button"
              onClick={onToggleCollapse}
              className="w-9 h-9 rounded-none text-zinc-200 flex items-center justify-center hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all group relative cursor-pointer"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <MaterialIcon name="print" size={18} className="transition-transform group-hover:scale-90 group-hover:opacity-0 absolute" />
              <MaterialIcon name="last_page" size={18} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {!isCollapsed && (
            <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest px-2.5 mb-2">
              Menu
            </p>
          )}

          {navItems.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`transition-all duration-150 flex items-center group relative cursor-pointer font-medium ${
                  isCollapsed
                    ? `w-10 h-10 mx-auto rounded-none justify-center border ${
                        isActive
                          ? "bg-white text-black font-bold border-white"
                          : "border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                      }`
                    : `w-full h-9.5 px-3 rounded-none text-[13px] justify-between border ${
                        isActive
                          ? "bg-white text-black font-semibold border-white"
                          : "border-transparent text-zinc-300 hover:text-white hover:bg-zinc-900/90"
                      }`
                }`}
                title={isCollapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <div className="flex items-center gap-2.5">
                  <MaterialIcon
                    name={item.icon}
                    size={18}
                    className={`transition-colors ${
                      isActive
                        ? "text-black"
                        : "text-zinc-400 group-hover:text-zinc-100"
                    }`}
                  />
                  {!isCollapsed && (
                    <span className="tracking-tight">{item.label}</span>
                  )}
                </div>

                {/* Badge Indicator */}
                {item.badge !== null && item.badge !== undefined && (
                  isCollapsed ? (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-white rounded-none ring-1 ring-black" />
                  ) : (
                    <span
                      className={`px-1.5 py-0.2 rounded-none text-[10px] font-mono font-bold transition-colors ${
                        isActive
                          ? "bg-black text-white"
                          : "bg-zinc-800 text-zinc-200"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Area */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
        {/* Live Sync Status Row */}
        {!isCollapsed ? (
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-2 px-1 py-1 uppercase">
              {renderConnectionDot()}
              Sync Active
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 rounded-none transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh queue"
              aria-label="Refresh queue"
            >
              <MaterialIcon
                name="refresh"
                size={16}
                className={isRefreshing ? "animate-spin text-white" : ""}
              />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div
              className="p-2 rounded-none"
              title="Live Sync Active"
            >
              {renderConnectionDot()}
            </div>
          </div>
        )}

        {/* Single Bottom Profile Trigger & Anchored Upward Account Menu */}
        <div className="relative" ref={profileMenuRef}>
          {isMenuOpen && (
            <div
              className={`absolute bottom-full mb-2 z-50 bg-[#09090b] border border-zinc-800 text-zinc-100 rounded-none shadow-2xl p-3 select-none ${
                isCollapsed ? "left-0 w-64" : "left-0 right-0 w-full"
              }`}
              role="menu"
              aria-label="Account Menu"
            >
              {/* Email */}
              <div className="pb-2">
                <p className="text-[11px] font-mono text-zinc-400 truncate leading-none">
                  {userEmail}
                </p>
              </div>

              {/* Profile Row: Avatar + Name + Plan */}
              <div className="flex items-center gap-2.5 pb-3 pt-1 border-b border-zinc-800/80">
                <div className="w-8 h-8 rounded-none bg-zinc-800 border border-zinc-700 text-zinc-100 flex items-center justify-center text-xs font-bold shrink-0">
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate leading-tight">
                    {shopName}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mt-0.5">
                    {userPlan} Plan
                  </p>
                </div>
              </div>

              {/* Theme Controls */}
              <div className="py-2 space-y-1 border-b border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => {
                    if (isDark) toggleTheme();
                  }}
                  className={`w-full h-8 px-2.5 rounded-none text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    !isDark
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="light_mode" size={16} className="text-zinc-100" />
                    <span>Light Mode</span>
                  </div>
                  {!isDark && <MaterialIcon name="check" size={14} className="text-white" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isDark) toggleTheme();
                  }}
                  className={`w-full h-8 px-2.5 rounded-none text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isDark
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="dark_mode" size={16} className="text-zinc-100" />
                    <span>Dark Mode</span>
                  </div>
                  {isDark && <MaterialIcon name="check" size={14} className="text-white" />}
                </button>
              </div>

              {/* Logout Row */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onLogout) onLogout();
                  }}
                  className="w-full h-8 px-2.5 rounded-none text-xs font-medium text-zinc-300 hover:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <MaterialIcon name="logout" size={16} />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom Profile Trigger */}
          {!isCollapsed ? (
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-expanded={isMenuOpen}
              aria-haspopup="true"
              className="w-full p-2 rounded-none bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 hover:border-zinc-700 text-left transition-colors cursor-pointer flex items-center justify-between gap-2.5 group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-none bg-zinc-800 border border-zinc-700 text-zinc-100 flex items-center justify-center text-xs font-bold shrink-0">
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-zinc-100 truncate leading-tight">
                    {shopName}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider truncate mt-0.5">
                    {userPlan}
                  </p>
                </div>
              </div>
              <MaterialIcon
                name="expand_less"
                size={18}
                className={`text-zinc-400 transition-transform duration-150 shrink-0 ${
                  isMenuOpen ? "rotate-180 text-white" : "group-hover:text-zinc-200"
                }`}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-expanded={isMenuOpen}
              aria-haspopup="true"
              className="w-10 h-10 mx-auto rounded-none bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 hover:text-white flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
              title={`${shopName} (${userPlan})`}
              aria-label={`${shopName} (${userPlan})`}
            >
              {userInitial}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};