const path = require("path");

module.exports = {
  experiments: { outputModule: true },
  entry: "./index.js", // Adjust the entry point to match your project's main file
  output: {
    filename: "bundle.js", // Adjust the output file name as needed
    path: path.resolve(__dirname, "dist"),
    library: { type: "module" }, // Specify ESM output format
  },
  resolve: {
    extensions: [".js"],
  },
  // Add loaders and other configuration as needed for your project
};
