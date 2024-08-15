const webpack = require('webpack')
const packageJson = require('./package.json')
const settingJson = require('./resources/settings.json')
const modelsJson = require('./resources/models.json')

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
      MODELS: JSON.stringify(modelsJson),
      SETTINGS: JSON.stringify(settingJson),
      ENGINE: JSON.stringify(packageJson.engine),
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
