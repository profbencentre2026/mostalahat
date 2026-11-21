// واجهة الأستاذ: السبورة التفاعلية (16:9) + لوحة الأستاذ
(function () {
  const { h, api, live, throttle, store, shuffle, toast, LETTERS } = BC;
  const CODE = location.pathname.split('/')[2].toUpperCase();
  const qs = new URLSearchParams(location.search);
  if (qs.get('k')) { store.set('bc_t_' + CODE, qs.get('k')); history.replaceState(null, '', location.pathname + location.hash); }
  const KEY = store.get('bc_t_' + CODE);
  const $ = id => document.getElementById(id);
  const STAGES = [
    { n: 1, t: 'اكتشف وتذكّر', m: 8 }, { n: 2, t: 'طابق على السبورة', m: 8 },
    { n: 3, t: 'أجب من هاتفك', m: 14 }, { n: 4, t: 'اختبار الخروج', m: 10 }
  ];
  const TYPE = { mcq: 'اختيار المصطلح المناسب', fill: 'إكمال كلمة مفتاحية', open: 'تعريف من الذاكرة' };
  const KIND = { def: 'تعريف ← مصطلح', situation: 'وضعية تاريخية', discriminate: 'تمييز' };

  let S = null, info = { lan: [], publicUrl: '' }, online = true, lastStage = null;
  const ui = {
    mode: location.hash === '#panel' ? 'panel' : 'board',
    s1: { idx: 0, hidden: false, ex: false, seen: new Set([0]), picked: '' },
    s2: { tab: 'match', round: 0, sortIdx: 0, game: null, sel: null, hint: '' },
    preview: null, qrBig: false, panelTab: 'live', panelQ: null,
    timer: { stage: 1, left: 8 * 60, endAt: 0, running: false }
  };

  if (!KEY) {
    document.body.innerHTML = '';
    document.body.append(h('div', { class: 'landing' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'BEN', h('b', {}, 'CENTRE'))),
      h('h1', {}, 'مفتاح الأستاذ غير موجود على هذا الجهاز'),
      h('p', { class: 'muted center' }, 'افتح الجلسة من الجهاز الذي أنشأها، أو استعمل رابط «فتح اللوحة على جهاز آخر» من لوحة الأستاذ.'),
      h('a', { href: '/', class: 'chip', style: 'color:#fff;text-decoration:none' }, 'إنشاء جلسة جديدة')));
    return;
  }

  // ---------- الاتصال ----------
  const act = async (action, extra = {}) => {
    try { await api(`/api/s/${CODE}/teacher`, { key: KEY, action, ...extra }); await load(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  async function load() {
    try {
      const v = await api(`/api/s/${CODE}?key=${encodeURIComponent(KEY)}`);
      if (!v.students) throw new Error('مفتاح الأستاذ غير صالح');
      S = v; onState();
    } catch (e) { toast(e.message, 'bad'); }
  }
  const refresh = throttle(load, 400);
  api('/api/info').then(r => { info = r; renderHeader(); if (S && (S.stage >= 3)) renderMain(); }).catch(() => {});
  live(`/api/s/${CODE}/events?key=${encodeURIComponent(KEY)}`, refresh, ok => { online = ok; renderHeader(); });

  function joinBase() {
    if (info.publicUrl) return info.publicUrl;
    if (/^(localhost|127\.|\[::1\])/.test(location.hostname) && info.lan && info.lan.length) return info.lan[0];
    return location.origin;
  }
  const joinUrl = () => joinBase() + '/j/' + CODE;
  const panelUrl = () => joinBase() + '/t/' + CODE + '?k=' + encodeURIComponent(KEY) + '#panel';
  const qrSvg = url => { try { return BCQR.svg(url); } catch { return ''; } };

  const term = id => S.terms.find(t => t.id === id);
  const studentsN = () => Object.keys(S.students).length;
  const qById = id => S.questions.find(q => q.id === id);

  function onState() {
    if (ui.timer.stage !== S.stage && !ui.timer.running) setTimerStage(S.stage);
    if (ui.mode === 'panel') { renderPanel(); return; }
    renderHeader(); renderFooter();
    const stageChanged = lastStage !== S.stage; lastStage = S.stage;
    if (stageChanged || S.stage >= 3 || ui.qrBig) renderMain();
  }

  // ---------- المؤقت ----------
  function setTimerStage(n) { const st = STAGES[n - 1]; ui.timer = { stage: n, left: st.m * 60, endAt: 0, running: false }; }
  const timerLeft = () => ui.timer.running ? Math.max(0, Math.round((ui.timer.endAt - Date.now()) / 1000)) : ui.timer.left;
  const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  function toggleTimer() {
    if (ui.timer.running) { ui.timer.left = timerLeft(); ui.timer.running = false; }
    else { ui.timer.endAt = Date.now() + ui.timer.left * 1000; ui.timer.running = true; }
    renderHeader();
  }
  setInterval(() => {
    const el = $('timer'); if (!el) return;
    const l = timerLeft(); el.textContent = (ui.timer.running ? '⏱ ' : '▶ ') + fmt(l);
    el.classList.toggle('low', l <= 60);
    if (ui.timer.running && l === 0) { ui.timer.running = false; ui.timer.left = 0; toast('انتهى وقت المرحلة', 'bad'); }
  }, 500);

  // ---------- رأس السبورة وتذييلها ----------
  function renderHeader() {
    const hd = $('bhead'); if (!hd || !S) return;
    const st = STAGES[S.stage - 1];
    hd.replaceChildren(
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'BEN', h('b', {}, 'CENTRE'))),
      h('div', { class: 'title' }, 'تحدّي مصطلحات التاريخ'),
      h('div', { class: 'sp' }),
      h('div', { class: 'pill' }, h('span', { class: 'dot' + (online ? ' on' : '') }), 'المرحلة ' + st.n + ' · ' + st.t),
      h('div', { class: 'pill', title: 'التلاميذ المنضمون / المتصلون الآن' }, '👥 ' + studentsN() + ' منضم · ' + (S.online || 0) + ' متصل'),
      h('div', { class: 'pill code', title: 'رمز الجلسة' }, CODE),
      h('button', { class: 'pill timer', id: 'timer', onclick: toggleTimer, title: 'تشغيل / إيقاف المؤقت' }, (ui.timer.running ? '⏱ ' : '▶ ') + fmt(timerLeft())),
      h('button', { onclick: () => { setTimerStage(S.stage); renderHeader(); }, title: 'إعادة المؤقت' }, '↺'),
      h('button', { onclick: () => { ui.qrBig = !ui.qrBig; renderMain(); } }, ui.qrBig ? 'إخفاء QR' : 'QR'),
      h('button', { onclick: () => setMode('panel') }, 'لوحة الأستاذ'),
      h('button', { onclick: () => { const d = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen()).catch(() => {}); } }, '⛶')
    );
  }
  function renderFooter() {
    $('bfoot').replaceChildren(...STAGES.map(st => h('button', { class: 'stg' + (S.stage === st.n ? ' on' : ''), onclick: () => { if (S.stage !== st.n) { setTimerStage(st.n); act('stage', { stage: st.n }); } } },
      st.n + '. ' + st.t, h('small', {}, st.m + ' دقائق'))));
  }

  function setMode(m) {
    ui.mode = m; history.replaceState(null, '', location.pathname + (m === 'panel' ? '#panel' : ''));
    $('boardView').hidden = m !== 'board'; $('panelView').hidden = m !== 'panel';
    lastStage = null; if (S) onState();
  }

  // ---------- المنطقة الرئيسية ----------
  function renderMain() {
    if (!S) return;
    const m = $('bmain');
    let node;
    if (ui.qrBig) node = qrPanel(true);
    else if (S.stage === 1) node = stage1();
    else if (S.stage === 2) node = stage2();
    else if (S.stage === 3) node = stage3();
    else node = stage4();
    m.replaceChildren(node);
  }

  function qrPanel(closable) {
    const url = joinUrl();
    return h('div', { class: 'qr-panel' },
      h('div', { class: 'qr', html: qrSvg(url) }),
      h('div', { class: 'info' },
        h('div', { style: 'font-size:2.6cqw;font-weight:900' }, 'امسح الرمز للانضمام'),
        h('div', {}, 'أو افتح الرابط واكتب الرمز:'),
        h('div', { class: 'url' }, joinBase().replace(/^https?:\/\//, '')),
        h('div', { class: 'code' }, CODE),
        h('div', { class: 'muted', style: 'font-size:1.6cqw' }, 'شارك باسم مستعار، دون حساب. المنضمون: ' + studentsN()),
        closable ? h('button', { class: 'bbtn btn-red', style: 'margin-top:1cqw', onclick: () => { ui.qrBig = false; renderMain(); } }, 'متابعة') : null));
  }
  const miniQr = () => h('div', { class: 'qmini', title: 'تكبير رمز QR', html: qrSvg(joinUrl()), onclick: () => { ui.qrBig = true; renderMain(); } });

  // ===== المرحلة 1: اكتشف وتذكّر =====
  function stage1() {
    const s = ui.s1, n = S.terms.length; if (!n) return h('div', {}, 'لا توجد مصطلحات.');
    s.idx = Math.min(s.idx, n - 1);
    const t = S.terms[s.idx];
    const go = d => { s.idx = (s.idx + d + n) % n; s.hidden = false; s.ex = false; s.picked = ''; s.seen.add(s.idx); renderMain(); };
    const toggle = () => { s.hidden = !s.hidden; renderMain(); };
    ui.keys = e => {
      if (e.target.closest('input,textarea')) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowLeft') go(1); if (e.key === 'ArrowRight') go(-1);
    };
    const pseudos = Object.values(S.students).map(x => x.pseudo);
    return h('div', { class: 's1' },
      h('div', { style: 'display:flex;flex-direction:column;min-height:0' },
        h('div', { class: 'term' }, t.name),
        h('div', { class: 'kw' }, h('span', { class: 'muted' }, 'الكلمات المفتاحية: '), t.keywords.map(k => h('span', { class: 'chip red' }, k))),
        s.hidden ? h('div', { class: 'def hidden', onclick: toggle }, '🙈 التعريف مخفي — اشرح المصطلح شفهيًا') : h('div', { class: 'def', onclick: toggle }, t.def),
        s.ex ? h('div', { class: 'ex' }, h('b', {}, 'مثال: '), t.example) : h('div', { class: 'ex' }, h('b', {}, 'سؤال الاستدعاء: '), t.recall),
        h('div', { class: 'nav', style: 'margin-top:auto;padding-top:1cqw' },
          h('button', { class: 'bbtn', onclick: () => go(-1) }, '→ السابق'),
          h('div', { class: 'count' }, (s.idx + 1) + ' / ' + n),
          h('button', { class: 'bbtn', onclick: () => go(1) }, 'التالي ←'),
          h('div', { class: 'dots', style: 'margin-inline-start:1cqw' }, S.terms.map((_, i) => h('i', { class: i === s.idx ? 'on' : (s.seen.has(i) ? 'seen' : ''), onclick: () => { s.idx = i; s.hidden = false; s.ex = false; s.seen.add(i); renderMain(); } }))))),
      h('div', { class: 'side' },
        h('button', { class: 'bbtn big ' + (s.hidden ? 'btn-white' : 'btn-red'), onclick: toggle }, s.hidden ? '👁 كشف التعريف للمقارنة' : '🙈 إخفاء التعريف'),
        h('button', { class: 'bbtn', onclick: () => { s.ex = !s.ex; renderMain(); } }, s.ex ? 'إظهار سؤال الاستدعاء' : 'إظهار مثال تاريخي'),
        h('div', { class: 'box' },
          h('div', { style: 'font-weight:800;margin-bottom:.6cqw' }, 'من يشرح؟'),
          h('div', { class: 'picked' }, s.picked || '—'),
          h('button', { class: 'bbtn', style: 'width:100%', onclick: () => { s.picked = pseudos.length ? pseudos[Math.floor(Math.random() * pseudos.length)] : 'لا يوجد تلاميذ منضمون'; renderMain(); } }, '🎲 اختيار تلميذ عشوائيًا')),
        h('div', { class: 'box muted', style: 'font-size:1.3cqw' }, 'لمسة على التعريف تخفيه أو تكشفه. لوحة المفاتيح: المسافة = إخفاء/كشف، الأسهم = تنقل.')));
  }

  // ===== المرحلة 2: طابق على السبورة =====
  function stage2() {
    const s = ui.s2;
    ui.keys = null;
    const tabs = h('div', { class: 'tabs' },
      [['match', 'مطابقة المصطلحات بتعاريفها'], ['ctx', 'المصطلح في سياقه التاريخي'], ['sort', 'ميّز بين المتشابهات']].map(([k, l]) =>
        h('button', { class: s.tab === k ? 'on' : '', onclick: () => { s.tab = k; s.game = null; s.hint = ''; s.sel = null; renderMain(); } }, l)),
      h('div', { style: 'flex:1' }));
    if (!s.game) s.game = newGame();
    const g = s.game;
    if (g.rounds > 1) tabs.append(...Array.from({ length: g.rounds }, (_, i) => h('button', { class: s.round === i ? 'on' : '', onclick: () => { s.round = i; s.game = null; s.hint = ''; renderMain(); } }, 'جولة ' + (i + 1))));
    if (s.tab === 'sort') tabs.append(...S.sorts.map((d, i) => h('button', { class: s.sortIdx === i ? 'on' : '', onclick: () => { s.sortIdx = i; s.game = null; s.hint = ''; renderMain(); } }, i === 0 ? 'الوفاق / التحالف' : 'الحلفاء / المحور')));
    tabs.append(h('button', { onclick: () => { s.game = null; s.hint = ''; s.sel = null; renderMain(); } }, '↺ خلط'));
    const body = s.tab === 'sort' ? sortBoard(g) : pairBoard(g);
    const done = g.sources.every(x => g.solved[x.id]);
    return h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, tabs, body,
      h('div', { class: 'hintbar' + (s.hint ? '' : ' empty') }, s.hint || (done ? '🎉 أحسنتم! انتقلوا إلى الجولة التالية.' : 'انقر مصطلحًا ثم انقر مكانه، أو اسحبه وأفلته.')));
  }
  function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  function splitYear(sit) { const m = String(sit || '').match(/^([^:]{2,16}):\s*(.*)$/s); return m ? [m[1], m[2]] : ['', sit]; }
  function newGame() {
    const s = ui.s2;
    if (s.tab === 'sort') {
      const d = S.sorts[s.sortIdx] || S.sorts[0];
      const items = d.items.map((it, i) => ({ id: 'i' + i, label: it.label, target: it.bin, hint: it.hint }));
      const binTerm = b => S.terms.find(t => t.name === b.label);
      return { kind: 'sort', d, rounds: 1, sources: shuffle(items), targets: d.bins.map(b => ({ id: b.id, label: b.label, hint: (binTerm(b) || {}).hint, termId: (binTerm(b) || {}).id })), solved: {}, tries: {} };
    }
    const pool = s.tab === 'match' ? S.terms : S.terms.filter(t => t.situation);
    const rounds = chunk(s.tab === 'ctx' ? pool.slice().sort((a, b) => a.year - b.year).reduce((acc, t, i) => { acc[i % 3].push(t); return acc; }, [[], [], []]).flat() : pool, 5);
    s.round = Math.min(s.round, rounds.length - 1);
    const set = rounds[s.round] || [];
    const sources = shuffle(set.map(t => ({ id: t.id, label: t.name, target: t.id, hint: t.hint })));
    const targets = s.tab === 'match'
      ? shuffle(set.map(t => ({ id: t.id, label: t.def })))
      : set.slice().sort((a, b) => a.year - b.year).map(t => { const [yr, txt] = splitYear(t.situation); return { id: t.id, label: txt, yr }; });
    return { kind: s.tab, rounds: rounds.length, sources, targets, solved: {}, tries: {} };
  }
  function attempt(srcId, tgtId) {
    const s = ui.s2, g = s.game;
    const src = g.sources.find(x => x.id === srcId); if (!src || g.solved[srcId]) return;
    s.sel = null;
    if (src.target === tgtId) {
      g.solved[srcId] = g.kind === 'sort' ? tgtId : 'ok';
      s.hint = g.tries[srcId] ? '✓ صحيح في المحاولة الثانية!' : '✓ صحيح!';
    } else {
      g.tries[srcId] = (g.tries[srcId] || 0) + 1;
      const tel = document.querySelector(`[data-tgt="${tgtId}"]`); if (tel) { tel.classList.remove('shake'); void tel.offsetWidth; tel.classList.add('shake'); }
      const termId = g.kind === 'sort' ? (g.targets.find(t => t.id === src.target) || {}).termId : src.id;
      if (g.tries[srcId] >= 2) {
        g.solved[srcId] = g.kind === 'sort' ? src.target : 'rev';
        if (termId) act('boardMiss', { termId });
        const right = g.targets.find(t => t.id === src.target);
        s.hint = '✗ الجواب الصحيح: «' + src.label + '» ← ' + (g.kind === 'sort' ? right.label : 'مكانه مظلل بالأصفر');
      } else {
        const tip = src.hint || (g.kind === 'sort' ? (g.targets.find(t => t.id === src.target) || {}).hint : '') || 'راجع الكلمات المفتاحية.';
        s.hint = '💡 تلميح: ' + tip + ' — حاول مرة ثانية.';
      }
    }
    renderMain();
  }
  function bindDrag(el, srcId) {
    let sx, sy, ghost = null, over = null;
    el.addEventListener('pointerdown', e => {
      if (ui.s2.game.solved[srcId]) return;
      sx = e.clientX; sy = e.clientY; el.setPointerCapture(e.pointerId);
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
          ghost = el.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = el.offsetWidth + 'px'; document.body.append(ghost);
        }
        if (ghost) {
          ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
          const t = document.elementFromPoint(ev.clientX, ev.clientY); const tg = t && t.closest('[data-tgt]');
          if (over && over !== tg) over.classList.remove('over'); over = tg; if (tg) tg.classList.add('over');
        }
      };
      const up = ev => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (ghost) { ghost.remove(); ghost = null; if (over) { over.classList.remove('over'); attempt(srcId, over.dataset.tgt); over = null; } }
        else { ui.s2.sel = ui.s2.sel === srcId ? null : srcId; renderMain(); }
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  const tgtClick = id => () => { if (ui.s2.sel) attempt(ui.s2.sel, id); else ui.s2.hint = 'اختر مصطلحًا أولًا.', renderMain(); };
  function pairBoard(g) {
    const srcs = g.sources.map(x => { const el = h('div', { class: 'src' + (g.solved[x.id] ? ' done' : '') + (ui.s2.sel === x.id ? ' sel' : '') }, x.label); bindDrag(el, x.id); return el; });
    const tgts = g.targets.map(t => {
      const solvedBy = g.sources.find(x => x.target === t.id && g.solved[x.id]);
      const st = solvedBy ? (g.solved[solvedBy.id] === 'rev' ? ' reveal' : ' ok') : '';
      return h('div', { class: 'tgt' + st, 'data-tgt': t.id, onclick: tgtClick(t.id) },
        t.yr ? h('span', { class: 'yr' }, t.yr) : null, h('span', {}, t.label),
        solvedBy ? h('span', { class: 'tag' }, solvedBy.label) : null);
    });
    return h('div', { class: 'match' }, h('div', { class: 'col' }, h('div', { class: 'note' }, g.kind === 'ctx' ? 'المصطلحات' : 'المصطلحات'), srcs),
      h('div', { class: 'col', style: 'overflow:auto' }, h('div', { class: 'note' }, g.kind === 'ctx' ? 'خط زمني: ضع كل مصطلح في سياقه التاريخي' : 'التعاريف'), tgts));
  }
  function sortBoard(g) {
    const pool = g.sources.filter(x => !g.solved[x.id]).map(x => { const el = h('div', { class: 'src' + (ui.s2.sel === x.id ? ' sel' : '') }, x.label); bindDrag(el, x.id); return el; });
    return h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
      h('div', { class: 'note' }, g.d.title + ' — ' + g.d.note),
      h('div', { class: 'pool' }, pool.length ? pool : h('div', { class: 'muted', style: 'font-size:1.6cqw' }, 'اكتمل التصنيف ✓')),
      h('div', { class: 'sort' }, g.targets.map(b => h('div', { class: 'bin', 'data-tgt': b.id, onclick: tgtClick(b.id) }, h('h3', {}, b.label),
        h('div', { class: 'in' }, g.sources.filter(x => g.solved[x.id] === b.id).map(x => h('span', { class: g.tries[x.id] >= 2 ? 'rev' : '' }, x.label)))))));
  }

  // ===== المرحلة 3: أجب من هاتفك =====
  function answersOf(qid) { return Object.values(S.answers[qid] || {}); }
  function stage3() {
    ui.keys = null;
    const cur = S.current.qid ? qById(S.current.qid) : null;
    const shownId = ui.preview || (cur && cur.id);
    const q = shownId ? qById(shownId) : null;
    const isLive = q && cur && q.id === cur.id && S.current.status !== 'idle';
    const status = isLive ? S.current.status : 'preview';
    const nextQ = () => S.questions.find(x => x.id !== (cur && cur.id) && !S.asked.includes(x.id));
    const qlist = h('div', { class: 'qlist' }, S.questions.map((x, i) => h('button', {
      class: (x.id === shownId ? 'on' : '') + (S.asked.includes(x.id) || (cur && cur.id === x.id && S.current.status === 'revealed') ? ' done' : ''),
      title: x.prompt.slice(0, 80), onclick: () => { ui.preview = x.id === (cur && cur.id) ? null : x.id; renderMain(); }
    }, String(i + 1))));
    if (!q) {
      return h('div', { style: 'display:flex;flex-direction:column;height:100%' }, qrPanel(false),
        h('div', { class: 'row', style: 'justify-content:center;gap:1cqw' }, h('button', { class: 'bbtn big btn-red', onclick: () => { const n = nextQ(); if (n) { ui.preview = null; act('open', { qid: n.id }); } } }, 'فتح السؤال الأول على الهواتف')), qlist);
    }
    const list = isLive ? answersOf(q.id) : [];
    const n = list.length, total = studentsN();
    const revealed = status === 'revealed';
    let content;
    if (q.type === 'mcq') {
      const counts = q.options.map((_, i) => list.filter(a => Number(a.value) === i).length);
      content = h('div', { class: 'opts' }, q.options.map((o, i) => {
        const pct = n ? Math.round(counts[i] * 100 / n) : 0;
        return h('div', { class: 'opt' + (revealed && i === q.answer ? ' correct' : '') },
          revealed ? h('div', { class: 'bar', style: `width:${pct}%` }) : null,
          h('span', { class: 'L' }, LETTERS[i]), h('span', {}, o),
          revealed ? h('span', { class: 'pct' }, pct + '%') : null);
      }));
    } else content = h('div', { class: 'muted', style: 'font-size:2cqw' }, q.type === 'fill' ? 'يكتب التلاميذ الكلمة الناقصة على هواتفهم.' : 'يكتب التلاميذ تعريفًا قصيرًا من الذاكرة على هواتفهم.');
    let model = null;
    if (revealed) {
      const t = term(q.termId) || {};
      const ok = list.filter(a => a.eff).length;
      model = h('div', { class: 'model' },
        h('div', {}, h('span', { class: 'big' }, (n ? Math.round(ok * 100 / n) : 0) + '%'), ' إجابات صحيحة', q.type !== 'mcq' ? h('span', { class: 'muted', style: 'font-size:1.4cqw' }, ' (بعد مراجعة الأستاذ للصياغات المكافئة)') : null),
        q.type === 'fill' ? h('div', {}, 'الكلمة المنتظرة: ', h('b', {}, (q.accept || [])[0] || '')) : null,
        h('div', {}, h('b', {}, (t.name || '') + ': '), t.def || ''),
        t.keywords ? h('div', {}, t.keywords.map(k => h('span', { class: 'chip red' }, k))) : null);
    }
    const ctrls = h('div', { class: 'ctrls' });
    if (!isLive) ctrls.append(h('button', { class: 'btn-red', onclick: () => { ui.preview = null; act('open', { qid: q.id }); } }, '▶ فتح السؤال على الهواتف'));
    else if (status === 'open') ctrls.append(h('button', { class: 'btn-white', onclick: () => act('close') }, '■ إغلاق السؤال'));
    else if (status === 'closed') ctrls.append(h('button', { class: 'btn-red', onclick: () => act('reveal') }, '✓ كشف التصحيح'), h('button', { onclick: () => act('reopen') }, 'إعادة فتح السؤال'));
    else if (status === 'revealed') { const nx = nextQ(); ctrls.append(nx ? h('button', { class: 'btn-red', onclick: () => act('open', { qid: nx.id }) }, 'السؤال التالي ←') : h('div', { class: 'muted center', style: 'font-size:1.5cqw' }, 'انتهت الأسئلة — انتقل إلى اختبار الخروج')); }
    if (isLive && q.type !== 'mcq' && status !== 'open') ctrls.append(h('button', { onclick: () => { ui.panelTab = 'live'; ui.panelQ = q.id; setMode('panel'); } }, 'مراجعة الصياغات (لوحة الأستاذ)'));
    const stLabel = { open: '🟢 السؤال مفتوح', closed: '🔒 السؤال مغلق', revealed: '✓ تم كشف التصحيح', preview: '👁 معاينة (غير منشور)' }[status];
    return h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' },
      h('div', { class: 'qwrap' + (revealed ? ' rev' : ''), style: 'flex:1;min-height:0' },
        h('div', { style: 'overflow:auto;min-height:0' },
          h('div', { class: 'qtype' }, 'سؤال ' + (S.questions.indexOf(q) + 1) + ' / ' + S.questions.length + ' · ' + TYPE[q.type] + (q.kind ? ' · ' + (KIND[q.kind] || '') : '')),
          h('div', { class: 'qprompt', style: revealed ? 'font-size:2.3cqw' : '' }, q.prompt), content, model),
        h('div', { class: 'side3' },
          h('div', { class: 'counter' }, h('div', { class: 'l' }, stLabel), h('div', { class: 'n' }, isLive ? n : '—'), h('div', { class: 'l' }, 'إجابة واردة من ' + total + ' تلميذ'),
            h('div', { class: 'prog' }, h('i', { style: `width:${total ? Math.min(100, n * 100 / total) : 0}%` }))),
          ctrls)),
      qlist, miniQr());
  }

  // ===== المرحلة 4: اختبار الخروج =====
  function termBars(onlyExit) {
    const rows = S.terms.map(t => { const p = S.stats.perTerm[t.id]; const ok = p ? (onlyExit ? p.exOk : p.ok) : 0, nn = p ? (onlyExit ? p.exN : p.n) : 0; return { t, ok, nn, pct: nn ? Math.round(ok * 100 / nn) : null }; })
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
    return h('div', { class: 'termbars' }, rows.map(r => h('div', { class: 'termbar' }, h('span', {}, r.t.name),
      h('div', { class: 'track' }, h('i', { class: r.pct != null && r.pct < 50 ? 'low' : '', style: `width:${r.pct || 0}%` })),
      h('b', {}, r.pct == null ? '—' : r.pct + '%'))));
  }
  function stage4() {
    ui.keys = null;
    const ex = S.exit, total = studentsN(), sub = Object.keys(ex.answers).length;
    const head = h('div', { style: 'font-size:3cqw;font-weight:900;margin-bottom:.6cqw' }, 'اختبار الخروج');
    if (ex.status === 'idle') return h('div', {}, head,
      h('div', { style: 'font-size:2.1cqw;line-height:1.8' }, 'يتلقى كل تلميذ على هاتفه ثلاثة بنود دون اختيارات:', h('br'), '① كتابة تعريف من الذاكرة  ② كتابة تعريف ثانٍ  ③ توظيف مصطلح ثالث في سياقه التاريخي.', h('br'),
        h('span', { class: 'muted' }, 'تُعطى الأولوية للمصطلحات التي أخطأ فيها التلميذ خلال الحصة، ثم لنقاط ضعف القسم.')),
      h('button', { class: 'bbtn big btn-red', style: 'margin-top:2cqw', onclick: () => act('exitStart') }, '▶ بدء اختبار الخروج'), miniQr());
    const counter = h('div', { class: 'counter', style: 'max-width:30cqw' }, h('div', { class: 'n' }, sub), h('div', { class: 'l' }, 'اختبار مُرسل من ' + total), h('div', { class: 'prog' }, h('i', { style: `width:${total ? sub * 100 / total : 0}%` })));
    const ctr = h('div', { class: 'ctrls', style: 'max-width:30cqw' });
    if (ex.status === 'open') ctr.append(h('button', { class: 'btn-white', onclick: () => act('exitClose') }, '■ إغلاق الاختبار'));
    if (ex.status === 'closed') ctr.append(h('button', { class: 'btn-red', onclick: () => act('exitPublish') }, '✓ نشر النتائج على الهواتف'), h('button', { onclick: () => { ui.panelTab = 'exit'; setMode('panel'); } }, 'مراجعة التصحيح (لوحة الأستاذ)'), h('button', { onclick: () => act('exitReopen') }, 'إعادة فتح'));
    if (ex.status === 'published') ctr.append(h('div', { class: 'muted', style: 'font-size:1.5cqw' }, 'نُشرت النتائج: يرى كل تلميذ قائمة مراجعته واختبار إعادة المحاولة.'), h('button', { onclick: () => { ui.panelTab = 'stats'; setMode('panel'); } }, 'الإحصاءات التفصيلية'));
    const left = ex.status === 'open'
      ? h('div', { style: 'font-size:2.2cqw;line-height:1.8' }, 'اكتب على هاتفك تعريفين دون اختيارات، ثم وظّف مصطلحًا ثالثًا في سياقه التاريخي.', h('br'), h('span', { class: 'muted' }, 'إرسال واحد فقط. لم تنضم بعد؟ امسح الرمز.'))
      : h('div', { style: 'display:flex;flex-direction:column;min-height:0;flex:1' }, h('div', { style: 'font-size:1.6cqw;font-weight:800;margin-bottom:.6cqw' }, 'نسبة الإجابات الصحيحة لكل مصطلح (الحصة كاملة)'), termBars(false));
    return h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' }, head,
      h('div', { class: 'qwrap', style: 'flex:1;min-height:0' }, left, h('div', { class: 'side3' }, counter, ctr)), ex.status === 'open' ? miniQr() : null);
  }

  document.addEventListener('keydown', e => { if (ui.mode === 'board' && ui.keys) ui.keys(e); });

  // ================= لوحة الأستاذ =================
  let editDraft = null;
  function renderPanel() {
    const P = $('panelView');
    const ae = document.activeElement;
    if (P.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { clearTimeout(renderPanel.t); renderPanel.t = setTimeout(renderPanel, 1500); return; }
    if (ui.panelTab === 'content' && P.querySelector('.editor')) return; // لا نعيد الرسم أثناء التحرير
    const tabs = [['live', 'الأسئلة والإجابات'], ['exit', 'تصحيح اختبار الخروج'], ['stats', 'النتائج والمراجعة'], ['students', 'التلاميذ والروابط'], ['content', 'المحتوى']];
    let body;
    if (ui.panelTab === 'live') body = panelLive();
    else if (ui.panelTab === 'exit') body = panelExit();
    else if (ui.panelTab === 'stats') body = panelStats();
    else if (ui.panelTab === 'students') body = panelStudents();
    else body = panelContent();
    P.replaceChildren(
      h('div', { class: 'phead' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'BEN', h('b', {}, 'CENTRE'))),
        h('b', {}, 'لوحة الأستاذ'), h('span', { class: 'chip', style: 'direction:ltr' }, CODE), h('span', { class: 'chip' }, h('span', { class: 'dot' + (online ? ' on' : '') }), 'المرحلة ' + S.stage),
        h('span', { class: 'chip' }, '👥 ' + studentsN()), h('div', { style: 'flex:1' }), h('button', { class: 'btn-red', onclick: () => setMode('board') }, 'العودة إلى السبورة')),
      h('div', { class: 'panel' }, h('div', { class: 'ptabs' }, tabs.map(([k, l]) => h('button', { class: ui.panelTab === k ? 'on' : '', onclick: () => { ui.panelTab = k; editDraft = null; $('panelView').replaceChildren(); renderPanel(); } }, l))), body));
  }
  const pseudo = sid => (S.students[sid] || {}).pseudo || '(غادر)';
  const verdictBtns = (cur, auto, set) => h('div', { class: 'acts' },
    h('button', { class: cur === true ? 'btn-ok' : '', onclick: () => set(true), title: 'قبول' }, '✓'),
    h('button', { class: cur === false ? 'btn-bad' : '', onclick: () => set(false), title: 'رفض' }, '✗'),
    h('button', { class: cur == null ? 'btn-white' : 'btn-line', onclick: () => set(null), title: 'الاقتراح الآلي' }, 'آلي ' + (auto ? '✓' : '✗')));

  function panelLive() {
    const qid = ui.panelQ || S.current.qid || (S.questions[0] || {}).id;
    const q = qById(qid);
    const sel = h('select', { onchange: e => { ui.panelQ = e.target.value; renderPanel(); } }, S.questions.map((x, i) => h('option', { value: x.id, selected: x.id === qid }, (i + 1) + '. ' + (x.id === S.current.qid ? '● ' : '') + x.prompt.replace(/\n/g, ' ').slice(0, 90))));
    if (!q) return h('div', { class: 'box' }, 'لا توجد أسئلة.');
    const isCur = q.id === S.current.qid;
    const ctr = h('div', { class: 'row' });
    if (!isCur || S.current.status === 'idle') ctr.append(h('button', { class: 'btn-red', onclick: () => act('open', { qid: q.id }) }, 'فتح هذا السؤال'));
    else {
      ctr.append(h('span', { class: 'chip' }, { open: 'مفتوح', closed: 'مغلق', revealed: 'تم كشف التصحيح' }[S.current.status]));
      if (S.current.status === 'open') ctr.append(h('button', { class: 'btn-white', onclick: () => act('close') }, 'إغلاق'));
      if (S.current.status === 'closed') ctr.append(h('button', { class: 'btn-red', onclick: () => act('reveal') }, 'كشف التصحيح'));
      if (S.current.status !== 'open') ctr.append(h('button', { onclick: () => act('reopen') }, 'إعادة فتح'));
    }
    const t = term(q.termId) || {};
    const ans = Object.entries(S.answers[q.id] || {}).sort((a, b) => a[1].at - b[1].at);
    return h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, sel, ctr,
      h('div', { class: 'box' }, h('div', { class: 'muted' }, TYPE[q.type]), h('div', { style: 'white-space:pre-line;font-weight:800;margin:6px 0' }, q.prompt),
        q.type === 'mcq' ? h('div', {}, q.options.map((o, i) => h('span', { class: 'chip' + (i === q.answer ? ' red' : '') }, LETTERS[i] + ' ' + o))) : null,
        q.type === 'fill' ? h('div', {}, 'المقبول: ', (q.accept || []).map(a => h('span', { class: 'chip red' }, a))) : null,
        h('div', { class: 'muted', style: 'margin-top:8px' }, h('b', {}, t.name + ': '), t.def, ' — العناصر: ', (t.keywords || []).join('، '))),
      h('div', { class: 'box' }, h('h3', {}, 'الإجابات الفردية (' + ans.length + ' / ' + studentsN() + ')'),
        ans.length ? ans.map(([sid, a]) => h('div', { class: 'ans' },
          h('div', { class: 'who' }, pseudo(sid), h('div', { class: a.eff ? 'tagok' : 'tagbad' }, a.eff ? 'صحيحة' : 'خاطئة', a.verdict != null ? ' (الأستاذ)' : ' (آلي)')),
          h('div', { class: 'txt' }, q.type === 'mcq' ? LETTERS[a.value] + ' — ' + q.options[a.value] : a.value,
            q.type === 'open' ? h('div', { class: 'muted', style: 'font-size:.85rem' }, 'عناصر مذكورة: ' + (BCNorm.keywordHits(t, a.value).join('، ') || 'لا شيء')) : null),
          q.type === 'mcq' ? null : verdictBtns(a.verdict, a.auto, v => act('verdict', { qid: q.id, sid, value: v }))))
          : h('div', { class: 'muted' }, 'لا توجد إجابات بعد.')));
  }

  function panelExit() {
    const ex = S.exit;
    if (ex.status === 'idle') return h('div', { class: 'box' }, 'لم يبدأ اختبار الخروج بعد. ', h('button', { class: 'btn-red', onclick: () => act('exitStart') }, 'بدء اختبار الخروج'));
    const ctr = h('div', { class: 'row' }, h('span', { class: 'chip' }, { open: 'مفتوح', closed: 'مغلق', published: 'منشور' }[ex.status]));
    if (ex.status === 'open') ctr.append(h('button', { class: 'btn-white', onclick: () => act('exitClose') }, 'إغلاق'));
    if (ex.status === 'closed') ctr.append(h('button', { class: 'btn-red', onclick: () => act('exitPublish') }, 'نشر النتائج'));
    if (ex.status !== 'open') ctr.append(h('button', { onclick: () => act('exitReopen') }, 'إعادة فتح'));
    ctr.append(h('span', { class: 'muted' }, 'الاقتراح الآلي يعتمد على العناصر الأساسية؛ صحّحه بنقرة قبل النشر.'));
    const sids = Object.keys(S.students);
    return h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, ctr,
      sids.map(sid => {
        const a = ex.answers[sid], items = ex.items[sid] || [], prompts = S.exitPrompts[sid] || [];
        return h('div', { class: 'box' }, h('h3', {}, pseudo(sid), ' ', a ? h('span', { class: 'tagok' }, '· أرسل') : h('span', { class: 'tagwarn' }, '· لم يرسل بعد')),
          items.map((it, i) => {
            const t = term(it.termId) || {};
            const cur = a ? a.verdict[i] : null, auto = a ? a.auto[i] : false, effv = a ? (cur ?? auto) : null;
            return h('div', { class: 'ans' },
              h('div', { class: 'who' }, (i + 1) + '. ' + (it.kind === 'use' ? 'توظيف' : 'تعريف'), a ? h('div', { class: effv ? 'tagok' : 'tagbad' }, effv ? 'مقبول' : 'غير مقبول') : null),
              h('div', { class: 'txt' }, h('div', { class: 'muted' }, prompts[i]), a ? h('div', { style: 'margin:4px 0' }, a.values[i] || '—') : null,
                h('details', {}, h('summary', { class: 'muted' }, 'التعريف النموذجي'), h('div', {}, t.def, ' — ', (t.keywords || []).join('، ')))),
              a ? verdictBtns(cur, auto, v => act('exitVerdict', { sid, i, value: v })) : null);
          }));
      }));
  }

  function panelStats() {
    const P = S.stats;
    const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '—';
    return h('div', { class: 'grid2' },
      h('div', { class: 'box', style: 'grid-column:1/-1' }, h('h3', {}, 'نسبة الإجابات الصحيحة لكل مصطلح'),
        h('table', {}, h('tr', {}, h('th', {}, 'المصطلح'), h('th', {}, 'المرحلة 3'), h('th', {}, 'اختبار الخروج'), h('th', {}, 'المجموع'), h('th', {}, 'أخطاء السبورة')),
          S.terms.map(t => { const p = P.perTerm[t.id] || { ok: 0, n: 0, s3ok: 0, s3n: 0, exOk: 0, exN: 0 };
            return h('tr', {}, h('td', {}, t.name), h('td', {}, pct(p.s3ok, p.s3n) + ' (' + p.s3n + ')'), h('td', {}, pct(p.exOk, p.exN) + ' (' + p.exN + ')'), h('td', {}, h('b', {}, pct(p.ok, p.n))), h('td', {}, S.classMiss[t.id] || 0)); }))),
      h('div', { class: 'box', style: 'grid-column:1/-1' }, h('h3', {}, 'قائمة المراجعة لكل تلميذ'),
        h('table', {}, h('tr', {}, h('th', {}, 'التلميذ'), h('th', {}, 'الصحيح'), h('th', {}, 'مصطلحات للمراجعة')),
          Object.values(S.students).map(st => { const p = P.perStudent[st.id] || { ok: 0, n: 0, wrong: {} };
            return h('tr', {}, h('td', {}, st.pseudo), h('td', {}, p.ok + ' / ' + p.n), h('td', {}, Object.keys(p.wrong).map(id => h('span', { class: 'chip' }, (term(id) || {}).name || id)))); }))),
      h('div', { class: 'box muted', style: 'grid-column:1/-1' }, 'تُحتسب الأسئلة بعد إغلاقها، واختبار الخروج بعد إغلاقه. يرى كل تلميذ قائمته واختبار إعادة المحاولة على هاتفه بعد نشر نتائج اختبار الخروج.'));
  }

  function panelStudents() {
    return h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('h3', {}, 'رابط انضمام التلاميذ'),
        h('div', { style: 'background:#fff;border-radius:12px;padding:8px;width:200px', html: qrSvg(joinUrl()) }),
        h('p', { style: 'direction:ltr;word-break:break-all;font-weight:800' }, joinUrl()),
        h('button', { onclick: () => navigator.clipboard.writeText(joinUrl()).then(() => toast('نُسخ الرابط', 'ok'), () => toast('تعذّر النسخ', 'bad')) }, 'نسخ الرابط'),
        info.lan && info.lan.length > 1 ? h('p', { class: 'muted' }, 'عناوين أخرى على الشبكة: ', info.lan.join(' · ')) : null),
      h('div', { class: 'box' }, h('h3', {}, 'فتح لوحة الأستاذ على جهاز آخر (هاتفك مثلًا)'),
        h('p', { class: 'muted' }, 'لا تعرض هذا الرمز على السبورة: يمنح التحكم في الجلسة.'),
        h('details', {}, h('summary', {}, 'إظهار رمز الأستاذ'), h('div', { style: 'background:#fff;border-radius:12px;padding:8px;width:200px;margin-top:8px', html: qrSvg(panelUrl()) }))),
      h('div', { class: 'box', style: 'grid-column:1/-1' }, h('h3', {}, 'التلاميذ المنضمون (' + studentsN() + ')'),
        h('table', {}, h('tr', {}, h('th', {}, 'الاسم المستعار'), h('th', {}, 'وقت الانضمام'), h('th', {}, '')),
          Object.values(S.students).map(st => h('tr', {}, h('td', {}, st.pseudo), h('td', {}, new Date(st.joinedAt).toLocaleTimeString('ar-MA')),
            h('td', {}, h('button', { class: 'btn-line', onclick: () => act('kick', { sid: st.id }) }, 'إزالة')))))));
  }

  // ---------- محرر المحتوى ----------
  function panelContent() {
    editDraft = editDraft || JSON.parse(JSON.stringify({ terms: S.terms, questions: S.questions }));
    const D = editDraft;
    const field = (obj, key, label, opts = {}) => {
      const isArr = Array.isArray(obj[key]);
      const el = h(opts.area ? 'textarea' : 'input', { type: opts.type || 'text', oninput: e => { obj[key] = isArr ? e.target.value.split(/[،,]\s*/).map(x => x.trim()).filter(Boolean) : (opts.type === 'number' ? Number(e.target.value) : e.target.value); } });
      el.value = isArr ? obj[key].join('، ') : (obj[key] ?? '');
      return h('div', {}, h('label', {}, label), el);
    };
    const saveBar = h('div', { class: 'row', style: 'position:sticky;top:70px;z-index:4;background:var(--black);padding:8px 0' },
      h('button', { class: 'btn-red', onclick: () => save(false) }, 'حفظ لهذه الجلسة'),
      h('button', { class: 'btn-white', onclick: () => save(true) }, 'حفظ كمحتوى افتراضي للجلسات القادمة'),
      h('button', { class: 'btn-line', onclick: () => { if (confirmBox('استرجاع المحتوى الأصلي؟ ستضيع التعديلات.')) { act('resetContent').then(() => { editDraft = null; $('panelView').replaceChildren(); renderPanel(); }); } } }, 'استرجاع المحتوى الأصلي'));
    async function save(asDefault) {
      try { await api(`/api/s/${CODE}/teacher`, { key: KEY, action: 'content', terms: D.terms, questions: D.questions, asDefault }); toast('تم الحفظ ✓', 'ok'); editDraft = null; await load(); $('panelView').replaceChildren(); renderPanel(); }
      catch (e) { toast(e.message, 'bad'); }
    }
    const termOpts = sel => D.terms.map(t => h('option', { value: t.id, selected: t.id === sel }, t.name));
    const termsBox = h('div', { class: 'box' }, h('h3', {}, 'المصطلحات (' + D.terms.length + ')'),
      D.terms.map((t, i) => h('details', { class: 'term' }, h('summary', { style: 'font-weight:800;cursor:pointer' }, (i + 1) + '. ' + t.name),
        h('div', { class: 'editor', style: 'display:grid;gap:8px;margin-top:8px' },
          field(t, 'name', 'المصطلح'), field(t, 'def', 'التعريف المدرسي', { area: true }), field(t, 'keywords', 'العناصر الأساسية (افصل بفاصلة)'),
          field(t, 'example', 'مثال يوضح السياق', { area: true }), field(t, 'recall', 'سؤال الاستدعاء'), field(t, 'situation', 'وضعية تاريخية (ابدأ بالسنة ثم «:»)', { area: true }),
          field(t, 'hint', 'تلميح عند الخطأ'), field(t, 'year', 'سنة تقريبية (لترتيب الخط الزمني)', { type: 'number' })))));
    const qBox = h('div', { class: 'box' }, h('h3', {}, 'أسئلة المرحلة 3 (' + D.questions.length + ')'),
      D.questions.map((q, i) => {
        const wrap = h('div', { class: 'editor', style: 'display:grid;gap:8px;margin-top:8px' });
        const typeSel = h('select', { onchange: e => { q.type = e.target.value; if (q.type === 'mcq' && !q.options) { q.options = ['', '']; q.answer = 0; } if (q.type === 'fill' && !q.accept) q.accept = []; rebuild(); } },
          [['mcq', TYPE.mcq], ['fill', TYPE.fill], ['open', TYPE.open]].map(([v, l]) => h('option', { value: v, selected: q.type === v }, l)));
        const tSel = h('select', { onchange: e => { q.termId = e.target.value; } }, termOpts(q.termId));
        function rebuild() {
          wrap.replaceChildren(h('div', { class: 'row' }, h('div', { style: 'flex:1' }, h('label', {}, 'النوع'), typeSel), h('div', { style: 'flex:2' }, h('label', {}, 'المصطلح المستهدف (للإحصاءات)'), tSel)),
            field(q, 'prompt', 'نص السؤال', { area: true }),
            q.type === 'mcq' ? field(q, 'options', 'الاختيارات (افصل بفاصلة)') : null,
            q.type === 'mcq' ? field(q, 'answer', 'رقم الاختيار الصحيح (يبدأ من 0)', { type: 'number' }) : null,
            q.type === 'fill' ? field(q, 'accept', 'الإجابات المقبولة (افصل بفاصلة)') : null,
            h('div', { class: 'row' }, h('button', { class: 'btn-line', onclick: () => { D.questions.splice(i, 1); $('panelView').replaceChildren(); renderPanel(); } }, 'حذف السؤال'),
              i > 0 ? h('button', { class: 'btn-line', onclick: () => { [D.questions[i - 1], D.questions[i]] = [D.questions[i], D.questions[i - 1]]; $('panelView').replaceChildren(); renderPanel(); } }, '↑ تقديم') : null));
        }
        rebuild();
        return h('details', { class: 'term' }, h('summary', { style: 'font-weight:800;cursor:pointer' }, (i + 1) + '. [' + TYPE[q.type] + '] ' + q.prompt.replace(/\n/g, ' ').slice(0, 80)), wrap);
      }),
      h('button', { onclick: () => { D.questions.push({ id: 'q' + Date.now(), type: 'mcq', termId: D.terms[0] && D.terms[0].id, prompt: 'سؤال جديد', options: ['', ''], answer: 0 }); $('panelView').replaceChildren(); renderPanel(); } }, '+ إضافة سؤال'));
    return h('div', { class: 'editor', style: 'display:flex;flex-direction:column;gap:14px' }, saveBar,
      h('p', { class: 'muted', style: 'margin:0' }, 'ملاحظة: في الاختيارات والعناصر الأساسية افصل بين العناصر بفاصلة (، أو ,).'), termsBox, qBox);
  }
  function confirmBox(msg) { return window.confirm ? window.confirm(msg) : true; }

  // البدء
  setMode(ui.mode);
  load();
})();
