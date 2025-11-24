FROM oven/bun AS setup
WORKDIR /bun-dir
COPY . .
RUN bun install
# flybun --packages=external to ask bun to not resolve @riaskov/mmap-io (which brings in mapbox among other deps)
RUN npm run build:flybun
RUN export BLOCKLIST_DOWNLOAD_ONLY=true && bun run ./dist/bun.mjs --smol

FROM oven/bun:alpine AS runner
# env vals persist even at run-time: archive.is/QpXp2
# and overrides fly.toml env values
# get working dir in order
WORKDIR /app
COPY --from=setup /bun-dir/dist ./
COPY --from=setup /bun-dir/blocklists__ ./blocklists__
COPY --from=setup /bun-dir/dbip__ ./dbip__
# @riaskov/mmap-io native is unused in bun as it has built-in mmap support
# print files in work dir, must contain blocklists
RUN ls -Fla
# run with the default entrypoint (usually, bash or sh)
CMD ["bun", "run", "./bun.mjs", "--smol"]
