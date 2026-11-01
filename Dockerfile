FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY shared/package.json shared/
RUN npm ci

COPY backend ./backend
COPY shared ./shared
RUN npm run -w backend build

RUN npm i -g @anthropic-ai/claude-code

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "backend/dist/index.js"]
