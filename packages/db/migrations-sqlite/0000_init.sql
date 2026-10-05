-- ═══════════════════════════════════════════════════════════════════════════
-- EnglishForge · 0000_init.sql（SQLite 降级档，better-sqlite3）
-- 依据：03-技术研发方案.md §4.4 类型映射表
--
-- 🔴 与 PG 档（migrations/0000_init.sql）**同一套业务模型**，差异仅在类型与
--    索引实现，全部列在下方对照表。与 PG 档相同的 5 项缺陷修正在此同样生效
--    （缺陷修正 1/2/4/5 就地标注；缺陷修正 3 的 6 张表同样补齐）。
--
-- 关键方言差异（§4.4）：
--   serial       → INTEGER PRIMARY KEY AUTOINCREMENT
--   timestamptz  → TEXT（ISO8601 UTC 字符串）
--   date         → TEXT（YYYY-MM-DD）
--   varchar(n)   → TEXT（长度不强制，应用层 zod 校验）
--   text[]       → TEXT（JSON 数组字符串，走 jsonStringArray()）
--   jsonb        → TEXT（JSON.stringify / parse）
--   tsvector     → FTS5 虚拟表（word_fts / sentence_fts）
--   real[]       → BLOB（Float32Array）
--   物化视图      → 普通表 + 每日 UPSERT
--   BYTEA        → BLOB
--   CHECK/部分索引 → 双方言均支持
--
-- 幂等：全部 IF NOT EXISTS。
--
-- 🔴 时间戳一律用 strftime('%Y-%m-%dT%H:%M:%fZ','now')（ISO8601 UTC），
--    **不用** SQLite 内置的 CURRENT_TIMESTAMP —— 后者产出
--    「2026-10-05 05:29:28」（空格分隔、无时区），不符合 §4.4 的 ISO8601 约定，
--    且无法被 new Date() 稳定解析成 UTC。与 dialect.ts 的 NOW_SQL 保持一致。
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 用户与角色（§4.2.1）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "user" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('student','parent','teacher','admin')),
  display_name    TEXT NOT NULL,
  avatar_path     TEXT,
  email           TEXT UNIQUE,
  phone           TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','deleted')),
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_role_status ON "user" (role, status);

-- ⚠️ 同 PG 档：stage 需先于 user_profile 建表（外键依赖）
-- ⚠️ CHECK 用 contracts 的 6 个 code（文档只有 5 个且用 'university'）
CREATE TABLE IF NOT EXISTS stage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE
                 CHECK (code IN ('primary_low','primary','junior','senior','college','adult')),
  name_zh        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  enabled_in_mvp INTEGER NOT NULL DEFAULT 0,
  min_age        INTEGER,
  max_age        INTEGER
);

