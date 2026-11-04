import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["core"],
  serverExternalPackages: ["@phala/dcap-qvl"],
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
