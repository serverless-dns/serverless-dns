const webpack = require("webpack");

module.exports = {
  entry: "./src/server-node.js",
  target: ["node22", "es2022"],
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

  /* externalsType: 'module',
  externals: {
    '@riaskov/mmap-io': '@riaskov/mmap-io',
  },*/
  externals: /@riaskov/,

  optimization: {
    usedExports: true,
    minimize: false,
  },

  experiments: {
    outputModule: true,
  },

  // github.com/webpack/webpack/issues/14072
  // see also: src/core/node/config.js
  /* node: {
    global: true,
    __filename: true,
    __dirname: true,
  },*/

  // require missing: github.com/webpack/webpack/issues/16029

  // github.com/webpack/webpack/issues/13290
  // stackoverflow.com/a/68916455
  output: {
    library: {
      type: "module",
    },
    clean: true,
    filename: "fly.mjs",
    module: true,
  },

  // or, cjs: stackoverflow.com/a/68916455
  /*
  output: {
    filename: "fly.cjs",
    clean: true, // empty dist before output
  },
  */
};
