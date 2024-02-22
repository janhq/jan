/* eslint-disable @typescript-eslint/no-var-requires */
/** @type {import('next').NextConfig} */

const webpack = require('webpack')

const packageJson = require('./package.json')

const nextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  output: 'export',
  assetPrefix: '.',
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  webpack: (config) => {
    // do some stuff here
    config.optimization.minimize = false
    config.optimization.minimizer = []
    config.plugins = [
      ...config.plugins,
      new webpack.DefinePlugin({
        VERSION: JSON.stringify(packageJson.version),
        ANALYTICS_ID: JSON.stringify(process.env.ANALYTICS_ID),
        ANALYTICS_HOST: JSON.stringify(process.env.ANALYTICS_HOST),
        API_BASE_URL: JSON.stringify(
          process.env.API_BASE_URL ?? 'http://localhost:1337'
        ),
        isMac: process.platform === 'darwin',
        isWindows: process.platform === 'win32',
        isLinux: process.platform === 'linux',
      }),
    ]
    return config
  },
}

module.exports = nextConfig
