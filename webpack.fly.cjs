const webpack = require("webpack");

module.exports = {
  entry: "./src/server-node.js",
  target: ["node"],
  mode: "production",
  // enable devtool in development
  // devtool: 'eval-cheap-module-source-map',

  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /(\/deno\/.*\.ts$)|(.*-deno\.ts$)|(.*\.deno\.ts$)/,
    }),
    // stackoverflow.com/a/60325769
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
    }),
  ],

  optimization: {
    usedExports: true,
    minimize: false,
  },

  // stackoverflow.com/a/68916455
  output: {
    filename: "fly.cjs",
    clean: true, // empty dist before output
  },
};
