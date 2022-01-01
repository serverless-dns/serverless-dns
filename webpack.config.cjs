const webpack = require("webpack");
module.exports = {
  entry: "./src/server-workers.js",
  target: "webworker",
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp:
        /(^dgram$)|(^http2$)|(\/node\/.*\.js$)|(.*-node\.js$)|(.*\.node\.js$)/,
    }),
  ],
  optimization: {
    minimize: true,
  },
};
