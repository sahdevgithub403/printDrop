export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-app)] text-[var(--text-primary)] transition-colors duration-200">
      <h1 className="text-2xl font-bold mb-2">Shop Not Found</h1>
      <p className="text-[var(--text-secondary)]">
        Please scan a valid PrintAlfa shop QR code to place an order.
      </p>
    </div>
  );
}