CREATE TABLE IF NOT EXISTS user_profile (
  user_id          INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  stage_id         INTEGER REFERENCES stage(id),
  stage_code       TEXT,
  stage_start_year INTEGER,
  locale           TEXT NOT NULL DEFAULT 'zh-CN',
  accent           TEXT NOT NULL DEFAULT 'us' CHECK (accent IN ('us','uk')),
  speech_rate      REAL NOT NULL DEFAULT 1.00 CHECK (speech_rate BETWEEN 0.5 AND 2.0),
  perf_tier        TEXT NOT NULL DEFAULT 'auto'
                   CHECK (perf_tier IN ('auto','smooth','standard','power_saving')),
  asr_model        TEXT NOT NULL DEFAULT 'base',
  daily_goal_min   INTEGER NOT NULL DEFAULT 15,
  report_frequency TEXT NOT NULL DEFAULT 'weekly'
                   CHECK (report_frequency IN ('off','daily','weekly','monthly')),
  extra            TEXT NOT NULL DEFAULT '{}',
  -- 🔶 04 文档 §5.6.1 规则①：首次使用前 1 句校准
  calibration_done INTEGER NOT NULL DEFAULT 0,
  noise_floor_db   REAL,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 🔴 缺陷修正 3：parent_children（「家长只能看自己孩子」的唯一数据支撑）
CREATE TABLE IF NOT EXISTS parent_children (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  child_id   INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  relation   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_parent_children_pair UNIQUE (parent_id, child_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_children_child ON parent_children (child_id);

-- 🔴 缺陷修正 3：consent_log（04 文档 §9.2 未成年人监护人同意）
CREATE TABLE IF NOT EXISTS consent_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id          INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  guardian_id       INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  agreement_version TEXT NOT NULL,
  agreement_hash    TEXT NOT NULL,
  granted           INTEGER NOT NULL CHECK (granted IN (0,1)),
  granted_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at        TEXT,
  source            TEXT NOT NULL DEFAULT 'settings',
  meta              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_consent_log_child_version UNIQUE (child_id, agreement_version)
);
CREATE INDEX IF NOT EXISTS idx_consent_log_child_active ON consent_log (child_id, granted_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 学段 / 教材 / 册次 / 单元（§4.2.2）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS textbook (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id       INTEGER NOT NULL REFERENCES stage(id),
  code           TEXT NOT NULL UNIQUE,
  name_zh        TEXT NOT NULL,
  name_en        TEXT,
  region         TEXT NOT NULL DEFAULT 'CN',
  publisher      TEXT,
  is_official    INTEGER NOT NULL DEFAULT 0,
  license        TEXT,
  source         TEXT,
  enabled_in_mvp INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_textbook_stage ON textbook (stage_id);

CREATE TABLE IF NOT EXISTS volume (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  textbook_id    INTEGER NOT NULL REFERENCES textbook(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name_zh        TEXT NOT NULL,
  grade          INTEGER,
  term           INTEGER,
  sort_order     INTEGER NOT NULL,
  enabled_in_mvp INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_volume_textbook_code UNIQUE (textbook_id, code)
);
CREATE INDEX IF NOT EXISTS idx_volume_textbook ON volume (textbook_id, sort_order);

CREATE TABLE IF NOT EXISTS unit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_id  INTEGER NOT NULL REFERENCES volume(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name_zh    TEXT NOT NULL,
  name_en    TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  CONSTRAINT uq_unit_volume_code UNIQUE (volume_id, code)
);
CREATE INDEX IF NOT EXISTS idx_unit_volume ON unit (volume_id, sort_order);

CREATE TABLE IF NOT EXISTS enrollment (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  stage_id          INTEGER NOT NULL REFERENCES stage(id),
  current_volume_id INTEGER REFERENCES volume(id) ON DELETE SET NULL,
  current_unit_id   INTEGER REFERENCES unit(id)   ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','archived')),
  started_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_enrollment_user ON enrollment (user_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollment_stage ON enrollment (stage_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 词条与例句（§4.2.3）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS word (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  headword        TEXT NOT NULL,
  lemma           TEXT NOT NULL,
  phonetic_uk     TEXT,
  phonetic_us     TEXT,
  pos             TEXT,
  translation_zh  TEXT NOT NULL,
  definition_en   TEXT,
  frequency_rank  INTEGER,
  frequency_band  TEXT,
  -- [PG] varchar(64)[] → TEXT（JSON 数组字符串，jsonStringArray() 读写）
  exam_tags       TEXT DEFAULT '[]',
  audio_uk_path   TEXT,
  audio_us_path   TEXT,
  cefr_level      TEXT,
  is_verb         INTEGER NOT NULL DEFAULT 0,
  irregular_forms TEXT NOT NULL DEFAULT '{}',
  -- [PG] real[] → BLOB（Float32Array）
  embedding       BLOB,
  source          TEXT NOT NULL DEFAULT 'builtin'
                  CHECK (source IN ('builtin','ecdict','import','user')),
  -- 🔴 缺陷修正 5：license NOT NULL（04 文档 §9.3 版权红线）
  license         TEXT NOT NULL,
  source_url      TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  -- [PG] tsvector → FTS5 虚拟表 word_fts（见文件末尾）
  search_tsv      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_word_lemma_pos UNIQUE (lemma, pos)
);
CREATE INDEX IF NOT EXISTS idx_word_lemma    ON word (lemma);
CREATE INDEX IF NOT EXISTS idx_word_freq     ON word (frequency_rank);
CREATE INDEX IF NOT EXISTS idx_word_headword ON word (headword);
-- ⚠️ [PG] 的 pg_trgm 模糊检索在 SQLite 侧由应用层 rapidfuzz 替代（§4.4），
--    3 万词规模内存约 6MB，无需建索引。

CREATE TABLE IF NOT EXISTS word_unit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES word(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_word_unit_unit_word UNIQUE (unit_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_word_unit_word ON word_unit (word_id);
CREATE INDEX IF NOT EXISTS idx_word_unit_unit ON word_unit (unit_id, sort_order);

CREATE TABLE IF NOT EXISTS sentence (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  text           TEXT NOT NULL,
  translation_zh TEXT,
  speaker_role   TEXT CHECK (speaker_role IN ('man','woman','narrator')),
  audio_path     TEXT,
  source_kind    TEXT NOT NULL DEFAULT 'course'
                 CHECK (source_kind IN ('course','exam','ai_generated','user')),
  license        TEXT NOT NULL,
  word_count     INTEGER NOT NULL DEFAULT 0,
  char_count     INTEGER NOT NULL DEFAULT 0,
  difficulty     REAL,
  search_tsv     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sentence_source ON sentence (source_kind);

CREATE TABLE IF NOT EXISTS sentence_unit (
  sentence_id INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
  unit_id     INTEGER NOT NULL REFERENCES unit(id)     ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL,
  PRIMARY KEY (sentence_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_sentence_unit_unit ON sentence_unit (unit_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 词条掌握度 + FSRS（§4.2.4）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS word_mastery (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  word_id            INTEGER NOT NULL REFERENCES word(id)   ON DELETE CASCADE,
  recognize_score    REAL NOT NULL DEFAULT 0,
  listen_score       REAL NOT NULL DEFAULT 0,
  spell_score        REAL NOT NULL DEFAULT 0,
  speak_score        REAL NOT NULL DEFAULT 0,
  overall_score      REAL NOT NULL DEFAULT 0,
  fsrs_state         INTEGER NOT NULL DEFAULT 1,
  fsrs_stability     REAL NOT NULL DEFAULT 0.3,
  fsrs_difficulty    REAL NOT NULL DEFAULT 5.0,
  fsrs_last_review   TEXT,
  fsrs_next_review   TEXT,
  fsrs_reps          INTEGER NOT NULL DEFAULT 0,
  fsrs_lapses        INTEGER NOT NULL DEFAULT 0,
  is_leech           INTEGER NOT NULL DEFAULT 0,
  speak_error_count  INTEGER NOT NULL DEFAULT 0,
  spell_error_count  INTEGER NOT NULL DEFAULT 0,
  phoneme_error_rate REAL NOT NULL DEFAULT 0,
  total_attempts     INTEGER NOT NULL DEFAULT 0,
  last_practiced_at  TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_word_mastery_user_word UNIQUE (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_wm_next_review ON word_mastery (user_id, fsrs_next_review);
-- ⚠️ 文档修正：idx_wm_weak 不能含 frequency_rank（word_mastery 无此列）
CREATE INDEX IF NOT EXISTS idx_wm_weak        ON word_mastery (user_id, overall_score);
-- 部分索引（SQLite 支持）
CREATE INDEX IF NOT EXISTS idx_wm_leech       ON word_mastery (user_id) WHERE is_leech;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 课程与技能树（§4.2.5）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS course (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name_zh       TEXT NOT NULL,
  stage_id      INTEGER NOT NULL REFERENCES stage(id),
  type          TEXT NOT NULL CHECK (type IN
                ('word_loop','shadowing','dictation','dialogue','reading','game','exam')),
  yaml_path     TEXT NOT NULL,
  yaml_hash     TEXT NOT NULL,
  compiled_json TEXT NOT NULL,
  is_official   INTEGER NOT NULL DEFAULT 0,
  license       TEXT NOT NULL,
  created_by    INTEGER REFERENCES "user"(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_course_stage_type ON course (stage_id, type);

CREATE TABLE IF NOT EXISTS course_skill (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id      INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  skill_id       TEXT NOT NULL,
  module_id      TEXT NOT NULL,
  prereq_json    TEXT NOT NULL DEFAULT '[]',
  type           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  content_json   TEXT NOT NULL,
  pass_rule_json TEXT NOT NULL,
  compiled_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_course_skill_course_skill UNIQUE (course_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_skill_course_sort ON course_skill (course_id, sort_order);

CREATE TABLE IF NOT EXISTS lesson_block (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES "user"(id)  ON DELETE CASCADE,
  course_id    INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  block_no     INTEGER NOT NULL,
  word_ids     TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'rule' CHECK (generated_by IN ('rule','llm')),
  consumed     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_lesson_block_user_course_no UNIQUE (user_id, course_id, block_no)
);
CREATE INDEX IF NOT EXISTS idx_lesson_block_pending ON lesson_block (user_id, course_id, consumed);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 学习记录统一大表（§4.2.6）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS learning_record (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- ⚠️ 同 PG 档：采用 contracts RecordKind 的 8 值
  kind              TEXT NOT NULL CHECK (kind IN
                    ('word_card','listen_identify','spell','shadowing','dictation',
                     'pronounce','sentence','conversation')),
  ref_type          TEXT NOT NULL CHECK (ref_type IN
                    ('word','sentence','skill','conversation','game')),
  ref_id            INTEGER,
  course_id         INTEGER REFERENCES course(id) ON DELETE SET NULL,
  unit_id           INTEGER REFERENCES unit(id)   ON DELETE SET NULL,
  is_correct        INTEGER,
  score             REAL,
  accuracy          REAL,
  fluency           REAL,
  completeness      REAL,
  prosody           REAL,
  duration_ms       INTEGER,
  answer_text       TEXT,
  diff_json         TEXT,
  engine            TEXT,
  engine_tier       TEXT,
  status            TEXT NOT NULL DEFAULT 'done'
                    CHECK (status IN ('pending','done','failed','skipped')),
  client_meta       TEXT,
  error_code        TEXT,
  error_msg         TEXT,
  -- 🔴 04 文档 §5.6.3「绝不静默降级」：降级状态持久化到每条记录
  confidence_level  TEXT CHECK (confidence_level IN ('high','medium','low')),
  degrade_level     TEXT CHECK (degrade_level IN ('A','B','C','D','E','F')),
  score_attribution TEXT CHECK (score_attribution IN
                    ('environment_noise','environment_device','environment_too_short',
                     'environment_recording_quality','unknown_safe')),
  formula_version   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lr_user_kind_time ON learning_record (user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lr_user_ref       ON learning_record (user_id, ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_course_time       ON learning_record (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lr_pending        ON learning_record (status) WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 录音与发音评分（§4.2.7 / §4.2.8）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recording (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  fmt             TEXT NOT NULL CHECK (fmt IN ('webm_opus','mp4_aac','wav','ogg')),
  duration_ms     INTEGER NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sample_rate     INTEGER NOT NULL DEFAULT 16000,
  channels        INTEGER NOT NULL DEFAULT 1,
  sha256          TEXT NOT NULL,
  peak_dbfs       REAL,
  snr_db          REAL,
  quality_flag    TEXT NOT NULL DEFAULT 'ok'
                  CHECK (quality_flag IN ('ok','too_quiet','too_loud','noisy','too_short','silence')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','transcoding','transcribing','aligning',
                                    'scoring','completed','failed')),
  wav_path        TEXT,
  ref_text        TEXT,
  transcript      TEXT,
  origin          TEXT NOT NULL DEFAULT 'shadowing'
                  CHECK (origin IN ('shadowing','dictation','dialogue','roleplay','upload')),
  retain_until    TEXT,
  is_error_sample INTEGER NOT NULL DEFAULT 0,
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  CONSTRAINT uq_recording_sha_user UNIQUE (sha256, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rec_user_time ON recording (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_gc        ON recording (is_deleted, deleted_at) WHERE is_deleted;
CREATE INDEX IF NOT EXISTS idx_rec_status    ON recording (status, created_at);
CREATE INDEX IF NOT EXISTS idx_rec_retain    ON recording (retain_until);

CREATE TABLE IF NOT EXISTS pronunciation_score (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ⚠️ 字段名沿用文档：record_id 指向 learning_record(id)，不是 recording
  record_id          INTEGER NOT NULL REFERENCES learning_record(id) ON DELETE CASCADE,
  recording_id       INTEGER REFERENCES recording(id) ON DELETE SET NULL,
  user_id            INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  ref_text           TEXT NOT NULL,
  asr_text           TEXT,
  total_score        REAL,
  accuracy           REAL NOT NULL,
  fluency            REAL NOT NULL,
  completeness       REAL NOT NULL,
  prosody            REAL,
  wide_scale_score   REAL,
  acoustic_distance  REAL,
  phoneme_error_rate REAL NOT NULL,
  word_error_rate    REAL NOT NULL,
  word_count         INTEGER NOT NULL DEFAULT 0,
  formula_version    TEXT NOT NULL DEFAULT '1.0.0',
  weight_json        TEXT NOT NULL DEFAULT '{"acoustic":0.3,"per":0.4,"wer":0.3}',
  engine             TEXT NOT NULL,
  latency_json       TEXT,
  confidence         REAL,
  is_cached          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ps_user_time  ON pronunciation_score (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ps_record     ON pronunciation_score (record_id);
CREATE INDEX IF NOT EXISTS idx_ps_recording  ON pronunciation_score (recording_id);

-- 🔴 缺陷修正 1：phone_score 补 word_id（word_weakness 聚合依赖此列）
CREATE TABLE IF NOT EXISTS phone_score (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  score_id        INTEGER NOT NULL REFERENCES pronunciation_score(id) ON DELETE CASCADE,
  -- 🔴 本次补齐：与教材词条的关联
  word_id         INTEGER REFERENCES word(id) ON DELETE SET NULL,
  word_index      INTEGER NOT NULL,
  word_text       TEXT NOT NULL,
  word_score      REAL NOT NULL,
  char_start      INTEGER,
  char_end        INTEGER,
  is_substitution INTEGER NOT NULL DEFAULT 0,
  is_deletion     INTEGER NOT NULL DEFAULT 0,
  is_insertion    INTEGER NOT NULL DEFAULT 0,
  phones_json     TEXT NOT NULL,
  word_acoustic_distance REAL,
  CONSTRAINT uq_phone_score_score_index UNIQUE (score_id, word_index)
);
CREATE INDEX IF NOT EXISTS idx_phone_score_score ON phone_score (score_id, word_index);
CREATE INDEX IF NOT EXISTS idx_phone_score_word  ON phone_score (word_id);

-- 🔴 缺陷修正 4：word_weakness 唯一索引 (user_id, word_id)
--    [PG] 用 MATERIALIZED VIEW + REFRESH CONCURRENTLY；
--    SQLite 无物化视图 → **普通表 + 每日 UPSERT**（§4.4 已说明）。
--    列名与 PG 档完全一致，聚合 SQL 见 speech.ts 的 WORD_WEAKNESS_AGGREGATE_SQL。
CREATE TABLE IF NOT EXISTS word_weakness (
  user_id        INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  word_id        INTEGER NOT NULL REFERENCES word(id)  ON DELETE CASCADE,
  word_text      TEXT NOT NULL,
  avg_word_score REAL NOT NULL,
  attempts       INTEGER NOT NULL,
  substitutions  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ww_key       ON word_weakness (user_id, word_id);
CREATE INDEX IF NOT EXISTS idx_ww_user_score    ON word_weakness (user_id, avg_word_score);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 错题本 + 错误样本生命周期（§4.2.9）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS error_book (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category      TEXT NOT NULL
                CHECK (category IN ('speak','spell','grammar','listen','reading')),
  word_id       INTEGER REFERENCES word(id)     ON DELETE SET NULL,
  sentence_id   INTEGER REFERENCES sentence(id) ON DELETE SET NULL,
  message       TEXT,
  wrong_count   INTEGER NOT NULL DEFAULT 1,
  right_streak  INTEGER NOT NULL DEFAULT 0,
  is_resolved   INTEGER NOT NULL DEFAULT 0,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  phoneme_json  TEXT,
  last_error_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_eb_user_cat      ON error_book (user_id, category, is_resolved);
CREATE INDEX IF NOT EXISTS idx_eb_user_word     ON error_book (user_id, word_id);
CREATE INDEX IF NOT EXISTS idx_eb_user_sentence ON error_book (user_id, sentence_id);
CREATE INDEX IF NOT EXISTS idx_eb_favorite      ON error_book (user_id, is_favorite);

-- 🔴 缺陷修正 2：error_sample 补 word_id（归档状态机依赖此列）
CREATE TABLE IF NOT EXISTS error_sample (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- 🔴 本次补齐
  word_id       INTEGER REFERENCES word(id) ON DELETE SET NULL,
  record_id     INTEGER REFERENCES learning_record(id) ON DELETE CASCADE,
  recording_id  INTEGER REFERENCES recording(id)     ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN ('speak','spell')),
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  score         REAL,
  wrong_content TEXT,
  keep_until    TEXT NOT NULL,
  replay_count  INTEGER NOT NULL DEFAULT 0,
  last_replay_at TEXT,
  purge_at      TEXT,
  is_purged     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_es_purge     ON error_sample (keep_until) WHERE is_purged = 0;
CREATE INDEX IF NOT EXISTS idx_es_user_cat  ON error_sample (user_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_es_word      ON error_sample (word_id);
CREATE INDEX IF NOT EXISTS idx_es_recording ON error_sample (recording_id);

-- 🔴 缺陷修正 3：archive_error_sample_archive（拼写错误 90 天后转入）
--    user_id 可空：归档 90 天后匿名化置 NULL（04 文档 §9.2 数据最小化）
CREATE TABLE IF NOT EXISTS archive_error_sample_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  word_id       INTEGER REFERENCES word(id)  ON DELETE SET NULL,
  wrong_content TEXT,
  error_count   INTEGER NOT NULL DEFAULT 1,
  archived_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  anonymized_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_word ON archive_error_sample_archive (word_id);
CREATE INDEX IF NOT EXISTS idx_archive_anonymize
  ON archive_error_sample_archive (archived_at) WHERE anonymized_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 打卡 / 热力图 / 挑战 / 游戏（§4.2.10）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_stat (
  user_id         INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  stat_date       TEXT NOT NULL,
  study_minutes   INTEGER NOT NULL DEFAULT 0,
  new_words       INTEGER NOT NULL DEFAULT 0,
  reviews         INTEGER NOT NULL DEFAULT 0,
  shadow_count    INTEGER NOT NULL DEFAULT 0,
  dictation_count INTEGER NOT NULL DEFAULT 0,
  dialogue_turns  INTEGER NOT NULL DEFAULT 0,
  avg_score       REAL NOT NULL DEFAULT 0,
  correct_rate    REAL NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  goal_met        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_stat_date     ON daily_stat (stat_date);
CREATE INDEX IF NOT EXISTS idx_daily_stat_user_date ON daily_stat (user_id, stat_date);

CREATE TABLE IF NOT EXISTS streak (
  user_id         INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  current_days    INTEGER NOT NULL DEFAULT 0,
  longest_days    INTEGER NOT NULL DEFAULT 0,
  last_study_date TEXT,
  freeze_used     INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS heatmap (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  activity_date TEXT NOT NULL,
  level         INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  minutes       INTEGER NOT NULL DEFAULT 0,
  count         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_heatmap_user_date UNIQUE (user_id, activity_date)
);
CREATE INDEX IF NOT EXISTS idx_heatmap_range ON heatmap (user_id, activity_date DESC);

CREATE TABLE IF NOT EXISTS weekly_challenge (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,
  title         TEXT NOT NULL,
  metric        TEXT NOT NULL
                CHECK (metric IN ('study_minutes','new_words','shadow_count','accuracy')),
  target_value  INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ongoing'
                CHECK (status IN ('ongoing','done','expired')),
  CONSTRAINT uq_weekly_challenge_user_week UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_challenge_status ON weekly_challenge (status, week_start);

CREATE TABLE IF NOT EXISTS badge (
  user_id   INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS game_record (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  game_code   TEXT NOT NULL
              CHECK (game_code IN ('word_shooter','spell_truck','miner','match4')),
  score       INTEGER NOT NULL DEFAULT 0,
  combo_max   INTEGER NOT NULL DEFAULT 0,
  accuracy    REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  wrong_words TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_game_user_time ON game_record (user_id, game_code, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. AI 对话会话（§4.2.11）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_conversation (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('chat','interview','story','debate','qa')),
  persona       TEXT NOT NULL DEFAULT 'tutor',
  scenario_id   TEXT,
  level         TEXT NOT NULL,
  provider_used TEXT CHECK (provider_used IN ('ollama','cloud','rule')),
  fallback_used INTEGER NOT NULL DEFAULT 0,
  turn_count    INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  summary_md    TEXT,
  suggestion_md TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','finished','error')),
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_user_time ON ai_conversation (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_user_mode ON ai_conversation (user_id, mode, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_message (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  input_type      TEXT NOT NULL DEFAULT 'text' CHECK (input_type IN ('text','voice')),
  recording_id    INTEGER REFERENCES recording(id) ON DELETE SET NULL,
  asr_text        TEXT,
  translation_zh  TEXT,
  correction_json TEXT,
  tts_audio_path  TEXT,
  provider        TEXT CHECK (provider IN ('ollama','cloud','rule')),
  tokens          INTEGER,
  latency_ms      INTEGER,
  filtered        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT uq_ai_message_conv_seq UNIQUE (conversation_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_seq ON ai_message (conversation_id, seq);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. 教师 / 班级 / 权限 / 系统辅助（§4.2.12 + 缺陷修正 3 补齐）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS class (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  grade       TEXT,
  teacher_id  INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  school_year TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_class_teacher ON class (teacher_id);

CREATE TABLE IF NOT EXISTS class_membership (
  class_id  INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES "user"(id)  ON DELETE CASCADE,
  seat_no   INTEGER,
  role      TEXT NOT NULL DEFAULT 'student',
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON class_membership (user_id);

CREATE TABLE IF NOT EXISTS permission_matrix (
  role      TEXT NOT NULL CHECK (role IN ('student','parent','teacher','admin')),
  feature   TEXT NOT NULL,
  can_read  INTEGER NOT NULL DEFAULT 0,
  can_write INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, feature)
);

-- 🔴 04 文档补两个 action：system_tier_change（§7.7 自动降档审计）
--    / egress_call（§9.2 出网审计）
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  ua          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_log (action, created_at DESC);

-- [PG] BYTEA → BLOB
CREATE TABLE IF NOT EXISTS app_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    BLOB,
  expire_at  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cache_expire ON app_cache (expire_at);

-- 🔴 缺陷修正 3：app_config（只放非敏感配置；敏感 Key 走 app_secret）
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  value_type  TEXT NOT NULL DEFAULT 'string'
              CHECK (value_type IN ('string','number','boolean','json')),
  "group"     TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  editable    INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 🔴 缺陷修正 3：app_secret（AES-256-GCM，密文/iv/tag 分开存）
CREATE TABLE IF NOT EXISTS app_secret (
  name         TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  iv           TEXT NOT NULL,
  auth_tag     TEXT NOT NULL,
  key_version  INTEGER NOT NULL DEFAULT 1,
  expires_at   TEXT,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_app_secret_provider ON app_secret (provider);

-- 🔴 缺陷修正 3：system_notice（降级通知、样本过期提醒、复习提醒）
CREATE TABLE IF NOT EXISTS system_notice (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('degrade','expiry','review','report','system')),
  level      TEXT NOT NULL DEFAULT 'info'
             CHECK (level IN ('info','warning','critical')),
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  ref_type   TEXT,
  ref_id     TEXT,
  read_at    TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_dedupe ON system_notice (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notice_user_read ON system_notice (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notice_user_time ON system_notice (user_id, created_at DESC);

-- 🔴 缺陷修正 3：idempotency_key（§5「写操作去重 24h」）
CREATE TABLE IF NOT EXISTS idempotency_key (
  key           TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  route         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT,
  in_progress   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expire_at     TEXT NOT NULL,
  PRIMARY KEY (key, user_id, route)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expire ON idempotency_key (expire_at);

CREATE TABLE IF NOT EXISTS job_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name    TEXT NOT NULL,
  ref_id      INTEGER,
  status      TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_job_audit_name_time ON job_audit (job_name, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. 全文检索：FTS5 虚拟表（替代 PG 的 tsvector + GIN）
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 content='word' 为外部内容表模式：FTS 只存索引不存正文，
--    查询结果需回 word 表取列（省空间，代价是 join）。
--    建虚拟表后必须 'rebuild' 一次才能与存量数据对齐。
CREATE VIRTUAL TABLE IF NOT EXISTS word_fts USING fts5(
  headword, translation_zh, definition_en,
  content='word', content_rowid='id',
  tokenize="porter unicode61 remove_diacritics 2"
);

CREATE VIRTUAL TABLE IF NOT EXISTS sentence_fts USING fts5(
  text, translation_zh,
  content='sentence', content_rowid='id',
  tokenize="porter unicode61 remove_diacritics 2"
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. 触发器：FTS 索引随 word/sentence 变更自动维护
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 与 PG 档同理：只建虚拟表不建触发器，索引会在首次写入后一直是空的。
--    触发器不可用 IF NOT EXISTS，故先 DROP 再 CREATE（幂等）。
CREATE TRIGGER IF NOT EXISTS trg_word_fts_ai AFTER INSERT ON word BEGIN
  INSERT INTO word_fts(rowid, headword, translation_zh, definition_en)
  VALUES (new.id, new.headword, new.translation_zh, new.definition_en);
END;

CREATE TRIGGER IF NOT EXISTS trg_word_fts_ad AFTER DELETE ON word BEGIN
  INSERT INTO word_fts(word_fts, rowid, headword, translation_zh, definition_en)
  VALUES ('delete', old.id, old.headword, old.translation_zh, old.definition_en);
END;

CREATE TRIGGER IF NOT EXISTS trg_word_fts_au AFTER UPDATE ON word BEGIN
  INSERT INTO word_fts(word_fts, rowid, headword, translation_zh, definition_en)
  VALUES ('delete', old.id, old.headword, old.translation_zh, old.definition_en);
  INSERT INTO word_fts(rowid, headword, translation_zh, definition_en)
  VALUES (new.id, new.headword, new.translation_zh, new.definition_en);
END;

CREATE TRIGGER IF NOT EXISTS trg_sentence_fts_ai AFTER INSERT ON sentence BEGIN
  INSERT INTO sentence_fts(rowid, text, translation_zh)
  VALUES (new.id, new.text, new.translation_zh);
END;

CREATE TRIGGER IF NOT EXISTS trg_sentence_fts_ad AFTER DELETE ON sentence BEGIN
  INSERT INTO sentence_fts(sentence_fts, rowid, text, translation_zh)
  VALUES ('delete', old.id, old.text, old.translation_zh);
END;

CREATE TRIGGER IF NOT EXISTS trg_sentence_fts_au AFTER UPDATE ON sentence BEGIN
  INSERT INTO sentence_fts(sentence_fts, rowid, text, translation_zh)
  VALUES ('delete', old.id, old.text, old.translation_zh);
  INSERT INTO sentence_fts(rowid, text, translation_zh)
  VALUES (new.id, new.text, new.translation_zh);
END;

-- 存量数据对齐（迁移在已有数据的库上执行时必需，§4.4 阶段 A 第 5 步）
INSERT INTO word_fts(word_fts) VALUES('rebuild');
INSERT INTO sentence_fts(sentence_fts) VALUES('rebuild');
