# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
# corepack 下载 pnpm 本体要走国内镜像（registry.npmjs.org 在 NAS 上不可达）
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#http://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
 && apk add --no-cache python3 make g++
COPY .npmrc .npmrc
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/contracts/package.json packages/contracts/
COPY packages/content/package.json packages/content/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
ENV npm_config_build_from_source=true npm_config_disturl=https://npmmirror.com/mirrors/node
RUN pnpm install --no-frozen-lockfile --filter @eng-forge/web...

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm --filter @eng-forge/web build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
