/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  assetPrefix: ".",
  experimental: {
    serverActions: false,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  exclude: ["electron"],
  webpack: (config, env) => {
    // do some stuff here
    config.optimization.minimize = false;
    config.optimization.minimizer = [];
    return config;
  },
};

module.exports = nextConfig;
