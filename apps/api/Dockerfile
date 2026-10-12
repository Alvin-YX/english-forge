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
COPY packages/db/package.json packages/db/
COPY packages/content/package.json packages/content/
COPY packages/ui/package.json packages/ui/
COPY packages/speech-tts/package.json packages/speech-tts/
COPY apps/api/package.json apps/api/
ENV npm_config_build_from_source=true npm_config_disturl=https://npmmirror.com/mirrors/node
RUN pnpm install --no-frozen-lockfile --filter @eng-forge/api...

COPY packages/ packages/
COPY apps/api/ apps/api/

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#http://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
 && apk add --no-cache python3 make g++
COPY .npmrc .npmrc
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/contracts/package.json packages/contracts/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/content/package.json packages/content/
COPY --from=builder /app/packages/ui/package.json packages/ui/
COPY --from=builder /app/packages/speech-tts/package.json packages/speech-tts/
COPY --from=builder /app/apps/api/package.json apps/api/
ENV npm_config_build_from_source=true npm_config_disturl=https://npmmirror.com/mirrors/node
RUN pnpm install --no-frozen-lockfile --filter @eng-forge/api... --prod

COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/tsconfig.base.json tsconfig.base.json
COPY --from=builder /app/apps/api/tsconfig.json apps/api/tsconfig.json
COPY --from=builder /app/apps/api/src/ apps/api/src/
COPY --from=builder /app/apps/api/package.json apps/api/package.json
COPY --from=builder /app/apps/api/docker-start.sh apps/api/docker-start.sh

EXPOSE 3000
# 🔴 用 tsx 直接跑 TS 源码：@eng-forge/contracts / @eng-forge/db 等 workspace 共享包
# 以 .ts 源码经 ESM exports 暴露，纯 node 跑编译后的 dist 无法解析 .ts
# （ERR_MODULE_NOT_FOUND: .../packages/contracts/src/types/index.js）。
# 与 apps/api 的 dev/start 脚本（tsx src/main.ts）保持一致，去除「先编译全部共享包」的复杂度。
# tsx 已移入 apps/api 的 dependencies（见 package.json），pnpm install --prod 会一并安装。
# 🔴 必须显式 `--tsconfig apps/api/tsconfig.json`：tsx 只从 CWD 找 tsconfig.json，仓库根只有 tsconfig.base.json（不含 experimentalDecorators），
# 默认配置下 esbuild 直接报「Parameter decorators only work when experimental decorators are enabled」崩溃。
# tsconfig.json extends base.json，所以两个文件都必须拷进生产阶段。
# 用 `pnpm exec tsx` 而非硬编码 .bin 路径：pnpm 在本镜像已通过 corepack 启用，
# 能可靠解析 bin 并透传 SIGTERM（fnOS 停止应用时的优雅退出）。
# CMD 走 apps/api/docker-start.sh：先跑幂等 schema 迁移，再起 Nest。
# 迁移不能放进 install_callback —— fpk 安装时它只做 docker load，容器与数据库都还没起来；
# 不在此兜底则全新安装的库无表，首个注册直接 500（relation "user" does not exist）。
CMD ["sh", "apps/api/docker-start.sh"]
