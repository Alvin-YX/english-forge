-- EnglishForge · 回归探针收尾清理
--
-- 配合 scripts/probe-llm-words.mjs 使用。探针会往生产库写入临时数据，
-- 而应用**没有任何删除端点**（账号、词条、密钥都必须走数据库清理），
-- 所以这份 SQL 是探针流程的必要收尾，不跑就等于在生产里留下垃圾。
--
-- 用法（在 NAS 上执行）：
--   docker exec -i englishforge-postgres-1 psql -U forge -d englishforge < probe-cleanup.sql
--
-- 幂等：全部是可重复执行的 DELETE / UPDATE。
-- 🔴 不要动 `0000_init.sql` 迁移文件——它会改变 forge_migrations 的 sha256，
--    哈希不匹配会让 migrate 拒绝执行、api 容器起不来。
--
-- 注意 word 表的词条列叫 headword / lemma，不是 word。

-- ══ 探针写入的不可达假 LLM 配置 ══
-- 不删的话线上对话会一直报「AI 服务不可达」而不是「AI 未配置」。
DELETE FROM app_config WHERE key LIKE 'llm.%';
DELETE FROM app_secret WHERE name LIKE 'cloud.llm.%';

-- ══ 探针导入的词条 ══
DELETE FROM word WHERE headword LIKE 'efg%' OR lemma LIKE 'efg%';

-- ══ 回归用学生账号及其对话（软删账号 + 删干净对话，不留孤儿行）══
DELETE FROM ai_message WHERE conversation_id IN (
  SELECT ac.id FROM ai_conversation ac
  JOIN "user" u ON u.id = ac.user_id
  WHERE u.username LIKE 'diag_admin2_%'
);
DELETE FROM ai_conversation WHERE user_id IN (
  SELECT id FROM "user" WHERE username LIKE 'diag_admin2_%'
);
UPDATE "user" SET deleted_at = now() WHERE deleted_at IS NULL AND username LIKE 'diag_admin2_%';

-- ══ 更早几轮探针留下的 diag_ / parent_ 账号（历史遗留，同样只能软删）══
UPDATE "user" SET deleted_at = now()
WHERE deleted_at IS NULL AND (username LIKE 'diag_%' OR username LIKE 'parent_%');

-- ══ 收尾核对 ══
SELECT 'efg_words'         AS item, count(*) FROM word WHERE headword LIKE 'efg%' OR lemma LIKE 'efg%';
SELECT 'llm_config'        AS item, count(*) FROM app_config WHERE key LIKE 'llm.%';
SELECT 'llm_secret'        AS item, count(*) FROM app_secret WHERE name LIKE 'cloud.llm.%';
SELECT 'diag_conv_left'    AS item, count(*) FROM ai_conversation ac
  JOIN "user" u ON u.id = ac.user_id WHERE u.username LIKE 'diag_admin2_%';
SELECT 'orphan_conv_all'   AS item, count(*) FROM ai_conversation ac
  LEFT JOIN "user" u ON u.id = ac.user_id WHERE u.id IS NULL;
SELECT username || '/' || role AS active_accounts
FROM "user" WHERE deleted_at IS NULL ORDER BY id;
