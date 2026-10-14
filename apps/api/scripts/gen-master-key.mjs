#!/usr/bin/env tsx
/**
 * 生成 `APP_SECRET_MASTER_KEY` —— `app_secret` 表的 AES-256-GCM 主密钥。
 *
 * 为什么需要：`APP_SECRET_MASTER_KEY` 是**必填才能写 API Key** 的变量，
 * 但仓库里刻意不放任何示例值（放进 git 等于泄露密钥）。用这条命令生成一个，
 * 填进 docker-compose.yml / fnOS 包模板的 env 即可。
 *
 * 用法：
 *   pnpm --filter @eng-forge/api exec tsx scripts/gen-master-key.mjs
 *   # 或容器内：
 *   docker exec englishforge-api-1 sh -c "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
 *
 * 🔴 必须放在 apps/api/scripts/ 而非仓库根 scripts/：生产镜像是
 * `pnpm install --prod`，workspace 符号链接只落在 apps/api/node_modules 下。
 *
 * 🔴 本仓库 *.mjs 一律是纯 JS：tsx 不会对 .mjs 剥离 TypeScript 类型标注。
 *
 * ⚠️ 丢了这个值的后果：存量密钥永久无法解密（`reveal()` 静默返回 null，
 * 日志只报「需要 key_version=1，但当前未配置该版本」）。所以生成后必须
 * 和备份一起保管，重建实例时把旧值重新填回去。
 */

import { randomBytes } from 'node:crypto';

const KEY_BYTES = 32;

const key = randomBytes(KEY_BYTES).toString('base64');

console.log(key);
console.error(`\n[gen-master-key] ${KEY_BYTES} 字节随机密钥，base64 编码（${key.length} 字符）`);
console.error('填入 env：  APP_SECRET_MASTER_KEY=<上面那一行>');
console.error('⚠️  生成后请妥善保管。丢失该值会导致 app_secret 表中的存量密钥永久无法解密。');
