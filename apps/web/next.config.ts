import type { NextConfig } from "next";
import { securityHeaders } from "./lib/headers";

const nextConfig: NextConfig = {
  transpilePackages: ["core"],
  // Keep the verifier out of the server bundle. Next only does that when
  // apps/web can resolve the same copy packages/core imports. A bundled copy
  // throws "Failed to parse CRL" on Intel CRLs the real package accepts.
  serverExternalPackages: ["@phala/dcap-qvl"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config) => {
    // core imports `.js` paths that live as `.ts` source.
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
