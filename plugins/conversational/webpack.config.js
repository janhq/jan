const path = require("path");
const webpack = require("webpack");
// const packageJson = require("./package.json");

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
  output: {
    filename: "index.js", // Adjust the output file name as needed
    path: path.resolve(__dirname, "dist"),
    library: { type: "module" }, // Specify ESM output format
  },
  plugins: [new webpack.DefinePlugin({})],
  resolve: {
    extensions: [".ts", ".js"],
  },
  // Do not minify the output, otherwise it breaks the class registration
  optimization: {
    minimize: false,
  },
  // Add loaders and other configuration as needed for your project
};
