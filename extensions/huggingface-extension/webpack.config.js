const path = require("path");
const webpack = require("webpack");
const packageJson = require("./package.json");

module.exports = {
  experiments: { outputModule: true },
  entry: "./src/index.ts", // Adjust the entry point to match your project's main file
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
      EXTENSION_NAME: JSON.stringify(packageJson.name),
      NODE_MODULE_PATH: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
    }),
  ],
  output: {
    filename: "index.js", // Adjust the output file name as needed
    path: path.resolve(__dirname, "dist"),
    library: { type: "module" }, // Specify ESM output format
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  // Add loaders and other configuration as needed for your project
};
