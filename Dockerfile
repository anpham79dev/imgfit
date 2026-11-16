# imgfit — run the CLI without installing Node on the host.
#   docker build -t imgfit:0.1.0 .
#   docker run --rm -v "$PWD:/work" -w /work --user "$(id -u):$(id -g)" imgfit:0.1.0 resize photo.jpg --preset L -o out
# --user so output files belong to you, not root.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY ui ./ui
COPY schema ./schema
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /opt/imgfit
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/schema ./schema
COPY README.md ./
RUN ln -s /opt/imgfit/dist/bin.js /usr/local/bin/imgfit && chmod +x /opt/imgfit/dist/bin.js
WORKDIR /work
USER node
ENTRYPOINT ["imgfit"]
CMD ["--help"]
