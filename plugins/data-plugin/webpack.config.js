const path = require("path");
const webpack = require("webpack");
const packageJson = require("./package.json");

module.exports = {
  experiments: { outputModule: true },
  entry: "./index.ts", // Adjust the entry point to match your project's main file
  mode: "production",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      PLUGIN_NAME: JSON.stringify(packageJson.name),
      MODULE_PATH: JSON.stringify(`${packageJson.name}/${packageJson.module}`),
      PLUGIN_CATALOG: JSON.stringify(
        "https://cdn.jsdelivr.net/npm/@janhq/plugin-catalog@latest/dist/index.js"
      ),
    }),
  ],
  output: {
    filename: "esm/index.js", // Adjust the output file name as needed
    path: path.resolve(__dirname, "dist"),
    library: { type: "module" }, // Specify ESM output format
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
};
