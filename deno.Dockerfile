# Based on github.com/denoland/deno_docker/blob/main/alpine.dockerfile

ARG DENO_VERSION=1.44.4
ARG BIN_IMAGE=denoland/deno:bin-${DENO_VERSION}

FROM ${BIN_IMAGE} AS bin

FROM frolvlad/alpine-glibc:alpine-3.13

RUN apk --no-cache add ca-certificates

RUN addgroup --gid 1000 deno \
  && adduser --uid 1000 --disabled-password deno --ingroup deno \
  && mkdir /deno-dir/ \
  && chown deno:deno /deno-dir/

ENV DENO_DIR /deno-dir/
ENV DENO_INSTALL_ROOT /usr/local

ARG DENO_VERSION
ENV DENO_VERSION=${DENO_VERSION}
COPY --from=bin /deno /bin/deno

WORKDIR /deno-dir
COPY . .

# runs pre-build step which fetchs the latest basicconfig
RUN src/build/pre.sh
RUN ls -Fla

ENTRYPOINT ["/bin/deno"]

# Unstable API for 'Deno.listenTls#alpn_protocols'
# This is only used while building, on fly.io
CMD [
  "run",
  "--unstable",
  "--allow-net",
  "--allow-env",
  "--allow-read",
  "src/server-deno.ts"
]

# Run port process as a root privilege user. For say port 53
# USER root
