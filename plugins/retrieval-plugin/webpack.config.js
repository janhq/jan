const path = require("path");
const webpack = require("webpack");
const packageJson = require("./package.json");

module.exports = {
  experiments: { outputModule: true },
  entry: "./src/index.ts",
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
    }),
  ],
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
    library: { type: "module" },
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  optimization: {
    minimize: false,
  },
};
