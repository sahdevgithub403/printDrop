/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local-first API routing: the admin app ships NO Route Handlers — all
  // APIs live in the customer app (http://localhost:3000, see
  // NEXT_PUBLIC_API_BASE_URL). When the client uses the relative "/api"
  // fallback (no env configured), proxy it to the local API origin,
  // mirroring the original Vite dev-server proxy. An explicitly configured
  // absolute NEXT_PUBLIC_API_BASE_URL bypasses this rewrite entirely.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
