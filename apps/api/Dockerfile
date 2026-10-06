# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/content/package.json packages/content/
COPY packages/ui/package.json packages/ui/
COPY packages/speech-tts/package.json packages/speech-tts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @eng-forge/api...

COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @eng-forge/api build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/contracts/package.json packages/contracts/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/content/package.json packages/content/
COPY --from=builder /app/packages/ui/package.json packages/ui/
COPY --from=builder /app/packages/speech-tts/package.json packages/speech-tts/
COPY --from=builder /app/apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @eng-forge/api... --prod

COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/api/dist/ apps/api/dist/
COPY --from=builder /app/apps/api/package.json apps/api/

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
