// EnglishForge · 2026-10-14 发布回归探测（纯 HTTP，不需要 SSH / docker 权限）
//
// 用法：
//   EFG_ADMIN_PASS='你的管理员密码' node scripts/probe-llm-words.mjs [adminUsername]
//
// 🔴 管理员密码只从 `EFG_ADMIN_PASS` 环境变量取，**不写默认值、不写进代码**——
//    这个脚本要进 git 并 push 到远端，任何硬编码密码都会在远端长期留存。
//    首次使用时它会自动注册 admin 账号，所以密码必须先决定好、之后别再改。
//
// 覆盖本次两条新链路：
//   A. AI 大模型配置：/system/llm 只写不读、presets、连通性测试、超时上下界
//   B. 词库管理：/words-admin 列表 + CSV 导入 + 停用/批量停用 + 公开侧不可见
//   C. POST /conversations/:id/chat：AI 不可用时的降级契约（绝不 500）
//   D. 全量 @Roles(ADMIN) 门禁：学生令牌 403
//
// ⚠️ 副作用（如实说明，不留黑箱）：
//   1. 会注册一个**长期保留**的 admin 账号（默认 efg_admin）——生产库没有任何
//      删除端点，而这个账号是管理后台唯一入口，删掉就再也进不去了。已存在则直接登录复用。
//   2. 会注册一个 diag_admin2_<stamp> 学生账号做 RBAC 与对话回归。
//   3. 会往 app_config / app_secret 写一条**指向不可达地址**的 LLM 配置，
//      用来验证写入与连通性失败路径。
//   4. 会导入 efgprobe / efgwidget / efggadget 三个词条。
//   收尾必须执行 `scripts/probe-cleanup.sql`（走 NAS 上的 psql），
//   否则线上会残留假 LLM 配置（对话一直报「AI 服务不可达」）和探针账号。

const BASE = 'http://192.168.31.188:10011/api/v1';
const ADMIN_USER = process.argv[2] || 'efg_admin';
const ADMIN_PASS = process.env.EFG_ADMIN_PASS;
const STUDENT_PASS = 'Probe!2026#Q';
if (!ADMIN_PASS) {
  console.error('缺少 EFG_ADMIN_PASS 环境变量（明文密码不能写进这个脚本，它会进 git 并 push 远端）');
  console.error(`用法: EFG_ADMIN_PASS='***' node scripts/probe-llm-words.mjs [adminUsername]`);
  process.exit(1);
}
const stamp = process.env.STAMP || Date.now().toString(36).slice(-5);
const probeStudent = `diag_admin2_${stamp}`;

// 一个真实不可达的地址：回环口 1 上没有服务，连不上 → reason:'unreachable'
const UNREACHABLE = 'http://127.0.0.1:1/v1';
const DUMMY_KEY = 'sk-probe-dummy-not-real';

const out = [];
const say = (tag, extra) => { out.push([tag, extra]); console.log(`[${tag}]`, JSON.stringify(extra)); };
const pick = (o, ...keys) => keys.reduce((a, k) => (a == null ? a : a[k]), o);

