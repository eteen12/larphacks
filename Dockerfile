FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend only: no Expo app, no root package.json. backend/ imports ../shared by relative path.
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci

COPY backend ./backend
COPY shared ./shared

RUN npm i -g @anthropic-ai/claude-code

ENV NODE_ENV=production
WORKDIR /app/backend
EXPOSE 3000
CMD ["npm", "start"]
