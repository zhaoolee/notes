FROM node:22-bookworm AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY example ./example
COPY public ./public

RUN npm run build:static

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS server-build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "fonttools[woff]" \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.server.json ./
COPY server ./server
COPY src ./src

RUN npm run build:server

FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "fonttools[woff]" \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=frontend-build /app/dist ./dist
COPY --from=server-build /app/dist-server ./dist-server
COPY --from=server-build /app/src/assets/fonts ./src/assets/fonts
COPY public/bg.jpg ./public/bg.jpg
COPY public/smartisan/web/smartisan_hammer_footer.png ./public/smartisan/web/smartisan_hammer_footer.png

ENV NODE_ENV=production
ENV PORT=3001
ENV EXPORT_APP_URL=http://127.0.0.1:3001
ENV IMAGE_STORAGE_DIR=/app/storage/images
ENV DATA_STORAGE_DIR=/app/storage/data

EXPOSE 3001

CMD ["node", "dist-server/server/index.js"]
