const webpack = require('webpack')

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
    library: { type: 'module' }, // Specify ESM output format
  },
  plugins: [
    new webpack.DefinePlugin({
      API_URL: JSON.stringify('http://127.0.0.1:39291'),
      SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.42'),
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  // Do not minify the output, otherwise it breaks the class registration
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
}
