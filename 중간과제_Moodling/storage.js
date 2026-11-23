/* storage.js — 감정 기록 저장 · 월별 보관 · 불러오기 · 삭제
 *
 * 기록(record) 하나의 구조
 * {
 *   id, createdAt,
 *   emotion,                 // 'anxious' | 'sad' | 'stuffy' | 'regret' | 'burden' | 'lonely' | 'unsure'
 *   cause,                   // 감정의 원인 텍스트
 *   mobile,                  // 'soon'(곧) | 'later'(조만간) | 'someday'(언젠간)
 *   shape, color, size, rot, // 메인 오브제의 랜덤 시각 속성 (shape: 0~5)
 *   comfort: { id, mainId, text } | null   // 나에게 건넨 말 → mainId로 메인 오브제와 연결
 * }
 *
 * 월별 보관: 기록은 지우지 않고 createdAt의 '연-월'(예: 2026-10)로 나눠서 보여줘.
 * 달이 바뀌면 이번 달 모빌은 새로 시작되고, 지난 달 모빌은 '지난 기록'에 그대로 남아.
 * 각 달의 아이콘은 모빌 오브제 중 하나가 랜덤으로 정해져서 계속 유지돼.
 *
 * 저장 위치: 이 기기 브라우저의 localStorage (서버로 전송되지 않아요)
 */
const Store = (() => {
  const KEY = 'moodling.v2';
  const IKEY = 'moodling.icons.v1';     // { '2026-10': { shape, color, rot } }

  // 사진 속 모빌에서 가져온 15색 (오브제 색). 웹앱 배경·UI 색과는 별개야.
  const PALETTE = ['#D9826F', '#3B4F94', '#7FC4E4', '#DDA8DC', '#B2CC93', '#C8302A', '#D4892A', '#DFC98E',
    '#5E8C3F', '#8DB4DC', '#A15560', '#AAB6CC', '#7BA886', '#D4B87A', '#7A7FB8'];

  let items = [];
  let icons = {};

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const nowKey = () => keyOf(Date.now());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function readJSON(k, fallback) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { console.warn('저장 실패', e); }
  }

  function load() {
    items = readJSON(KEY, []);
    if (!Array.isArray(items)) items = [];
    icons = readJSON(IKEY, {});
    if (typeof icons !== 'object' || Array.isArray(icons)) icons = {};
    return items;
  }

  // 오브제 하나의 랜덤 모양·색·크기·회전
  const look = () => ({
    shape: Math.floor(Math.random() * 8),   // sketch.js의 SHAPES 개수와 같아야 해
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    size: 16 + Math.random() * 22,
    rot: (Math.random() - 0.5) * 0.7,
  });

  function add(data, comfortText) {
    const id = data.id || uid();
    const rec = {
      ...data, id, createdAt: Date.now(),
      comfort: comfortText ? { id: uid(), mainId: id, text: comfortText } : null,
    };
    items.push(rec);
    writeJSON(KEY, items);
    return rec;
  }

  const all = () => items;
  const find = (id) => items.find((r) => r.id === id);
  const byMonth = (key) =>
    items.filter((r) => keyOf(r.createdAt) === key).sort((a, b) => a.createdAt - b.createdAt);

  function firstYear() {
    const ys = items.map((r) => new Date(r.createdAt).getFullYear());
    return ys.length ? Math.min(...ys, new Date().getFullYear()) : new Date().getFullYear();
  }

  // 달마다 모빌 오브제 하나가 랜덤으로 정해져서 계속 유지돼
  function iconOf(key) {
    if (!icons[key]) {
      const l = look();
      icons[key] = { shape: l.shape, color: l.color, rot: l.rot };
      writeJSON(IKEY, icons);
    }
    return icons[key];
  }

  function remove(id) { items = items.filter((r) => r.id !== id); writeJSON(KEY, items); }
  function clear() { items = []; writeJSON(KEY, items); }

  return { PALETTE, load, all, find, byMonth, add, remove, clear, look, uid, keyOf, nowKey, firstYear, iconOf };
})();