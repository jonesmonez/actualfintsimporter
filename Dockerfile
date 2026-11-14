FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# --------

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY --chown=node:node ./src .

RUN mkdir -p /app/data && mkdir -p /app/actual-data && mkdir -p /run/secrets && chown -R node:node /app

USER node

EXPOSE 3001

CMD [ "node", "index.js" ]