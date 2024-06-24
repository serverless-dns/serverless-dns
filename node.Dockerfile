FROM node:22 as setup
# git is required if any of the npm packages are git[hub] packages
RUN apt-get update && apt-get install git -yq --no-install-suggests --no-install-recommends
WORKDIR /node-dir
COPY . .
# get deps, build, bundle
RUN npm i
# our webpack config yet cannot bundle native modules (mmap-utils)
# RUN npm run build:fly
# or RUN npx webpack --config webpack.fly.cjs
# download blocklists and bake them in the img
# RUN export BLOCKLIST_DOWNLOAD_ONLY=true && node ./dist/fly.mjs
RUN export BLOCKLIST_DOWNLOAD_ONLY=true && node ./src/server-node.js

# stage 2
FROM node:alpine AS runner

# env vals persist even at run-time: archive.is/QpXp2
# and overrides fly.toml env values
ENV NODE_ENV production
ENV NODE_OPTIONS="--max-old-space-size=320 --heapsnapshot-signal=SIGUSR2"
# get working dir in order
WORKDIR /app
# COPY --from=setup /node-dir/dist ./
# COPY --from=setup /node-dir/blocklists__ ./blocklists__
# COPY --from=setup /node-dir/dbip__ ./dbip__
COPY --from=setup . .
# print files in work dir, must contain blocklists
RUN ls -Fla
# run with the default entrypoint (usually, bash or sh)
CMD ["node", "./src/server-node.js"]
