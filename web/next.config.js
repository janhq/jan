/* eslint-disable @typescript-eslint/no-var-requires */
/** @type {import('next').NextConfig} */

const webpack = require('webpack')

const packageJson = require('./package.json')

const nextConfig = {
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
        PLUGIN_CATALOG: JSON.stringify(
          'https://cdn.jsdelivr.net/npm/@janhq/plugin-catalog@latest/dist/index.js'
        ),
        VERSION: JSON.stringify(packageJson.version),
        ANALYTICS_ID:
          JSON.stringify(process.env.ANALYTICS_ID) ?? JSON.stringify('xxx'),
        ANALYTICS_HOST:
          JSON.stringify(process.env.ANALYTICS_HOST) ?? JSON.stringify('xxx'),
      }),
    ]
    return config
  },
}

module.exports = nextConfig
