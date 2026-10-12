"use client";
import React, { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext<any>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  isDark: true,
});

export const ThemeProvider = ({ children }) => {
  // SSR-safe: default first (server HTML and first client render agree),
  // then load the saved theme in a client-only effect.
  const [theme, setThemeState] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_theme");
      if (saved === "light" || saved === "dark") {
        setThemeState(saved);
      }
    } catch (e: any) {
      console.warn("Unable to read admin_theme from localStorage", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("admin_theme", theme);
    } catch (e: any) {
      console.warn("Unable to save admin_theme to localStorage", e);
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

  const setTheme = (newTheme) => {
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
