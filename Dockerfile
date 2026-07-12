FROM oven/bun:1.3-slim
WORKDIR /app

COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --production --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["bun", "apps/bot-api/src/index.ts"]
