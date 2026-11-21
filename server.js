// تحدّي مصطلحات التاريخ | BEN CENTRE — خادم الجلسات المباشرة (Node.js بدون مكتبات خارجية)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const DEFAULTS = require('./content');
const N = require('./public/norm');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const PUB = path.join(__dirname, 'public');
const MAX_AGE = 1000 * 60 * 60 * 24 * 30; // تُحذف الجلسات بعد 30 يومًا

fs.mkdirSync(DATA_DIR, { recursive: true });
const clone = o => JSON.parse(JSON.stringify(o));
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (sessions[c]); return c; };

function loadJSON(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
let sessions = loadJSON(SESS_FILE, {});
for (const [c, s] of Object.entries(sessions)) if (Date.now() - s.createdAt > MAX_AGE) delete sessions[c];
function defaultContent() { return clone(loadJSON(CONTENT_FILE, null) || DEFAULTS); }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = SESS_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(sessions), e => { if (!e) fs.rename(tmp, SESS_FILE, () => {}); });
  }, 800);
}

// ---------- منطق الجلسة ----------
function createSession() {
  const c = defaultContent();
  const s = {
    code: newCode(), teacherKey: rid(18), createdAt: Date.now(), v: 1,
    terms: c.terms, sorts: c.sorts, questions: c.questions,
    stage: 1,
    current: { qid: null, status: 'idle' }, // idle | open | closed | revealed
    asked: [],
    students: {}, byClient: {},
    answers: {},  // qid -> sid -> {value, at, auto, verdict}
    classMiss: {}, // أخطاء السبورة (المرحلة 2): termId -> عدد
    exit: { status: 'idle', items: {}, answers: {} } // idle | open | closed | published
  };
  sessions[s.code] = s; save();
  return s;
}
const termOf = (s, id) => s.terms.find(t => t.id === id);
const eff = a => (a.verdict === true || a.verdict === false) ? a.verdict : a.auto;

function autoScore(s, q, value) {
  if (q.type === 'mcq') return Number(value) === Number(q.answer);
  if (q.type === 'fill') return N.autoFill(q.accept, value);
  const t = termOf(s, q.termId); return t ? N.autoDef(t, value) : false;
}
function autoExit(s, item, value) {
  const t = termOf(s, item.termId); if (!t) return false;
  return item.kind === 'use' ? N.autoUse(t, value) : N.autoDef(t, value);
}

// إحصاءات لكل مصطلح ولكل تلميذ
function computeStats(s) {
  const perTerm = {}; const perStudent = {};
  const bump = (tid, ok, sid, src) => {
    if (!tid) return;
    const p = perTerm[tid] || (perTerm[tid] = { ok: 0, n: 0, s3ok: 0, s3n: 0, exOk: 0, exN: 0 });
    p.n++; if (ok) p.ok++;
    if (src === 3) { p.s3n++; if (ok) p.s3ok++; } else { p.exN++; if (ok) p.exOk++; }
    const st = perStudent[sid] || (perStudent[sid] = { wrong: {}, ok: 0, n: 0 });
    st.n++; if (ok) st.ok++; else st.wrong[tid] = (st.wrong[tid] || 0) + 1;
  };
  for (const q of s.questions) {
    const st = s.current.qid === q.id ? s.current.status : (s.asked.includes(q.id) ? 'done' : 'idle');
    if (st === 'idle' || st === 'open') continue; // لا يُحتسب إلا السؤال المغلق
    for (const [sid, a] of Object.entries(s.answers[q.id] || {})) bump(q.termId, !!eff(a), sid, 3);
  }
  if (s.exit.status === 'closed' || s.exit.status === 'published') {
    for (const [sid, items] of Object.entries(s.exit.items)) {
      const a = s.exit.answers[sid]; if (!a) continue;
      items.forEach((it, i) => bump(it.termId, !!(a.verdict[i] ?? a.auto[i]), sid, 4));
    }
  }
  return { perTerm, perStudent };
}

