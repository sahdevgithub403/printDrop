"use client";

import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error("Customer app error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-app)] text-[var(--text-primary)]">
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-[var(--text-secondary)] mb-4">
            Please reload the page or scan the shop QR code again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary h-12 px-6"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
