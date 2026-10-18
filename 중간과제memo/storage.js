/* storage.js — 감정 기록 저장 · 불러오기 · 삭제
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
 * 저장 위치: 이 기기 브라우저의 localStorage (서버로 전송되지 않아요)
 */
const Store = (() => {
const KEY = 'moodling.v2';
const PALETTE = ['#9DBBA0', '#C0B0D5', '#E6C79B', '#A9C6D5', '#E5AFA8', '#B9C6A1'];
let items = [];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function load() {
    try {
    items = JSON.parse(localStorage.getItem(KEY)) || [];
    if (!Array.isArray(items)) items = [];
    } catch (e) { items = []; }
    return items;
}

function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); }
    catch (e) { console.warn('저장 실패', e); }
}

  // 오브제 하나의 랜덤 모양·색·크기·회전
const look = () => ({
    shape: Math.floor(Math.random() * 6),
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    size: 24 + Math.random() * 10,
    rot: (Math.random() - 0.5) * 1.2,
});

function add(data, comfortText) {
    const id = uid();
    const rec = {
    ...data, id, createdAt: Date.now(),
    comfort: comfortText ? { id: uid(), mainId: id, text: comfortText } : null,
    };
    items.push(rec);
    save();
    return rec;
}

const all = () => items;
const find = (id) => items.find((r) => r.id === id);
function remove(id) { items = items.filter((r) => r.id !== id); save(); }
function clear() { items = []; save(); }

return { PALETTE, load, all, find, add, remove, clear, look };
})();