// توليد اختبار الخروج: أولوية لأخطاء التلميذ، ثم نقاط ضعف القسم
function buildExit(s, sid) {
  const { perTerm, perStudent } = computeStats(s);
  const mine = Object.entries((perStudent[sid] || {}).wrong || {}).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const classScore = t => {
    const p = perTerm[t.id]; const err = p && p.s3n ? 1 - p.s3ok / p.s3n : 0;
    return (s.classMiss[t.id] || 0) * 0.5 + err * 2 + Math.random() * 0.3;
  };
  const rest = s.terms.filter(t => !mine.includes(t.id)).sort((a, b) => classScore(b) - classScore(a)).map(t => t.id);
  const order = [...mine.filter(id => termOf(s, id)), ...rest].slice(0, 3);
  return order.map((termId, i) => ({ kind: i < 2 ? 'def' : 'use', termId }));
}

function exitPrompt(s, it) {
  const t = termOf(s, it.termId) || { name: '؟' };
  return it.kind === 'def'
    ? `اكتب تعريف «${t.name}» من ذاكرتك.`
    : `وظّف مصطلح «${t.name}» في جملة تاريخية تبيّن سياقه (الفترة، الأطراف، الحدث).`;
}

// ---------- ما يراه كل طرف ----------
function publicQuestion(q) {
  const o = { id: q.id, type: q.type, prompt: q.prompt };
  if (q.type === 'mcq') o.options = q.options;
  return o;
}
function correctText(s, q) {
  if (q.type === 'mcq') return q.options[q.answer];
  if (q.type === 'fill') return (q.accept || [])[0] || '';
  return (termOf(s, q.termId) || {}).name || '';
}

function studentView(s, sid) {
  const st = s.students[sid];
  const out = { code: s.code, v: s.v, stage: s.stage, me: { id: sid, pseudo: st.pseudo }, current: null, exit: null, review: null };
  const q = s.questions.find(x => x.id === s.current.qid);
  if (q && s.current.status !== 'idle') {
    const a = (s.answers[q.id] || {})[sid];
    out.current = { q: publicQuestion(q), status: s.current.status, myAnswer: a ? a.value : null };
    if (s.current.status === 'revealed') {
      const t = termOf(s, q.termId) || {};
      out.current.result = {
        correct: a ? !!eff(a) : null, pending: a ? (q.type !== 'mcq' && a.verdict == null) : false,
        answer: correctText(s, q), term: t.name, def: t.def, keywords: t.keywords, example: t.example
      };
    }
  }
  if (s.exit.status !== 'idle') {
    if (s.exit.status === 'open' && !s.exit.items[sid]) { s.exit.items[sid] = buildExit(s, sid); save(); }
    const items = s.exit.items[sid];
    const a = s.exit.answers[sid];
    out.exit = { status: s.exit.status, submitted: !!a, items: (items || []).map((it, i) => ({ kind: it.kind, prompt: exitPrompt(s, it), mine: a ? a.values[i] : null })) };
    if (s.exit.status === 'published' && items) {
      out.exit.items.forEach((x, i) => {
        const t = termOf(s, items[i].termId) || {};
        x.correct = a ? !!(a.verdict[i] ?? a.auto[i]) : false;
        x.term = t.name; x.def = t.def; x.keywords = t.keywords; x.example = t.example;
      });
      const { perStudent } = computeStats(s);
      const wrongIds = Object.keys((perStudent[sid] || {}).wrong || {});
      if (!a) items.forEach(it => { if (!wrongIds.includes(it.termId)) wrongIds.push(it.termId); });
      out.review = {
        terms: wrongIds.map(id => termOf(s, id)).filter(Boolean).map(t => ({ id: t.id, name: t.name, def: t.def, keywords: t.keywords, example: t.example, situation: t.situation, hint: t.hint })),
        allNames: s.terms.map(t => t.name)
      };
    }
  }
  return out;
}

