# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev \
  && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DB_BACKEND=mssql \
    HOST=0.0.0.0 \
    PORT=8000 \
    SERVE_STATIC=true

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server-node ./server-node
COPY --from=build /app/dist ./dist

RUN mkdir -p server/results

EXPOSE 8000
CMD ["npm", "start"]
