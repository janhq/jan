/** @type {import('next').NextConfig} */
const webpack = require('webpack')

const nextConfig = {
  output: 'export',
  assetPrefix: '.',
  transpilePackages: ['lucide-react'],
  experimental: {
    serverActions: false,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  webpack: (config, env) => {
    // do some stuff here
    config.optimization.minimize = false
    config.optimization.minimizer = []
    config.plugins = [...config.plugins, new webpack.DefinePlugin({})]
    return config
  },
}

module.exports = nextConfig