function teacherView(s) {
  const o = clone(s); delete o.teacherKey; delete o.byClient;
  for (const st of Object.values(o.students)) delete st.token;
  for (const qa of Object.values(o.answers)) for (const a of Object.values(qa)) a.eff = eff(a);
  o.stats = computeStats(s);
  o.exitPrompts = {};
  for (const [sid, items] of Object.entries(s.exit.items)) o.exitPrompts[sid] = items.map(it => exitPrompt(s, it));
  return o;
}

// ---------- البث المباشر (Server-Sent Events) ----------
const listeners = new Set(); // {code, role, res, sid}
function bump(s, pub) {
  s.v++; save();
  for (const l of listeners) if (l.code === s.code && (pub || l.role === 'teacher')) l.res.write(`event: update\ndata: {"v":${s.v}}\n\n`);
}
setInterval(() => { for (const l of listeners) l.res.write(': ping\n\n'); }, 20000);
const onlineCount = code => new Set([...listeners].filter(l => l.code === code && l.role === 'student').map(l => l.sid)).size;

// ---------- أدوات HTTP ----------
function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function body(req) {
  return new Promise((ok, ko) => {
    let d = ''; req.setEncoding('utf8');
    req.on('data', c => { d += c; if (d.length > 400000) { ko(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ko(e); } });
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveFile(res, file) {
  const p = path.join(PUB, file);
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || [])
    if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}
const clean = (x, n) => String(x == null ? '' : x).slice(0, n);

// ---------- إجراءات الأستاذ ----------
function teacherAction(s, b) {
  const q = s.questions.find(x => x.id === b.qid);
  switch (b.action) {
    case 'stage': s.stage = Math.min(4, Math.max(1, Number(b.stage) || 1)); break;
    case 'open':
      if (!q) throw new Error('سؤال غير موجود');
      if (s.current.qid && s.current.qid !== q.id && !s.asked.includes(s.current.qid)) s.asked.push(s.current.qid);
      s.current = { qid: q.id, status: 'open' }; s.stage = 3; break;
    case 'close': if (s.current.status === 'open') s.current.status = 'closed'; break;
    case 'reveal': if (s.current.qid) s.current.status = 'revealed'; break;
    case 'reopen': if (s.current.qid) s.current.status = 'open'; break;
    case 'clearQ':
      if (s.current.qid && !s.asked.includes(s.current.qid)) s.asked.push(s.current.qid);
      s.current = { qid: null, status: 'idle' }; break;
    case 'verdict': {
      const a = (s.answers[b.qid] || {})[b.sid]; if (!a) throw new Error('إجابة غير موجودة');
      a.verdict = b.value === null ? null : !!b.value; break;
    }
    case 'boardMiss': if (termOf(s, b.termId)) s.classMiss[b.termId] = (s.classMiss[b.termId] || 0) + 1; break;
    case 'exitStart':
      s.stage = 4;
      if (s.exit.status === 'idle') { for (const sid of Object.keys(s.students)) s.exit.items[sid] = buildExit(s, sid); }
      s.exit.status = 'open'; break;
    case 'exitClose': s.exit.status = 'closed'; break;
    case 'exitPublish': s.exit.status = 'published'; break;
    case 'exitReopen': s.exit.status = 'open'; break;
    case 'exitVerdict': {
      const a = s.exit.answers[b.sid]; if (!a) throw new Error('إجابة غير موجودة');
      a.verdict[Number(b.i)] = b.value === null ? null : !!b.value; break;
    }
    case 'content': {
      if (!Array.isArray(b.terms) || !Array.isArray(b.questions)) throw new Error('محتوى غير صالح');
      s.terms = b.terms.slice(0, 60).map((t, i) => ({
        id: clean(t.id || 't' + Date.now() + i, 40), name: clean(t.name, 120), def: clean(t.def, 1200),
        keywords: (Array.isArray(t.keywords) ? t.keywords : []).map(k => clean(k, 120)).filter(Boolean).slice(0, 6),
        example: clean(t.example, 600), recall: clean(t.recall, 300), situation: clean(t.situation, 600),
        hint: clean(t.hint, 300), year: Number(t.year) || 0
      })).filter(t => t.name);
      s.questions = b.questions.slice(0, 80).map((x, i) => {
        const o = { id: clean(x.id || 'q' + Date.now() + i, 40), type: ['mcq', 'fill', 'open'].includes(x.type) ? x.type : 'mcq', kind: clean(x.kind, 20), termId: clean(x.termId, 40), prompt: clean(x.prompt, 1200) };
        if (o.type === 'mcq') { o.options = (x.options || []).map(z => clean(z, 200)).filter(Boolean).slice(0, 6); o.answer = Math.min(Math.max(0, Number(x.answer) || 0), Math.max(0, o.options.length - 1)); }
        if (o.type === 'fill') o.accept = (x.accept || []).map(z => clean(z, 120)).filter(Boolean).slice(0, 10);
        return o;
      }).filter(x => x.prompt);
      if (b.asDefault) {
        fs.writeFileSync(CONTENT_FILE, JSON.stringify({ terms: s.terms, sorts: s.sorts, questions: s.questions }, null, 1));
      }
      break;
    }
    case 'resetContent': { const c = clone(DEFAULTS); s.terms = c.terms; s.questions = c.questions; s.sorts = c.sorts; try { fs.unlinkSync(CONTENT_FILE); } catch {} break; }
    case 'kick': { const st = s.students[b.sid]; if (st) { delete s.byClient[st.clientId]; delete s.students[b.sid]; } break; }
    default: throw new Error('إجراء غير معروف');
  }
}

// ---------- الموجّه ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let m;
    if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html');
    if (req.method === 'GET' && /^\/t\/[A-Z0-9]{5}\/?$/i.test(p)) return serveFile(res, 'teacher.html');
    if (req.method === 'GET' && /^\/j\/[A-Z0-9]{5}\/?$/i.test(p)) return serveFile(res, 'student.html');
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/api/info') return send(res, 200, { publicUrl: PUBLIC_URL, lan: lanUrls() });
    if (req.method === 'POST' && p === '/api/sessions') { const s = createSession(); return send(res, 200, { code: s.code, key: s.teacherKey }); }

    if ((m = p.match(/^\/api\/s\/([A-Z0-9]{5})(\/[a-z]+)?$/i))) {
      const s = sessions[m[1].toUpperCase()];
      if (!s) return send(res, 404, { error: 'الجلسة غير موجودة. تحقق من الرمز.' });
      const sub = m[2] || '';
      const key = u.searchParams.get('key'); const token = u.searchParams.get('token');
      const isT = k => k && crypto.timingSafeEqual(Buffer.from(String(k).padEnd(64).slice(0, 64)), Buffer.from(s.teacherKey.padEnd(64).slice(0, 64)));
      const studentBy = t => t && Object.values(s.students).find(x => x.token === t);

      if (req.method === 'GET' && sub === '/events') {
        let role, sid;
        if (isT(key)) role = 'teacher'; else { const st = studentBy(token); if (!st) return send(res, 403, { error: 'غير مصرح' }); role = 'student'; sid = st.id; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 2000\nevent: update\ndata: {"v":${s.v}}\n\n`);
        const l = { code: s.code, role, res, sid }; listeners.add(l);
        if (role === 'student') bump(s, false); // يُحدّث عدد المتصلين لدى الأستاذ
        req.on('close', () => { listeners.delete(l); if (role === 'student') bump(s, false); });
        return;
      }
      if (req.method === 'GET' && sub === '') {
        if (isT(key)) { const v = teacherView(s); v.online = onlineCount(s.code); return send(res, 200, v); }
        const st = studentBy(token);
        if (st) return send(res, 200, studentView(s, st.id));
        return send(res, 200, { code: s.code, exists: true }); // للتحقق من وجود الجلسة قبل الانضمام
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'طريقة غير مسموحة' });
      const b = await body(req);

      if (sub === '/join') {
        const clientId = clean(b.clientId, 64); let pseudo = clean(b.pseudo, 20).trim();
        if (!clientId) return send(res, 400, { error: 'معرّف الجهاز مفقود' });
        const existing = s.byClient[clientId] && s.students[s.byClient[clientId]];
        if (existing) return send(res, 200, { token: existing.token, sid: existing.id, pseudo: existing.pseudo });
        if (!pseudo) return send(res, 400, { error: 'اكتب اسمًا مستعارًا' });
        const names = new Set(Object.values(s.students).map(x => x.pseudo));
        let candidate = pseudo, k = 2; while (names.has(candidate)) candidate = pseudo + ' ' + k++;
        const st = { id: rid(6), token: rid(18), clientId, pseudo: candidate, joinedAt: Date.now() };
        s.students[st.id] = st; s.byClient[clientId] = st.id;
        if (s.exit.status === 'open') s.exit.items[st.id] = buildExit(s, st.id);
        bump(s, false);
        return send(res, 200, { token: st.token, sid: st.id, pseudo: st.pseudo });
      }
      if (sub === '/answer') {
        const st = studentBy(b.token); if (!st) return send(res, 403, { error: 'غير مصرح' });
        const q = s.questions.find(x => x.id === b.qid);
        if (!q || s.current.qid !== q.id || s.current.status !== 'open') return send(res, 409, { error: 'السؤال مغلق' });
        const qa = s.answers[q.id] || (s.answers[q.id] = {});
        if (qa[st.id]) return send(res, 409, { error: 'سبق أن أرسلت إجابتك لهذا السؤال' });
        let value = q.type === 'mcq' ? Number(b.value) : clean(b.value, 800).trim();
        if (q.type === 'mcq' && !(value >= 0 && value < q.options.length)) return send(res, 400, { error: 'اختيار غير صالح' });
        if (q.type !== 'mcq' && !value) return send(res, 400, { error: 'الإجابة فارغة' });
        qa[st.id] = { value, at: Date.now(), auto: autoScore(s, q, value), verdict: null };
        bump(s, false);
        return send(res, 200, { ok: true });
      }
      if (sub === '/exit') {
        const st = studentBy(b.token); if (!st) return send(res, 403, { error: 'غير مصرح' });
        if (s.exit.status !== 'open') return send(res, 409, { error: 'اختبار الخروج مغلق' });
        if (s.exit.answers[st.id]) return send(res, 409, { error: 'سبق أن أرسلت اختبارك' });
        const items = s.exit.items[st.id] || (s.exit.items[st.id] = buildExit(s, st.id));
        const values = items.map((_, i) => clean((b.values || [])[i], 800).trim());
        s.exit.answers[st.id] = { values, at: Date.now(), auto: items.map((it, i) => autoExit(s, it, values[i])), verdict: items.map(() => null) };
        bump(s, false);
        return send(res, 200, { ok: true });
      }
      if (sub === '/teacher') {
        if (!isT(b.key)) return send(res, 403, { error: 'مفتاح الأستاذ غير صالح' });
        try { teacherAction(s, b); } catch (e) { return send(res, 400, { error: e.message }); }
        bump(s, b.action !== 'boardMiss');
        return send(res, 200, { ok: true, v: s.v });
      }
      return send(res, 404, { error: 'غير موجود' });
    }
    if (req.method === 'GET' && /^\/[\w.-]+$/.test(p)) return serveFile(res, p.slice(1));
    send(res, 404, { error: 'غير موجود' });
  } catch (e) {
    send(res, 500, { error: 'خطأ في الخادم' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  تحدّي مصطلحات التاريخ | BEN CENTRE`);
  console.log(`  على هذا الحاسوب:  http://localhost:${PORT}`);
  for (const l of lanUrls()) console.log(`  على شبكة القسم:   ${l}`);
  if (PUBLIC_URL) console.log(`  الرابط العام:      ${PUBLIC_URL}`);
  console.log('');
});
