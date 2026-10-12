"use client";

import React, { useState, useEffect, Suspense, lazy } from "react";
import { AuthPage } from "../src/views/AuthPage";
import { ShopSetupWizard } from "../src/views/ShopSetupWizard";
import { AdminDashboardPage } from "../src/views/AdminDashboardPage";
import { NotificationPopup } from "../src/views/NotificationPopup";
import { parseStudioHash } from "../src/studio/studioRoute";
import { getShopProfile } from "../src/api";
import { MaterialIcon } from "../src/components/ui/MaterialIcon";

// Document Studio (pdf.js/pdf-lib) is code-split so the dashboard bundle stays lean.
const DocumentStudioPage = lazy(() =>
  import("../src/views/DocumentStudioPage").then((m) => ({ default: m.DocumentStudioPage }))
);

const App = () => {
  // Lazy initializer + typeof guard: this also renders during Next.js server
  // prerendering where `window` is absent; the live hash attaches client-side.
  const [hash, setHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash : ""
  );
  const [user, setUser] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [startupError, setStartupError] = useState<any>(null);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    // Determine if we're in the popup window
    if (window.location.hash.startsWith('#/notification')) {
      setIsInitializing(false);
      return;
    }

    const checkStartupFlow = async () => {
      const token = localStorage.getItem("admin_jwt_token");
      const savedUserStr = localStorage.getItem("admin_user_data");

      if (!token || token === "undefined") {
        console.log("[Startup] Not authenticated -> showing login");
        setUser(null);
        setIsInitializing(false);
        return;
      }

      console.log("[Startup] Authenticated -> fetching shop profile");
      setStartupError(null);
      try {
        const shopProfile = await getShopProfile();
        console.log("[Startup] Shop data received:", shopProfile);

        let currentUser: any = {};
        try { currentUser = JSON.parse(savedUserStr || "{}"); } catch (e: any) {}

        currentUser.shopSetupComplete = true;
        currentUser.shopId = shopProfile.id;
        currentUser.shopName = shopProfile.name;
        currentUser.shopSlug = shopProfile.slug;

        localStorage.setItem("admin_user_data", JSON.stringify(currentUser));
        setUser(currentUser);
        console.log("[Startup] Setup complete -> Dashboard");
      } catch (err: any) {
        console.log("[Startup] Setup incomplete or error:", err.message);
        if (err.response?.status === 401) {
          // Invalid token: hard logout to login (interceptor also clears storage).
          try {
            localStorage.removeItem("admin_jwt_token");
            localStorage.removeItem("admin_user_data");
          } catch {}
          setUser(null);
        } else if (!err.response || err.response?.status >= 500) {
          // Network failure or backend 5xx: surface error + retry, never wizard.
          setStartupError(
            !err.response
              ? "Cannot reach the server. Check your connection and retry."
              : "Server error while loading your shop. Please retry.",
          );
        } else {
          // Assume shop is not setup (400 Bad Request or similar)
          let currentUser: any = {};
          try { currentUser = JSON.parse(savedUserStr || "{}"); } catch (e: any) {}

          currentUser.shopSetupComplete = false;
          localStorage.setItem("admin_user_data", JSON.stringify(currentUser));
          setUser(currentUser);
          console.log("[Startup] Setup incomplete -> Shop Setup");
        }
      } finally {
        setIsInitializing(false);
      }
    };

    checkStartupFlow();
  }, []);

  if (hash.startsWith('#/notification')) {
    return <NotificationPopup />;
  }

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#0b0d10] flex flex-col items-center justify-center space-y-4">
        <MaterialIcon name="progress_activity" size={40} className="animate-spin text-white" />
        <p className="text-zinc-400 font-medium animate-pulse">Initializing PrintAlfa...</p>
      </div>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem("admin_jwt_token");
    localStorage.removeItem("admin_user_data");
    setUser(null);
  };

  const handleSetupComplete = () => {
    // Refresh user state from local storage, but also trigger a full re-fetch to be safe
    setIsInitializing(true);
    getShopProfile()
      .then((shopProfile) => {
        const userData = JSON.parse(localStorage.getItem("admin_user_data") || "{}");
        userData.shopSetupComplete = true;
        userData.shopId = shopProfile.id;
        userData.shopName = shopProfile.name;
        userData.shopSlug = shopProfile.slug;
        localStorage.setItem("admin_user_data", JSON.stringify(userData));
        setUser(userData);
      })
      .catch((err: any) => {
        console.error("Failed to load profile after setup:", err);
      })
      .finally(() => {
        setIsInitializing(false);
      });
  };

  const handleAuthSuccess = async (authData: any) => {
    setIsInitializing(true);
    try {
      const shopProfile = await getShopProfile();
      const updatedUser = {
        ...authData,
        shopSetupComplete: true,
        shopId: shopProfile.id,
        shopName: shopProfile.name,
        shopSlug: shopProfile.slug,
        isOpen: shopProfile.isOpen !== false,
      };
      localStorage.setItem("admin_user_data", JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch {
      // Authenticated new user has no shop yet -> open ShopSetupWizard immediately
      const newUser = {
        ...authData,
        shopSetupComplete: false,
      };
      localStorage.setItem("admin_user_data", JSON.stringify(newUser));
      setUser(newUser);
    } finally {
      setIsInitializing(false);
    }
  };

  if (!user) {
    return <AuthPage onLoginSuccess={handleAuthSuccess} />;
  }

  if (startupError) {
    return (
      <div className="min-h-screen bg-[#0b0d10] flex flex-col items-center justify-center space-y-4 p-6 text-center">
        <p className="text-zinc-100 font-semibold">{startupError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-none bg-white text-black text-sm font-bold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!user.shopSetupComplete) {
    return <ShopSetupWizard onSetupComplete={handleSetupComplete} />;
  }

  if (parseStudioHash(hash)) {
    return (
      <Suspense
        fallback={
          <div className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center">
            <MaterialIcon name="progress_activity" size={32} className="animate-spin text-[var(--text-secondary)]" />
            <span className="ml-3 text-sm text-[var(--text-secondary)]">Opening Document Studio…</span>
          </div>
        }
      >
        <DocumentStudioPage />
      </Suspense>
    );
  }

  return <AdminDashboardPage user={user} onLogout={handleLogout} />;
};

export default App;
