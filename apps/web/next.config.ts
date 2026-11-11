import type { NextConfig } from "next";

const apiInternalUrl = process.env["API_INTERNAL_URL"];
if (!apiInternalUrl) throw new Error("API_INTERNAL_URL is not set (see apps/web/.env.example)");
const apiOrigin = new URL(apiInternalUrl).origin;

const config: NextConfig = {
  poweredByHeader: false,

  // The browser calls same-origin /api/v1/*, so it sends its real Origin and receives the session cookie.
  rewrites() {
    return Promise.resolve([{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }]);
  },

  // Basic security headers. A Content-Security-Policy is deliberately deferred.
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]);
  },
};

export default config;
