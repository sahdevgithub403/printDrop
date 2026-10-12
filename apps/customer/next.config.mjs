/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Phase-2A API routes + lib use ESM-style ".js"-suffixed relative imports
    // (e.g. "../../lib/authRoutes.js" -> lib/authRoutes.ts). TypeScript
    // `moduleResolution: bundler` resolves these, but webpack does not by
    // default, so map them here. This config shim is build-only: it does not
    // modify any file under app/api or lib.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
