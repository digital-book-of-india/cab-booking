import type { NextConfig } from "next";

const backendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ||
  "http://localhost:4000";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
    resolveAlias: {
      "msw/browser": "./node_modules/msw/lib/browser/index.js",
    },
  },

  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;