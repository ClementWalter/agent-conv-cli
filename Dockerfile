FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY service ./service
COPY web ./web
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PYTHONOPTIMIZE=1 UV_PYTHON_INSTALL_DIR=/opt/python UV_CACHE_DIR=/tmp/uv-cache
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv
COPY package*.json ./
RUN npm ci --omit=dev && uv python install 3.12
COPY --from=build /app/dist ./dist
COPY one_conv ./one_conv
COPY bin/one-conv-worker ./bin/one-conv-worker
RUN chmod -R a+rX /opt/python && chown -R node:node /app
USER node
EXPOSE 4310
CMD ["node", "dist/server.mjs"]
