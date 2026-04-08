import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for Electron desktop builds
  ...(process.env.BUILD_TARGET === 'electron' ? { output: 'export' } : {}),
  // Required for FFmpeg.wasm — SharedArrayBuffer needs these headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
        ],
      },
    ];
  },
  // Empty turbopack config to enable Turbopack (Next.js 16 default)
  turbopack: {},
};

export default nextConfig;
