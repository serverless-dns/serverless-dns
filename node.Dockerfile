FROM node:alpine as deps

RUN apk --no-cache add git

WORKDIR /node-dir
COPY package.json ./

RUN npm install --production --no-package-lock --no-fund --ignore-scripts

FROM node:alpine AS runner

ENV NODE_ENV production

RUN addgroup --gid 1001 nodejs
RUN adduser --uid 1001 --disabled-password nodejs --ingroup nodejs
RUN mkdir /node-dir/ && chown nodejs:nodejs /node-dir/

WORKDIR /node-dir
COPY --from=deps --chown=nodejs:nodejs /node-dir/ ./
COPY --chown=nodejs:nodejs . .
RUN rm -f *Dockerfile .dockerignore

RUN ls -Fla

CMD ["node", "src/server-node.js"]