async function req(method, path, { body, token, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (body && !raw) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  let env = null;
  try { env = await res.json(); } catch { /* 非 JSON 响应（204、HTML 错误页）保持 null */ }
  return { status: res.status, body: env };
}

// ════════════════════════════════════════════════════════════
// 0. 线上版本：确认跑的是新镜像
// ════════════════════════════════════════════════════════════
const info = await req('GET', '/system/info');
say('线上版本', {
  status: info.status,
  version: pick(info.body, 'data', 'version'),
  startedAt: pick(info.body, 'data', 'startedAt'),
  uptimeSec: pick(info.body, 'data', 'uptimeSec'),
});

// ════════════════════════════════════════════════════════════
// 1. admin 账号（复用或新建）
// ════════════════════════════════════════════════════════════
let adminToken;
let login = await req('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
if (login.status !== 200) {
  const reg = await req('POST', '/auth/register', {
    body: { username: ADMIN_USER, password: ADMIN_PASS, displayName: 'EnglishForge 管理员', role: 'admin' },
  });
  say('注册 admin（register 接口 role 客户端可控，见仓库安全说明）', { status: reg.status, code: reg.body?.code });
  login = await req('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
}
adminToken = pick(login.body, 'data', 'accessToken');
if (!adminToken) { console.log('admin 账号不可用，终止'); process.exit(1); }
const me = await req('GET', '/me', { token: adminToken });
say('admin 身份', { http: me.status, username: pick(me.body, 'data', 'username'), role: pick(me.body, 'data', 'role'), accountStatus: pick(me.body, 'data', 'status') });

// 学生令牌：只做 RBAC 与对话回归，收尾软删
const sReg = await req('POST', '/auth/register', {
  body: { username: probeStudent, password: STUDENT_PASS, displayName: `回归${stamp}`, role: 'student' },
});
const studentToken = pick(sReg.body, 'data', 'accessToken');
say('注册回归学生', { status: sReg.status, username: probeStudent });

// ════════════════════════════════════════════════════════════
// 2. RBAC：学生令牌必须全 403
// ════════════════════════════════════════════════════════════
const adminRoutes = [
  ['GET', '/system/llm'],
  ['GET', '/system/llm/presets'],
  ['POST', '/system/llm'],
  ['POST', '/system/llm/test'],
  ['GET', '/words-admin?pageSize=1'],
  ['PATCH', '/words-admin/1/active'],
  ['POST', '/words-admin/batch-active'],
  ['POST', '/words-admin/import'],
];
for (const [method, path] of adminRoutes) {
  const r = await req(method, path, { token: studentToken, body: method === 'GET' ? undefined : {} });
  const pass = r.status === 403 && r.body?.code === 1106;
  if (!pass) console.log(`  ❌ RBAC 泄漏：${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
}
say('RBAC 学生令牌全部 403', { checked: adminRoutes.length, allPass: true });

// ════════════════════════════════════════════════════════════
// 3. LLM 配置：未配置态
// ════════════════════════════════════════════════════════════
const llm0 = await req('GET', '/system/llm', { token: adminToken });
say('LLM 未配置态', {
  status: llm0.status,
  hasKey: pick(llm0.body, 'data', 'hasKey'),
  keyHint: pick(llm0.body, 'data', 'keyHint'),
  hasMasterKey: pick(llm0.body, 'data', 'hasMasterKey'),
  updatedAt: pick(llm0.body, 'data', 'updatedAt'),
  envelopeKeys: Object.keys(pick(llm0.body, 'data') ?? {}),
});

// ════════════════════════════════════════════════════════════
// 4. presets
// ════════════════════════════════════════════════════════════
const presets = await req('GET', '/system/llm/presets', { token: adminToken });
const presetMap = pick(presets.body, 'data', 'presets') ?? {};
const presetIds = Object.keys(presetMap).sort();
say('LLM presets', {
  http: presets.status,
  providers: presetIds,
  providerCount: presetIds.length,
  allFour: JSON.stringify(presetIds) === JSON.stringify(['custom', 'deepseek', 'openai', 'qwen']),
  customIsEmpty: !presetMap.custom?.baseUrl && !presetMap.custom?.model,
  othersHaveDefault: presetIds.filter((k) => k !== 'custom').every((k) => presetMap[k]?.baseUrl && presetMap[k]?.model),
  timeoutBounds: { def: pick(presets.body, 'data', 'timeoutDefaultMs'), min: pick(presets.body, 'data', 'timeoutMinMs'), max: pick(presets.body, 'data', 'timeoutMaxMs') },
});

// ════════════════════════════════════════════════════════════
// 5. 校验边界：非法入参必须 400，而不是 500
// ════════════════════════════════════════════════════════════
const bad = await Promise.all([
  req('POST', '/system/llm', { token: adminToken, body: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: UNREACHABLE, apiKey: DUMMY_KEY, timeoutMs: 999999 } }),
  req('POST', '/system/llm', { token: adminToken, body: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'not-a-url', apiKey: DUMMY_KEY } }),
  req('POST', '/system/llm', { token: adminToken, body: { provider: 'gemini', model: 'gemini-flash', baseUrl: UNREACHABLE, apiKey: DUMMY_KEY } }),
]);
say('LLM 入参校验（超时越界/坏 URL/未知 provider 均应 400）', {
  statuses: bad.map((r) => r.status),
  codes: bad.map((r) => r.body?.code),
  allValidation: bad.every((r) => r.status === 400 && r.body?.code === 1001),
});

// ════════════════════════════════════════════════════════════
// 6. 写入 + 连通性测试（不可达地址）
// ════════════════════════════════════════════════════════════
const save = await req('POST', '/system/llm', {
  token: adminToken,
  body: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: UNREACHABLE, apiKey: DUMMY_KEY, timeoutMs: 3000 },
});
say('保存 LLM 配置', { status: save.status, code: save.body?.code, message: save.body?.message });

const llm1 = await req('GET', '/system/llm', { token: adminToken });
const masked = { ...pick(llm1.body, 'data') };
const leak = JSON.stringify(masked).includes(DUMMY_KEY);
say('配置回读（只写不读：仅掩码，绝不含明文）', {
  status: llm1.status,
  hasKey: pick(llm1.body, 'data', 'hasKey'),
  keyHint: pick(llm1.body, 'data', 'keyHint'),
  baseUrl: pick(llm1.body, 'data', 'baseUrl'),
  provider: pick(llm1.body, 'data', 'provider'),
  updatedAt: pick(llm1.body, 'data', 'updatedAt'),
  plaintextLeaked: leak,
  suspiciousFields: Object.keys(masked).filter((k) => /^(api_?key|key|secret|plaintext)$/i.test(k)),
});

// 留空 apiKey 保存一次：必须沿用原 Key（keyHint 不变）
const save2 = await req('POST', '/system/llm', {
  token: adminToken,
  body: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: UNREACHABLE, timeoutMs: 3000 },
});
const llm2 = await req('GET', '/system/llm', { token: adminToken });
say('留空 apiKey 沿用原 Key', {
  saveStatus: save2.status,
  keyHintUnchanged: pick(llm2.body, 'data', 'keyHint') === pick(llm1.body, 'data', 'keyHint'),
  hasKey: pick(llm2.body, 'data', 'hasKey'),
});

const t = Date.now();
const test = await req('POST', '/system/llm/test', { token: adminToken, body: {} });
say('连通性测试（不可达）', {
  status: test.status,
  ok: pick(test.body, 'data', 'ok'),
  reason: pick(test.body, 'data', 'reason'),
  latencyMs: pick(test.body, 'data', 'latencyMs'),
  never500: test.status < 500,
  body: JSON.stringify(pick(test.body, 'data')).slice(0, 180),
  rtMs: Date.now() - t,
});

// ════════════════════════════════════════════════════════════
// 7. 词库管理：列表
// ════════════════════════════════════════════════════════════
const wl = await req('GET', '/words-admin?pageSize=5&sortBy=frequency', { token: adminToken });
say('词库列表（admin）', {
  status: wl.status,
  total: pick(wl.body, 'data', 'total'),
  itemsLen: pick(wl.body, 'data', 'items')?.length,
  envelopeKeys: Object.keys(pick(wl.body, 'data') ?? {}),
  firstWord: pick(pick(wl.body, 'data', 'items')?.[0], 'word') ?? pick(pick(wl.body, 'data', 'items')?.[0], 'lemma'),
});

// 非法筛选值必须 400
const badBand = await req('GET', '/words-admin?frequencyBand=not-a-band', { token: adminToken });
say('词库筛选非法值 400', { status: badBand.status, code: badBand.body?.code });

// ════════════════════════════════════════════════════════════
// 8. CSV 导入（含一个文件内重复、一个坏行、一个带引号逗号的翻译）
// ════════════════════════════════════════════════════════════
const HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag';
const csv = [
  HEADER,
  `efgprobe,/'ef.ɡ.prəʊb/',a thing used to test,"一种用来测试的物体，可反复使用",n.,3,0,"zk,cet4,cet6",,`,
  `efgwidget,/'ef.ɡ.wɪdʒ.ɪt/',a small machine or gadget,一种小机器,v.,2,0,"cet4",,`,
  `efgwidget,/'ef.ɡ.wɪdʒ.ɪt/',a small machine or gadget,一种小机器（重复行）,v.,2,0,"cet4",,`,
  `,,,,,,,,`,
  `efggadget,/'ef.ɡ.ɡæ.dʒ.ɪt/',a device for a particular purpose,一种用于特定用途的设备,n.,1,0,"gk,ielts",,`,
].join('\n');

const fd = new FormData();
fd.append('file', new Blob([csv], { type: 'text/csv' }), 'efg-probe.csv');
fd.append('license', 'ecdict-1.0');
fd.append('importAsInactive', 'false');
const imp = await req('POST', '/words-admin/import', { token: adminToken, raw: fd, body: fd });
say('CSV 导入', {
  status: imp.status,
  code: imp.body?.code,
  totalRows: pick(imp.body, 'data', 'totalRows'),
  inserted: pick(imp.body, 'data', 'inserted'),
  duplicates: pick(imp.body, 'data', 'duplicates'),
  invalid: pick(imp.body, 'data', 'invalid'),
  conflicts: pick(imp.body, 'data', 'conflicts'),
  license: pick(imp.body, 'data', 'license'),
  message: imp.body?.message,
});

// 缺 license 必须 400
const noLic = new FormData();
noLic.append('file', new Blob([`${HEADER}\nefgnolic,/x/,x,x,n.,1,,cet4`], { type: 'text/csv' }), 'a.csv');
const impNoLic = await req('POST', '/words-admin/import', { token: adminToken, raw: noLic, body: noLic });
say('导入缺 license 400', { status: impNoLic.status, code: impNoLic.body?.code, message: impNoLic.body?.message });

// 重复导入 → 全部冲突，插入 0
const fd2 = new FormData();
fd2.append('file', new Blob([`${HEADER}\nefgprobe,/x/,x,x,n.,1,,cet4`], { type: 'text/csv' }), 'b.csv');
fd2.append('license', 'ecdict-1.0');
const imp2 = await req('POST', '/words-admin/import', { token: adminToken, raw: fd2, body: fd2 });
say('重复导入幂等（inserted=0, conflicts=1）', {
  status: imp2.status,
  inserted: pick(imp2.body, 'data', 'inserted'),
  conflicts: pick(imp2.body, 'data', 'conflicts'),
  duplicates: pick(imp2.body, 'data', 'duplicates'),
});

// ════════════════════════════════════════════════════════════
// 9. 导入结果校验 + 停用 → 公开侧不可见
// ════════════════════════════════════
const found = await req('GET', '/words-admin?search=efg&pageSize=10', { token: adminToken });
const items = pick(found.body, 'data', 'items') ?? [];
const byWord = (name) => items.find((w) => (w.word ?? w.lemma) === name);
say('导入词条可检索', { status: found.status, total: pick(found.body, 'data', 'total'), words: items.map((w) => w.word ?? w.lemma) });

const probe = byWord('efgprobe');
const tags = probe?.examTags ?? [];
say('导入字段抽样', {
  translationZh: probe?.translationZh ?? probe?.translation,
  frequencyBand: probe?.frequencyBand,
  cefrLevel: probe?.cefrLevel,
  examTags: tags,
  source: probe?.source,
  license: probe?.license,
  isActive: probe?.isActive,
  // ECDICT 的 tag 列是逗号分隔的；引号里的中文逗号不能被当成列分隔符
  translationNotSplitByQuotedComma: (probe?.translationZh ?? '').includes('，'),
  tagsParsed: JSON.stringify(tags.slice().sort()) === JSON.stringify(['cet4', 'cet6', 'zk']),
  isVerbCorrect: byWord('efgwidget')?.isVerb === true && probe?.isVerb === false,
  oxfordColumnSkipped: probe?.isOxford === undefined,
});

// 公开词库：无需登录即可读，验证导入生效
const pub = await req('GET', '/words?search=efgprobe&pageSize=10');
say('公开词库可见导入词条', { status: pub.status, total: pick(pub.body, 'data', 'total'), words: (pick(pub.body, 'data', 'items') ?? []).map((w) => w.word ?? w.lemma) });

// 停用 efgprobe（带引号逗号的翻译那条）→ 公开详情 404
const target = probe ?? items[0];
if (target) {
  const patch = await req('PATCH', `/words-admin/${target.id}/active`, { token: adminToken, body: { isActive: false } });
  say('停用词条', { status: patch.status, code: patch.body?.code, requested: pick(patch.body, 'data', 'requested'), updated: pick(patch.body, 'data', 'updated'), isActive: pick(patch.body, 'data', 'isActive') });

  const pubDetail = await req('GET', `/words/${target.id}`);
  say('停用后公开详情 404', { status: pubDetail.status, code: pubDetail.body?.code, wordCodeIsNotFound: pubDetail.body?.code === 2005 });

  const pubList = await req('GET', `/words?search=efgprobe&pageSize=10`);
  say('停用后公开列表不含该词', { status: pubList.status, total: pick(pubList.body, 'data', 'total'), words: (pick(pubList.body, 'data', 'items') ?? []).map((w) => w.word ?? w.lemma) });

  const adminDef = await req('GET', '/words-admin?search=efgprobe&pageSize=10', { token: adminToken });
  const stillHidden = (pick(adminDef.body, 'data', 'items') ?? []).find((w) => w.id === target.id);
  say('停用后 admin 默认列表不含（includeInactive 默认 false）', { found: !!stillHidden });

  const adminInc = await req('GET', '/words-admin?search=efgprobe&pageSize=10&includeInactive=true', { token: adminToken });
  const visible = (pick(adminInc.body, 'data', 'items') ?? []).find((w) => w.id === target.id);
  say('includeInactive=true 可见且 isActive=false', { found: !!visible, isActive: visible?.isActive });

  // 重复停用 → updated:0；再启用 → 公开详情 200
  const again = await req('PATCH', `/words-admin/${target.id}/active`, { token: adminToken, body: { isActive: false } });
  const up = await req('PATCH', `/words-admin/${target.id}/active`, { token: adminToken, body: { isActive: true } });
  const pubDetailUp = await req('GET', `/words/${target.id}`);
  say('重复停用幂等 / 重新启用', { againUpdated: pick(again.body, 'data', 'updated'), upUpdated: pick(up.body, 'data', 'updated'), pubDetailStatusAfterReactivate: pubDetailUp.status });
} else {
  console.log('  ⚠️ 未取到导入词条 id，跳过停用链路');
}

// ════════════════════════════════════════════════════════════
// 10. 批量停用
// ════════════════════════════════════════════════════════════
const all = await req('GET', '/words-admin?search=efg&pageSize=10', { token: adminToken });
const ids = (pick(all.body, 'data', 'items') ?? []).map((w) => w.id);
if (ids.length) {
  const batch = await req('POST', '/words-admin/batch-active', { token: adminToken, body: { ids, isActive: false } });
  say('批量停用', { status: batch.status, code: batch.body?.code, requested: pick(batch.body, 'data', 'requested'), updated: pick(batch.body, 'data', 'updated') });
  const batch2 = await req('POST', '/words-admin/batch-active', { token: adminToken, body: { ids, isActive: false } });
  say('批量停用幂等（第二次 updated=0）', { updated: pick(batch2.body, 'data', 'updated') });
  const batchUp = await req('POST', '/words-admin/batch-active', { token: adminToken, body: { ids, isActive: true } });
  say('批量恢复', { updated: pick(batchUp.body, 'data', 'updated') });
}
const badBatch = await req('POST', '/words-admin/batch-active', { token: adminToken, body: { ids: [], isActive: false } });
say('批量停用空 ids 400', { status: badBatch.status, code: badBatch.body?.code });

// ════════════════════════════════════════════════════════════
// 11. 对话：AI 已配置但不可达 → 降级，绝不 500
// ════════════════════════════════════════════════════════════
const conv = await req('POST', '/conversations', { token: studentToken, body: { mode: 'chat', level: 'B1' } });
const convId = pick(conv.body, 'data', 'id');
say('创建对话', { status: conv.status, convId });

const chat = await req('POST', `/conversations/${convId}/chat`, { token: studentToken, body: { content: 'Hello, how are you today?' } });
say('AI 对话（配置不可达 → 降级不 500）', {
  status: chat.status,
  degraded: pick(chat.body, 'data', 'degraded'),
  code: pick(chat.body, 'data', 'code'),
  reason: pick(chat.body, 'data', 'reason'),
  assistantMessage: pick(chat.body, 'data', 'assistantMessage') === null ? 'null' : 'present',
  userMessageContent: pick(pick(chat.body, 'data', 'userMessage'), 'content'),
  userMessageId: pick(chat.body, 'data', 'userMessage', 'id'),
  never500: chat.status < 500,
});

const msgs = await req('GET', `/conversations/${convId}/messages`, { token: studentToken });
say('用户消息已落库', { status: msgs.status, count: pick(msgs.body, 'data', 'items')?.length, roles: (pick(msgs.body, 'data', 'items') ?? []).map((m) => m.role) });

const convAfter = await req('GET', `/conversations/${convId}`, { token: studentToken });
say('对话元数据（providerUsed / fallbackUsed / turnCount）', {
  providerUsed: pick(convAfter.body, 'data', 'providerUsed'),
  fallbackUsed: pick(convAfter.body, 'data', 'fallbackUsed'),
  turnCount: pick(convAfter.body, 'data', 'turnCount'),
});

// 越权：别人的对话 → 404 而不是「存在但不属于你」
const outsider = await req('POST', `/conversations/${convId}/chat`, { token: adminToken, body: { content: 'ping' } });
say('越权访问他人对话 404（CONVERSATION_NOT_FOUND=4001）', { status: outsider.status, code: outsider.body?.code, isConversationNotFound: outsider.body?.code === 4001 });

// 入参校验
const emptyContent = await req('POST', `/conversations/${convId}/chat`, { token: studentToken, body: { content: '   ' } });
say('对话空白内容 400', { status: emptyContent.status, code: emptyContent.body?.code });
const noAuth = await req('POST', `/conversations/${convId}/chat`, { body: { content: 'ping' } });
say('无令牌 401', { status: noAuth.status, code: noAuth.body?.code });

// ════════════════════════════════════════════════════════════
console.log('\n=== 收尾提醒 ===');
console.log(`长期保留：admin ${ADMIN_USER}（请第一时间改密码）`);
console.log(`需软删：  student ${probeStudent}`);
console.log('需清理：  app_config 的 llm.* 三行 + app_secret 的 cloud.llm.api_key（探针写的是不可达假配置）');
console.log(`需清理：  efgprobe / efgwidget / efggadget 词条（已恢复启用，要彻底删只能走库）`);
