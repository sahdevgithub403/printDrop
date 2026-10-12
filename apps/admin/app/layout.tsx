import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../src/context/ThemeContext";

export const metadata: Metadata = {
  title: "Shop Admin - PrintAlfa",
  description: "PrintAlfa shop admin dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
