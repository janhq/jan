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
  plugins: [
    new webpack.DefinePlugin({
      MODULE: JSON.stringify(`${packageJson.name}/${packageJson.module}`),
      OPENAI_DOMAIN: JSON.stringify('openai.azure.com'),
    }),
  ],
  output: {
    filename: 'index.js', // Adjust the output file name as needed
    path: path.resolve(__dirname, 'dist'),
    library: { type: 'module' }, // Specify ESM output format
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      path: require.resolve('path-browserify'),
    },
  },
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
}
