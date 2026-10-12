/* storage.js — 마음 조각 저장 · 불러오기 · 보관 · 복구
 *
 * 조각(note) 구조
 * {
 *   id, text, x, y,            // x, y: 화면 대비 0~1 비율 (화면 크기가 바뀌어도 위치 유지)
 *   color, motion,             // motion: 'shaky' | 'heavy' | 'light'
 *   status,                    // 'active'(떠다님) | 'archived'(간직) | 'released'(흘려보냄)
 *   createdAt, updatedAt
 * }
 *
 * 흘려보낸 조각도 데이터는 지우지 않고 status만 바꿔서 언제든 되돌릴 수 있어.
 */
const Store = (() => {
const KEY = 'moodling.v1';
  const LKEY = 'moodling.links.v1';   // 연결은 별도 키에 저장 (기존 메모 데이터와 호환)
let notes = [];
  let links = [];                     // [{ a: id, b: id }]

function load() {
    try {
    const raw = localStorage.getItem(KEY);
    notes = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(notes)) notes = [];
    } catch (e) {
    console.warn('불러오기 실패', e);
    notes = [];
    }
    try {
    const raw = localStorage.getItem(LKEY);
    links = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(links)) links = [];
    } catch (e) {
    links = [];
    }
    return notes;
}

function saveLinks() {
    try { localStorage.setItem(LKEY, JSON.stringify(links)); } catch (e) { console.warn(e); }
}

function save() {
    try {
    localStorage.setItem(KEY, JSON.stringify(notes));
    } catch (e) {
    console.warn('저장 실패', e);
    }
}

const all = () => notes;
const byStatus = (s) => notes.filter((n) => n.status === s);
const find = (id) => notes.find((n) => n.id === id);

function add(data) {
    const now = Date.now();
    const note = Object.assign(
    {
        id: now.toString(36) + Math.random().toString(36).slice(2, 6),
        text: '', x: 0.5, y: 0.5,
        color: '#cfe8a9', motion: 'light',
        status: 'active', createdAt: now, updatedAt: now,
    },
    data
    );
    notes.push(note);
    save();
    return note;
}

  // 같은 객체를 직접 수정하므로 화면의 조각과 항상 동기화돼
function update(id, patch) {
    const n = find(id);
    if (!n) return null;
    Object.assign(n, patch, { updatedAt: Date.now() });
    save();
    return n;
}

const setStatus = (id, status) => update(id, { status });

  // 필요할 때만 사용: 보관함에서 완전히 지우기
function purge(id) {
    notes = notes.filter((n) => n.id !== id);
    links = links.filter((l) => l.a !== id && l.b !== id);
    save(); saveLinks();
}

  /* ---- 연결: 조각을 이어 붙이고 풀기 ---- */
const links_ = () => links;
const hasLink = (a, b) => links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const linksOf = (id) => links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));

function link(a, b) {
    if (a === b || hasLink(a, b)) return;
    links.push({ a, b });
    saveLinks();
}

function unlink(a, b) {
    links = links.filter((l) => !((l.a === a && l.b === b) || (l.a === b && l.b === a)));
    saveLinks();
}

const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();

  // 오늘의 마음 요약
function summary() {
    return {
    active: byStatus('active').length,
    archived: notes.filter((n) => n.status === 'archived' && isToday(n.updatedAt)).length,
    released: notes.filter((n) => n.status === 'released' && isToday(n.updatedAt)).length,
    };
}

return {
    load, save, all, byStatus, find, add, update, setStatus, purge, summary,
    links: links_, hasLink, linksOf, link, unlink,
};
})();