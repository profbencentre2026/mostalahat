// أدوات مشتركة
(function () {
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  async function api(url, data) {
    const r = await fetch(url, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : { cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || 'تعذّر الاتصال بالخادم'); e.status = r.status; throw e; }
    return j;
  }
  // اتصال مباشر مع إعادة الاتصال التلقائية + استطلاع احتياطي
  function live(url, onUpdate, onStatus) {
    let es, lastMsg = 0, timer, poll;
    const connect = () => {
      try { es && es.close(); } catch {}
      es = new EventSource(url);
      es.addEventListener('update', () => { lastMsg = Date.now(); onStatus && onStatus(true); onUpdate(); });
      es.onopen = () => { lastMsg = Date.now(); onStatus && onStatus(true); };
      es.onerror = () => { onStatus && onStatus(false); };
    };
    connect();
    poll = setInterval(() => {
      if (!es || es.readyState !== 1) { onUpdate(); }
      if (es && es.readyState === 2) connect();
    }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { onUpdate(); if (!es || es.readyState === 2) connect(); } });
    return { close() { clearInterval(poll); clearTimeout(timer); es && es.close(); } };
  }
  function throttle(fn, ms) {
    let t = null, pending = false;
    return function run() {
      if (t) { pending = true; return; }
      fn(); t = setTimeout(() => { t = null; if (pending) { pending = false; run(); } }, ms);
    };
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function toast(msg, kind = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + kind }, msg); box.append(t);
    setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
  }
  const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
  window.BC = { h, api, live, throttle, store, shuffle, toast, LETTERS };
})();
