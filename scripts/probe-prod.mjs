// EnglishForge · 线上回归探测（纯 HTTP，不需要 SSH / docker 权限）
//
// 用法：node scripts/probe-prod.mjs
// 作用：打穿线上 10011，逐项验证 2026-10-13 修掉的 4 个 bug + 家长绑定链路。
//
// 判定标准（修复部署后的预期值）：
//   词库 total            > 0        （修复前：0）
//   注册 dataKeys         含 'user'  （修复前：只有 4 个 token 字段）
//   GET /me/profile       200        （修复前：404 code=1002）
//   /users/search         200        （修复前：404 code=1002）
//   bind {username}       200        （修复前：400 code=1001 校验失败）
//   GET /me/children      非空对象数组，含 childId/username（修复前：裸 []）
//
// ⚠️ 副作用：会注册 2 个账号（diag_<stamp> 学生 + parent_<stamp> 家长）并绑定。
//    本应用没有任何账号删除端点，这些账号只能走数据库软删清理。

const BASE = 'http://192.168.31.188:10011/api/v1';
const stamp = (process.env.STAMP || Date.now().toString(36).slice(-5));
const out = [];
const j = (o) => JSON.stringify(o)?.slice(0, 200);

async function req(method, path, { body, token } = {}) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let env = null; try { env = await res.json(); } catch {}
  return { status: res.status, body: env };
}
const say = (tag, extra) => { out.push([tag, extra]); console.log(`[${tag}]`, JSON.stringify(extra)); };

// ---- 线上版本 ----
const info = await req('GET', '/system/info');
say('线上版本', { version: info.body?.data?.version, node: info.body?.data?.node, startedAt: info.body?.data?.startedAt, uptimeSec: info.body?.data?.uptimeSec });

// ---- 学生账号 ----
const reg = await req('POST', '/auth/register', {
  body: { username: `diag_${stamp}`, password: 'password123', displayName: `诊断${stamp}`, role: 'student' },
});
say('注册响应字段 [bug D: 是否回 user]', { status: reg.status, dataKeys: Object.keys(reg.body?.data ?? {}) });
const tok = reg.body?.data?.accessToken;
if (!tok) { console.log('注册失败，终止'); process.exit(1); }

// ---- bug C: 词库 ----
const words = await req('GET', '/words?pageSize=1');
const wordsTok = await req('GET', '/words?pageSize=1', { token: tok });
say('词库 [bug C]', { status: wordsTok.status, total: wordsTok.body?.data?.total, itemsLen: wordsTok.body?.data?.items?.length, envelopeKeys: Object.keys(wordsTok.body?.data ?? {}) });

// ---- bug D: /me/profile vs /me ----
const meProfile = await req('GET', '/me/profile', { token: tok });
const me = await req('GET', '/me', { token: tok });
say('/me/profile [bug D 旧前端调用]', { status: meProfile.status, code: meProfile.body?.code, message: meProfile.body?.message });
say('/me [bug D 正确端点]', { status: me.status, dataKeys: Object.keys(me.body?.data ?? {}), dailyGoalMin: me.body?.data?.profile?.dailyGoalMin });

// ---- bug 1+2: 空列表分页信封 ----
const eb = await req('GET', '/errorbook?pageSize=1', { token: tok });
say('errorbook 空列表 [bug 1+2 根因]', { status: eb.status, total: eb.body?.data?.total, isBareArray: Array.isArray(eb.body?.data), envelopeKeys: Object.keys(eb.body?.data ?? {}) });

// ---- bug E: 家长绑定 ----
const regP = await req('POST', '/auth/register', {
  body: { username: `parent_${stamp}`, password: 'password123', displayName: `家长${stamp}`, role: 'parent' },
});
const pTok = regP.body?.data?.accessToken;
const search = await req('GET', `/users/search?q=diag_${stamp}`, { token: pTok });
say('GET /users/search [bug E 新端点]', { status: search.status, code: search.body?.code, message: search.body?.message });
const bind = await req('POST', '/me/children/bind', { body: { username: `diag_${stamp}`, agreed: true }, token: pTok });
say('bind {username} [bug E 按用户名绑定]', { status: bind.status, code: bind.body?.code, message: bind.body?.message });
const children = await req('GET', '/me/children', { token: pTok });
say('GET /me/children [bug E 视图]', { status: children.status, data: j(children.body?.data), isBareArray: Array.isArray(children.body?.data) });

// ---- diagtest 账号 ----
for (const pw of ['password123', 'Password123', 'diagtest123']) {
  const r = await req('POST', '/auth/login', { body: { username: 'diagtest', password: pw } });
  say(`login diagtest / ${pw}`, { status: r.status, code: r.body?.code, message: r.body?.message });
}
console.log('\n=== 本轮探测账号 ===');
console.log(`学生 diag_${stamp}   家长 parent_${stamp}`);
