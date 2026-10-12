"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  isDark: true,
});

export const ThemeProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // SSR-safe: never touch localStorage during render. Initialize with the
  // safe default ("dark", matching the context default above) so server
  // HTML and the first client render agree, then load the saved theme in
  // a client-only effect (no hydration mismatch, no suppressed errors).
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem("customer_theme") ||
        localStorage.getItem("printalfa_theme");
      if (saved === "light" || saved === "dark") {
        setThemeState(saved);
      }
    } catch (e) {
      console.warn("Unable to read theme from localStorage", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("customer_theme", theme);
    } catch (e) {
      console.warn("Unable to save customer_theme to localStorage", e);
    }

    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      root.setAttribute("data-theme", "dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      root.style.colorScheme = "light";
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const setTheme = (newTheme: Theme) => {
    if (newTheme === "dark" || newTheme === "light") {
      setThemeState(newTheme);
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        isDark: theme === "dark",
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
