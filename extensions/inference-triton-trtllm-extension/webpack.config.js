const webpack = require('webpack')
const packageJson = require('./package.json')
const settingJson = require('./resources/settings.json')

module.exports = {
  experiments: { outputModule: true },
  entry: './src/index.ts', // Adjust the entry point to match your project's main file
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      SETTINGS: JSON.stringify(settingJson),
      MODULE: JSON.stringify(`${packageJson.name}/${packageJson.module}`),
    }),
  ],
  output: {
    filename: 'index.js', // Adjust the output file name as needed
    library: { type: 'module' }, // Specify ESM output format
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
}
