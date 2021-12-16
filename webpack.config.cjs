const webpack = require("webpack");
module.exports = {
  target: "webworker",
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /^dgram$/
    }),
  ],
};
