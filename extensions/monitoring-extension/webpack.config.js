const path = require('path')
const webpack = require('webpack')
const packageJson = require('./package.json')

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
  output: {
    filename: 'index.js', // Adjust the output file name as needed
    path: path.resolve(__dirname, 'dist'),
    library: { type: 'module' }, // Specify ESM output format
  },
  plugins: [
    new webpack.DefinePlugin({
      MODULE: JSON.stringify(`${packageJson.name}/${packageJson.module}`),
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
}
