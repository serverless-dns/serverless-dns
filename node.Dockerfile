FROM node:22 as setup
# git is required if any of the npm packages are git[hub] packages
RUN apt-get update && apt-get install git -yq --no-install-suggests --no-install-recommends
WORKDIR /app
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
# pin to node22 for native deps (mmap-io)
FROM node:22-alpine AS runner

# env vals persist even at run-time: archive.is/QpXp2
# and overrides fly.toml env values
ENV NODE_ENV production
ENV NODE_OPTIONS="--max-old-space-size=320 --heapsnapshot-signal=SIGUSR2"
# get working dir in order
WORKDIR /app
# COPY --from=setup /app/dist ./
# COPY --from=setup /app/blocklists__ ./blocklists__
# COPY --from=setup /app/dbip__ ./dbip__
COPY --from=setup /app .
# print files in work dir, must contain blocklists
RUN ls -Fla
# run with the default entrypoint (usually, bash or sh)
CMD ["node", "./src/server-node.js"]
