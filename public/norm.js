// تطبيع النص العربي والتصحيح الآلي المقترح — يُستعمل في الخادم وفي المتصفح
(function (root) {
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/).filter(Boolean)
      .map(w => (w.length > 4 && /^(وال|بال|فال|كال|لل)/.test(w)) ? w.slice(w.startsWith('لل') ? 2 : 3) : w)
      .map(w => (w.length > 3 && w.startsWith('ال')) ? w.slice(2) : w)
      .join(' ');
  }
  const STOP = new Set(['في', 'من', 'الى', 'على', 'عن', 'مع', 'او', 'ثم', 'بين', 'دول', 'سنه']);
  function tokens(s) { return norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t)); }
  function tokMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4) return a.includes(b) || b.includes(a) || a.slice(0, 4) === b.slice(0, 4);
    return false;
  }
  function hasPhrase(answerToks, phrase) {
    const pt = tokens(phrase);
    if (!pt.length) { const n = norm(phrase); return n ? answerToks.join(' ').includes(n) : false; }
    const hit = pt.filter(p => answerToks.some(a => tokMatch(a, p))).length;
    return hit >= Math.max(1, Math.ceil(pt.length / 2));
  }
  function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
  function autoFill(accept, value) {
    const v = norm(value); if (!v) return false;
    return (accept || []).some(a => { const n = norm(a); return n && (v === n || (' ' + v + ' ').includes(' ' + n + ' ')); });
  }
  function keywordHits(term, value) {
    const at = norm(value).split(' ').filter(Boolean);
    return (term.keywords || []).filter(k => hasPhrase(at, k));
  }
  // تعريف من الذاكرة: نصف العناصر الأساسية على الأقل + 4 كلمات
  function autoDef(term, value) {
    const k = (term.keywords || []).length;
    return wordCount(value) >= 4 && keywordHits(term, value).length >= Math.max(1, Math.ceil(k / 2));
  }
  // توظيف المصطلح في سياقه: ذكر المصطلح + جملة من 7 كلمات على الأقل + عنصر سياقي (عنصر أساسي أو سنة)
  function autoUse(term, value) {
    const at = norm(value).split(' ').filter(Boolean);
    const named = hasPhrase(at, term.name);
    const ctx = keywordHits(term, value).length > 0 || /\d{4}/.test(norm(value));
    return named && ctx && wordCount(value) >= 7;
  }
  const api = { norm, autoFill, autoDef, autoUse, keywordHits, wordCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BCNorm = api;
})(typeof window !== 'undefined' ? window : globalThis);
