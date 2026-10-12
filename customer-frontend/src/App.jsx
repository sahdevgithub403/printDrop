import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CustomerShopPage } from "./pages/CustomerShopPage";
import { OrderTrackingPage } from "./pages/OrderTrackingPage";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.error("Customer app error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-app)] text-[var(--text-primary)]">
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-[var(--text-secondary)] mb-4">Please reload the page or scan the shop QR code again.</p>
          <button onClick={() => window.location.reload()} className="btn-primary h-12 px-6">
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ScrollToTop = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

export const App = () => {
  return (
    <ErrorBoundary>
      <ScrollToTop />
      <Routes>
        <Route path="/shop/:shopSlug" element={<CustomerShopPage />} />
        <Route path="/order/:publicToken" element={<OrderTrackingPage />} />
        <Route path="*" element={
          <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-app)] text-[var(--text-primary)] transition-colors duration-200">
            <h1 className="text-2xl font-bold mb-2">Shop Not Found</h1>
            <p className="text-[var(--text-secondary)]">Please scan a valid PrintAlfa shop QR code to place an order.</p>
          </div>
        } />
      </Routes>
    </ErrorBoundary>
  );
};

export default App;
