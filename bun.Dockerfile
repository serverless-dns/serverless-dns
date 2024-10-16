FROM oven/bun AS setup
WORKDIR /bun-dir
COPY . .
RUN bun build ./src/server-node.js --target node --outdir ./dist --entry-naming bun.mjs --format esm
RUN export BLOCKLIST_DOWNLOAD_ONLY=true && node ./dist/bun.mjs

FROM oven/bun:alpine AS runner
# env vals persist even at run-time: archive.is/QpXp2
# and overrides fly.toml env values
# get working dir in order
WORKDIR /app
COPY --from=setup /bun-dir/dist ./
COPY --from=setup /bun-dir/blocklists__ ./blocklists__
COPY --from=setup /bun-dir/dbip__ ./dbip__
# print files in work dir, must contain blocklists
RUN ls -Fla
# run with the default entrypoint (usually, bash or sh)
CMD ["bun", "run", "./bun.mjs"]
