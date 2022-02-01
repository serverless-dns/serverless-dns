const webpack = require("webpack");

// developers.cloudflare.com/workers/cli-wrangler/configuration#modules
// archive.is/FDky9
module.exports = {
  entry: "./src/server-workers.js",
  target: ["webworker", "es2020"],
  mode: "production",
  // enable devtool in development
  // devtool: 'eval-cheap-module-source-map',

  resolve: {
    fallback: {
        // buffer polyfill: archive.is/7OBM7
        buffer: require.resolve('buffer/'),
    },
  },

  plugins: [
    new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.IgnorePlugin({
      resourceRegExp:
        /(^dgram$)|(^http2$)|(\/deno\/.*\.ts$)|(.*-deno\.ts$)|(.*\.deno\.ts$)|(\/node\/.*\.js$)|(.*-node\.js$)|(.*\.node\.js$)/,
    }),
  ],

  optimization: {
    usedExports: true,
    minimize: true,
  },

  experiments: {
    outputModule: true,
  },

  // stackoverflow.com/a/68916455
  output: {
    library: {
      type: "module",
    },
    filename: "worker.js",
    module: true,
  },
};
