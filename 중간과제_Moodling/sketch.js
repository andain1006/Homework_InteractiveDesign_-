/* sketch.js — MOODLING: 감정을 매달아 두는 시간
 * 흐름: emotion → cause → breath → place(곧·조만간·언젠간 정하기) → design(모양·색) → comfort → mobile (+ archive)
 * 모빌 화면: 모빌 하나를 크게 보고 옆으로 스와이프 / '전체보기'로 세 개를 한 화면에
 * 화면 전환·글 입력은 HTML, 물방울·모빌·드래그는 캔버스가 맡아.
 * 마우스/터치는 Pointer Events 하나로 통합해서 처리해.
 *
 * 모빌은 칼더(Calder)식 균형 구조야:
 *   천장 실 → 휘어진 가로대 → 양 끝에서 실로 오브제 또는 더 작은 가로대가 매달림.
 *   무거운(오브제가 많은) 쪽일수록 걸이점에 가깝게 달려서 균형을 맞춰.
 */

const EMOTIONS = [
  { k: 'anxious', name: '불안', sym: '〰' }, { k: 'sad', name: '우울', sym: '☁' },
  { k: 'stuffy', name: '답답함', sym: '◉' }, { k: 'regret', name: '후회', sym: '↶' },
  { k: 'burden', name: '부담', sym: '◇' }, { k: 'lonely', name: '외로움', sym: '○' },
  { k: 'unsure', name: '잘 모르겠음', sym: '…' },
];

// 사진 속 오브제 모양: 타원, 알약, 둥근 사각형, 가늘고 긴 조각 (w·h는 비율, r은 모서리 둥글기)
const SHAPES = [
  { w: 0.86, h: 1.30, r: 'oval' },   // 세로 타원
  { w: 0.80, h: 1.30, r: 0.42 },     // 알약
  { w: 1.00, h: 1.00, r: 0.42 },     // 둥근 정사각
  { w: 1.15, h: 0.95, r: 0.30 },     // 둥근 직사각
  { w: 0.34, h: 1.70, r: 'oval' },   // 가늘고 긴 조각
  { w: 1.10, h: 1.45, r: 0.38 },     // 큰 둥근 직사각
  { w: 0.50, h: 1.15, r: 'oval' },   // 좁은 타원
  { w: 1.00, h: 1.00, r: 'oval' },   // 원
];
const SHAPE_NAMES = ['세로 타원', '알약', '둥근 정사각', '둥근 직사각', '가는 조각', '큰 직사각', '좁은 타원', '원'];
// storage.js의 PALETTE와 같은 순서 (사진 속 모빌의 15색)
const COLOR_NAMES = ['코랄', '남색', '하늘', '연보라', '연두', '빨강', '주황', '버터', '초록', '연파랑', '자주', '회청', '쑥색', '황토', '보랏빛'];
const K = 1.5;   // 오브제 크기 배율

// 세 개의 모빌: 곧은 낮고 실이 짧고, 언젠간은 높고 실이 길고 더 천천히 흔들려
const COLS = [
  { key: 'soon',    label: '곧',     sub: '내일 다시 살펴볼 수 있어',      len: [34, 56],  swing: 0.050, spd: 0.55 },
  { key: 'later',   label: '조만간', sub: '급하지 않으니까 괜찮아',  len: [52, 84],  swing: 0.055, spd: 0.42 },
  { key: 'someday', label: '언젠간', sub: '꼭 답을 찾지 않아도 돼', len: [78, 120], swing: 0.060, spd: 0.30 },
];

const PHRASES = [
  '내일 천천히 다시 생각해 보자.', '완벽하지 않아도 괜찮아.',
  '시간이 조금 더 필요할 뿐이야.', '나는 이 순간을 지나갈 수 있어.',
];
const SPEEDS = { slow: [5, 7], normal: [4, 6], fast: [3, 4] };   // [들이쉬기, 내쉬기] 초
const ORDER = ['emotion', 'breath', 'cause', 'place', 'design', 'comfort'];
const OUT_MS = 750;                       // 화면이 사라지는 시간 (style.css의 --out과 맞춤)
const INK = '63,74,72';
const BREATH_RGB = '176,200,140';          // 심호흡 물방울 색: 차분한 연두 (바꾸고 싶으면 이 값만 수정)
const BG = '238,234,225';                  // 화면 가장자리 그라데이션에 쓰는 배경색 (style.css 배경의 중간 톤)
const COL_IDX = { soon: 0, later: 1, someday: 2 };
const SPACING = 0.72;                      // 스와이프할 때 모빌 사이 간격 (화면 폭 대비) — 작을수록 옆 모빌이 많이 보여
const FOCUS_W = 0.68;                      // 크게 볼 때 모빌이 차지하는 폭 (화면 폭 대비)
const $ = (s) => document.querySelector(s);

let step = 'emotion', started = false, busy = false, cvs = null;
let draft = null;                          // 지금 만드는 기록 (저장 전)
let drag = { x: 0, y: 0, ox: 0, oy: 0, on: false };
let hotCol = null, hits = [], anim = {}, appear = {}, cache = {};
let pressing = false, down = null;
let breath = { t: 0, r: 0, speed: 'normal', done: false, text: '' };
let viewKey = '';                          // 모빌 화면에서 보는 달 ('2026-10')
let archYear = new Date().getFullYear();
let focus = 0, cam = 0;                    // 크게 보는 모빌 번호(목표)와 지금 화면 위치(부드럽게 따라가는 값)
let viewMode = 'focus';                    // 'focus' 크게 보기 | 'all' 한 화면에 세 개
let sw = null, shownIdx = -1, modeBusy = false, hitOK = false;

/* ============================ p5 ============================ */
function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('stage');
  cvs = c.elt;
  textFont('Gowun Dodum');
  Store.load();
  viewKey = Store.nowKey();
  cvs.style.touchAction = 'none';
  cvs.addEventListener('pointerdown', onDown);
  cvs.addEventListener('pointermove', onMove);
  cvs.addEventListener('pointerup', onUp);
  cvs.addEventListener('pointercancel', onUp);
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
  bindUI();
  go('emotion');
}

function draw() {
  clear();
  rectMode(CENTER);
  for (const k in appear) appear[k] += (1 - appear[k]) * 0.03;
  for (const k in anim) anim[k] *= 0.97;
  if (step === 'mobile' && viewMode === 'focus' && constrain(Math.round(cam), 0, 2) !== shownIdx) updateFocusUI();
  if (step === 'breath') drawBreath();
  else if (step === 'place' || step === 'design' || step === 'comfort' || step === 'mobile') drawMobiles();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

/* ============================ 화면 전환 (천천히, 부드럽게) ============================ */
function go(s) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  const cur = document.querySelector('.step:not([hidden])');
  const smooth = started && cur;
  started = true;

  if (smooth) { cur.classList.add('out'); cvs.style.opacity = 0; }
  setTimeout(() => {
    swap(s);
    if (cur) cur.classList.remove('out');
    cvs.style.opacity = 1;
    setTimeout(() => { busy = false; document.body.classList.remove('busy'); }, 600);
  }, smooth ? OUT_MS : 0);
}

function swap(s) {
  step = s;
  document.querySelectorAll('.step').forEach((el) => (el.hidden = el.id !== 's-' + s));
  const i = ORDER.indexOf(s);
  $('#dots').hidden = i < 0;
  document.querySelectorAll('#dots li').forEach((li, n) => li.classList.toggle('on', n === i));

  if (s === 'emotion') $('#btn-to-mobile').hidden = Store.all().length === 0;
  if (s === 'breath') { breath.t = 0; breath.done = false; breath.text = ''; breath.r = 0; }
  if (s === 'design') startDesign();
  if (s === 'place') { drag = { x: width / 2, y: height - 175, ox: 0, oy: 0, on: false }; hotCol = null; }
  if (s === 'mobile') {
    // 기본은 가장 최근에 오브제를 추가한 모빌을 크게 보여줘
    const list = Store.byMonth(viewKey);
    const last = list.length ? list.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)) : null;
    viewMode = 'focus'; sw = null;
    focus = cam = last ? (COL_IDX[last.mobile] ?? 0) : 0;
    renderMobileHead();
  }
  if (s === 'archive') renderArchive();
  if (s === 'cause') setTimeout(() => $('#cause-text').focus(), 700);
}

function bindUI() {
  // 01 감정 선택
  const box = $('#emotions');
  EMOTIONS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'emo';
    b.innerHTML = `<b>${e.sym}</b><span>${e.name}</span>`;
    b.addEventListener('click', () => {
      draft = { ...Store.look(), emotion: e.k, cause: '', mobile: null, id: Store.uid(), comfort: null, createdAt: Date.now() };
      $('#chosen').textContent = `${e.sym}  ${e.name}`;
      $('#cause-text').value = '';
      go('breath');
    });
    box.appendChild(b);
  });
  $('#btn-to-mobile').addEventListener('click', () => { viewKey = Store.nowKey(); go('mobile'); });

  // 02 원인
  $('#btn-cause-back').addEventListener('click', () => go('emotion'));
  $('#btn-cause-next').addEventListener('click', () => { draft.cause = $('#cause-text').value.trim(); go('place'); });

  // 03 호흡
  $('#btn-breath-next').addEventListener('click', () => go('cause'));
  bindDesign();
  document.querySelectorAll('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      breath.speed = b.dataset.speed;
      document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
      updateGuide();
    })
  );
  updateGuide();

  // 05 위로의 말
  const ta = $('#comfort-text');
  PHRASES.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p;
    b.addEventListener('click', () => { ta.value = p; syncComfort(); });
    $('#phrases').appendChild(b);
  });
  ta.addEventListener('input', syncComfort);
  $('#btn-hang').addEventListener('click', () => {
    const rec = Store.add(draft, ta.value.trim());
    draft = null; ta.value = '';
    kick(rec.id, 0.6);
    viewKey = Store.nowKey();
    go('mobile');
  });

  // 모빌 보기
  $('#btn-new').addEventListener('click', () => go('emotion'));
  $('#btn-archive').addEventListener('click', () => { archYear = +viewKey.slice(0, 4); go('archive'); });
  $('#btn-back').addEventListener('click', () => { archYear = +viewKey.slice(0, 4); go('archive'); });
  document.querySelectorAll('#pager [data-i]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      if (viewMode === 'focus') focus = i; else setViewMode('focus', i);
    })
  );
  $('#btn-overview').addEventListener('click', () => setViewMode(viewMode === 'focus' ? 'all' : 'focus', focus));
  window.addEventListener('keydown', (e) => {        // 컴퓨터에서는 방향키로도 넘길 수 있어
    if (step !== 'mobile' || viewMode !== 'focus' || !$('#detail').hidden) return;
    if (e.key === 'ArrowLeft') focus = Math.max(0, focus - 1);
    if (e.key === 'ArrowRight') focus = Math.min(2, focus + 1);
  });

  // 지난 기록
  $('#y-prev').addEventListener('click', () => { archYear--; renderArchive(); });
  $('#y-next').addEventListener('click', () => { archYear++; renderArchive(); });
  $('#btn-arch-back').addEventListener('click', () => { viewKey = Store.nowKey(); go('mobile'); });
  $('#btn-clear').addEventListener('click', () => {
    if (confirm('저장된 모든 달의 감정 기록을 지울까요? 지난 기록도 함께 지워지고, 되돌릴 수 없어요.')) {
      Store.clear(); anim = {}; cache = {}; appear = {}; renderArchive();
    }
  });

  // 기록 보기
  $('#btn-close').addEventListener('click', closeDetail);
  $('#detail').addEventListener('pointerdown', (e) => { if (e.target.id === 'detail') closeDetail(); });
}

// 쓰는 동안 작은 위로 오브제가 모빌에 미리 매달려 보임
function syncComfort() {
  const t = $('#comfort-text').value.trim();
  draft.comfort = t ? { text: t } : null;
}

// 선택한 속도에 맞춰 안내 문구의 초(秒)를 바꿈
function updateGuide() {
  const [inh, exh] = SPEEDS[breath.speed];
  $('#g-in').textContent = inh;
  $('#g-out').textContent = exh;
}

/* ============================ 포인터 ============================ */
const HOT_Y = () => height - 265;   // 이 위로 끌어올려야 모빌에 걸려
const colAt = (x) => COLS[constrain(floor(x / (width / 3)), 0, 2)].key;
function pos(e) { const r = e.target.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function onDown(e) {
  if (busy || modeBusy) return;
  cvs.setPointerCapture(e.pointerId);
  const { x, y } = pos(e);
  down = { x, y, moved: false };
  sw = step === 'mobile' && viewMode === 'focus' ? { x, y, cam0: cam, lastX: x, lastT: performance.now(), v: 0, on: false } : null;
  if (step === 'breath') { pressing = true; breath.t = 0; }
  else if (step === 'place' && draft && !draft.mobile) {
    const d = dims(draft);
    if (Math.hypot(x - drag.x, y - drag.y) < Math.max(d.w, d.h) / 2 + 26) {
      drag.on = true; drag.ox = drag.x - x; drag.oy = drag.y - y;
    }
  }
}

function onMove(e) {
  if (!down) return;
  const { x, y } = pos(e);
  if (Math.hypot(x - down.x, y - down.y) > 8) down.moved = true;
  if (sw) {                                            // 옆으로 밀면 모빌이 손가락을 따라와
    const dx = x - sw.x;
    if (!sw.on && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(y - sw.y)) sw.on = true;
    if (sw.on) {
      cam = constrain(sw.cam0 - dx / (width * SPACING), -0.3, 2.3);
      const now = performance.now(), dt = now - sw.lastT;
      if (dt > 0) sw.v = 0.8 * sw.v + 0.2 * ((x - sw.lastX) / dt);
      sw.lastX = x; sw.lastT = now;
    }
  }
  if (drag.on) {
    drag.x = x + drag.ox; drag.y = y + drag.oy;
    hotCol = drag.y < HOT_Y() ? colAt(drag.x) : null;
  }
}

function onUp(e) {
  if (!down) return;
  const { x, y } = pos(e);
  pressing = false;
  if (sw && sw.on) {                                   // 놓으면 가까운(또는 밀던 방향의) 모빌로 천천히 자리 잡아
    focus = constrain(Math.round(cam - (sw.v * 260) / (width * SPACING)), 0, 2);
    sw = null; down = null;
    return;
  }
  sw = null;
  if (drag.on) {
    drag.on = false;
    if (hotCol) { draft.mobile = hotCol; kick(draft.id, 0.5); go('design'); }   // 놓은 자리에 매달림
    hotCol = null;
  } else if (step === 'mobile' && !down.moved) {
    const h = [...hits].reverse().find((o) => inObj(o, x, y));
    if (h) { kick(h.id, 0.5); openDetail(h.id); }
    else if (viewMode === 'all') setViewMode('focus', COL_IDX[colAt(x)]);   // 전체보기에서 모빌을 누르면 크게 보기
  }
  down = null;
}

function inObj(o, x, y) {
  const dx = x - o.cx, dy = y - o.cy, c = Math.cos(o.a), s = Math.sin(o.a);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) < o.w / 2 + 10 && Math.abs(ly) < o.h / 2 + 10;
}

/* ============================ 호흡 물방울 ============================ */
function setBreathText(t) {
  if (breath.text === t) return;
  breath.text = t;
  $('#breath-text').textContent = t;
}

function drawBreath() {
  const m = Math.min(width, height), base = m * 0.15, maxR = m * 0.3;
  const [inh, exh] = SPEEDS[breath.speed];
  let target = base, word = '';

  if (pressing) {
    breath.t += deltaTime / 1000;
    const c = breath.t % (inh + exh), inhale = c < inh;
    const p = inhale ? c / inh : 1 - (c - inh) / exh;
    target = lerp(base, maxR, 0.5 - 0.5 * Math.cos(Math.PI * p));
    word = inhale ? '들이쉬어요' : '내쉬어요';
    if (breath.t >= inh + exh) breath.done = true;
    setBreathText('물방울이 커질 때 들이쉬고, 작아질 때 내쉬어요.');
  } else {
    setBreathText(breath.done ? '지금 이 순간만큼은 서두르지 않아도 괜찮아요.' : '잠시 멈추고, 천천히 숨을 쉬어 봐요.');
  }
  // 손을 떼면 즉시 멈추지 않고 천천히 원래 크기로
  breath.r = lerp(breath.r || base, target, pressing ? 0.12 : 0.03);

  const cx = width / 2, cy = height * 0.42, r = breath.r, ctx = drawingContext, t = frameCount;
  const amp = pressing ? 0.02 : 0.045;   // 가만히 있을 때도 미세하게 일렁임

  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {                       // 퍼져 나가는 물결 (물방울과 같은 연두색)
    const f = (t * 0.003 + k / 3) % 1;
    ctx.strokeStyle = `rgba(${BREATH_RGB},${(1 - f) * 0.35})`;
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.05 + f * 0.6), 0, TWO_PI); ctx.stroke();
  }

  // 물방울: 그라데이션 없이 차분한 연두 단색, 가장자리만 아주 살짝 흐리게
  ctx.save();
  const blurPx = 2.5;
  if ('filter' in ctx) ctx.filter = `blur(${blurPx * pixelDensity()}px)`;   // 가우시안 블러 (화면 배율에 맞춤)
  else { ctx.shadowColor = `rgba(${BREATH_RGB},.9)`; ctx.shadowBlur = blurPx * 2; }   // 블러 미지원 브라우저(구형 Safari)용 대체
  ctx.fillStyle = `rgb(${BREATH_RGB})`;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * TWO_PI;
    const rr = r * (1 + (noise(Math.cos(a) + 5, Math.sin(a) + 5, t * 0.012) - 0.5) * 2 * amp);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();

  noStroke(); fill(63, 74, 72, 190); textAlign(CENTER, CENTER); textSize(16);
  text(word, cx, cy);
}

/* ============================ 모빌 ============================ */
const kick = (id, v) => (anim[id] = v);
const hash = (id) => {                       // 같은 글자면 항상 같은 0~1 값 (랜덤처럼 보이지만 매번 똑같이 배치돼)
  let h = 2166136261; const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};
const dims = (r) => { const S = SHAPES[r.shape % SHAPES.length]; return { w: S.w * r.size * K, h: S.h * r.size * K }; };
const hasComfort = (r) => !!(r.comfort && r.comfort.text);
function ap(key, isNew) { if (!(key in appear)) appear[key] = isNew ? 0 : 1; return appear[key]; }

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 색은 '#rrggbb' 하나이거나 '#위색|#아래색' (위아래로 번지는 그라데이션)
function fillFor(ctx, color, y0, y1, alpha) {
  if (color.indexOf('|') < 0) return hexA(color, alpha);
  const [a, b] = color.split('|'), g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, hexA(a, alpha)); g.addColorStop(1, hexA(b, alpha));
  return g;
}
let svgUid = 0;
function paintSVG(color) {
  if (color.indexOf('|') < 0) return { defs: '', fill: color };
  const [a, b] = color.split('|'), id = 'pg' + (++svgUid);
  return {
    defs: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`,
    fill: `url(#${id})`,
  };
}

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shapePath(ctx, k, w, h, cx, cy) {
  const S = SHAPES[k % SHAPES.length];
  ctx.beginPath();
  if (S.r === 'oval') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else rr(ctx, cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * S.r);
}

/* ---- 트리 만들기: 새 오브제는 가장 얕은 잎 자리에 끼워 넣어서 구조가 크게 흔들리지 않아 ---- */
const leaf = (r) => ({ t: 'o', r });
const nLeaves = (n) => (n.t === 'o' ? 1 : nLeaves(n.a) + nLeaves(n.b));
const firstId = (n) => (n.t === 'o' ? n.r.id : firstId(n.a));

// 새 오브제는 이미 달린 것(오브제 또는 가로대 묶음) 중 아무거나 하나를 골라 그 자리에 함께 매달려.
// 어디를 고를지는 오브제 id로 정해져서, 랜덤처럼 불규칙하지만 다시 열어도 모양이 그대로야.
function insertLeaf(root, node) {
  const all = [];
  (function walk(n) { all.push(n); if (n.t === 'b') { walk(n.a); walk(n.b); } })(root);
  const target = all[Math.floor(hash(node.r.id + ':p') * all.length)];
  const flip = hash(node.r.id + ':f') > 0.5;
  const bar = flip ? { t: 'b', a: node, b: target } : { t: 'b', a: target, b: node };
  if (target === root) return bar;
  (function swap(n) {
    if (n.t !== 'b') return;
    if (n.a === target) n.a = bar; else swap(n.a);
    if (n.b === target) n.b = bar; else swap(n.b);
  })(root);
  return root;
}

// 크기·간격·실 길이 계산 (모두 sc에 비례해서 한꺼번에 줄일 수 있어)
function measure(n, sc, col) {
  if (n.t === 'o') {
    const d = dims(n.r);
    n.w = d.w * sc; n.h = d.h * sc; n.hs = hash(n.r.id);
    n.cm = hasComfort(n.r) ? { w: d.w * 0.5 * sc, h: d.h * 0.5 * sc, th: 22 * sc } : null;
    n.ext = { l: n.w / 2, r: n.w / 2 };
    n.H = n.h + (n.cm ? n.cm.th + n.cm.h : 0);
    return;
  }
  measure(n.a, sc, col); measure(n.b, sc, col);
  const wa = nLeaves(n.a), wb = nLeaves(n.b);
  const key = firstId(n) + ':' + (wa + wb);       // 가로대마다 다른 랜덤 값을 쓰기 위한 키
  const rd = (s) => hash(key + s);

  // 걸이점 위치: 무게 균형을 조금만 따르고 나머지는 랜덤 → 한쪽으로 쏠린 불균형한 배치
  const bal = wb / (wa + wb);
  const f = bal * 0.3 + (0.15 + 0.7 * rd('f')) * 0.7;
  const base = (26 + 18 * Math.sqrt(wa + wb)) * (0.7 + 0.9 * rd('d')) * sc;
  const D = Math.max(base, n.a.ext.r + n.b.ext.l + 10 * sc);
  n.dl = D * f; n.dr = D * (1 - f);
  n.tilt = (rd('t') - 0.5) * 0.34;                 // 가로대가 살짝 기울어져 있음
  n.dropL = n.dl * (0.08 + 0.3 * rd('l')); n.dropR = n.dr * (0.08 + 0.3 * rd('r'));

  // 실 길이도 제각각: 짧게 붙어 있는 것도, 길게 늘어진 것도 있어
  const sl = (c, side) => {
    const k2 = firstId(c) + side;
    return (col.len[0] + hash(k2 + 'L') * (col.len[1] - col.len[0])) * (0.4 + 1.2 * hash(k2 + 'M')) * (c.t === 'b' ? 0.75 : 1) * sc;
  };
  n.la = sl(n.a, 'a'); n.lb = sl(n.b, 'b');
  n.ext = {
    l: Math.max(n.dl + n.a.ext.l, n.b.ext.l - n.dr, 0),
    r: Math.max(n.dr + n.b.ext.r, n.a.ext.r - n.dl, 0),
  };
  n.H = Math.max(n.dropL + n.la + n.a.H, n.dropR + n.lb + n.b.H) + Math.abs(n.tilt) * Math.max(n.dl, n.dr);
  const h = rd('s');
  n.sw = col.swing * (0.8 + h * 0.5); n.spd = col.spd * (0.8 + h * 0.5); n.ph = h * 6.28;
}

// 모빌 하나의 배치 계산 (조건이 같으면 캐시를 써서 매 프레임 다시 계산하지 않아)
// availW: 가로로 쓸 수 있는 폭, reserve: 아래쪽에 비워 둘 높이, maxSc: 최대 확대 배율
function layoutFor(c, items, availW, reserve, maxSc, barY) {
  if (!items.length) return null;
  const sig = [c.key, Math.round(width), Math.round(height), Math.round(availW), reserve, maxSc, Math.round(barY)].join('/') + ':' +
    items.map((r) => r.id + '.' + r.shape + '.' + r.size.toFixed(1) + (hasComfort(r) ? 'c' : '')).join('|');
  const hit = cache[c.key];
  if (hit && hit.sig === sig) return hit;

  let root = leaf(items[0]);
  for (let i = 1; i < items.length; i++) root = insertLeaf(root, leaf(items[i]));
  measure(root, 1, c);
  const availH = height - barY - reserve;
  const sc = Math.max(0.3, Math.min(maxSc, availW / Math.max(1, root.ext.l + root.ext.r), availH / Math.max(1, root.H + 12)));
  measure(root, sc, c);
  return (cache[c.key] = { sig, root, off: (root.ext.l - root.ext.r) / 2 });   // off: 가운데 정렬용 어긋남
}

/* ---- 그리기 ---- */
let ghostA = 1;

function wire(ctx) { ctx.strokeStyle = `rgba(${INK},${0.75 * ghostA})`; ctx.lineWidth = 1.1; ctx.lineCap = 'round'; }
function dot(ctx, x, y) { ctx.fillStyle = `rgba(${INK},${0.8 * ghostA})`; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
function vline(ctx, x, y1, y2) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke(); }

function drawNode(n, x, y, t) {
  const ctx = drawingContext;
  if (n.t === 'o') return drawLeaf(n, x, y, t);

  const a = n.tilt + n.sw * Math.sin(t * n.spd + n.ph), c = Math.cos(a), s = Math.sin(a);
  const R = (px, py) => ({ x: x + px * c - py * s, y: y + px * s + py * c });
  const L = R(-n.dl, n.dropL), Rt = R(n.dr, n.dropR), cl = R(-n.dl * 0.5, 0), cr = R(n.dr * 0.5, 0);

  wire(ctx);
  ctx.beginPath(); ctx.moveTo(L.x, L.y);                 // 휘어진 가로대
  ctx.quadraticCurveTo(cl.x, cl.y, x, y);
  ctx.quadraticCurveTo(cr.x, cr.y, Rt.x, Rt.y);
  ctx.stroke();
  dot(ctx, x, y); dot(ctx, L.x, L.y); dot(ctx, Rt.x, Rt.y);

  wire(ctx); vline(ctx, L.x, L.y, L.y + n.la); vline(ctx, Rt.x, Rt.y, Rt.y + n.lb);
  drawNode(n.a, L.x, L.y + n.la, t);
  drawNode(n.b, Rt.x, Rt.y + n.lb, t);
}

function drawLeaf(n, x, y, t) {
  const ctx = drawingContext, r = n.r, h = n.hs, k = anim[r.id] || 0;
  const isNew = !!(draft && r.id === draft.id);
  const al = (isNew ? 1 : ghostA) * ap(r.id, isNew);
  const a = r.rot * 0.4 + 0.05 * Math.sin(t * (0.5 + h * 0.35) + h * 6) + k * 0.6 * Math.sin(t * 5);

  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = fillFor(ctx, r.color, 0, n.h, 0.95 * al);
  shapePath(ctx, r.shape, n.w, n.h, 0, n.h / 2); ctx.fill();
  if (isNew && step === 'design') {                       // 지금 고르고 있는 오브제를 점선으로 표시
    ctx.save(); ctx.setLineDash([4, 5]); ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${INK},.5)`;
    shapePath(ctx, r.shape, n.w + 16, n.h + 16, 0, n.h / 2); ctx.stroke(); ctx.restore();
  }
  ctx.fillStyle = `rgba(245,240,232,${0.9 * al})`;      // 실이 꿰어진 작은 구멍
  ctx.beginPath(); ctx.arc(0, 5, 1.5, 0, Math.PI * 2); ctx.fill();

  let a2 = 0, cmA = 0;
  if (n.cm) {
    const isNewC = isNew;
    cmA = (isNewC ? 1 : ghostA) * ap(r.id + ':c', isNewC);
    a2 = 0.14 * Math.sin(t * 1.2 + h * 5) + k * 0.6 * Math.sin(t * 5 + 1);
    ctx.strokeStyle = `rgba(${INK},${0.75 * cmA})`; ctx.lineWidth = 1.1;
    vline(ctx, 0, n.h, n.h + n.cm.th);
    ctx.translate(0, n.h + n.cm.th); ctx.rotate(a2);
    ctx.fillStyle = fillFor(ctx, r.color, 0, n.cm.h, 0.95 * cmA);
    shapePath(ctx, r.shape, n.cm.w, n.cm.h, 0, n.cm.h / 2); ctx.fill();
    ctx.fillStyle = `rgba(245,240,232,${0.9 * cmA})`;
    ctx.beginPath(); ctx.arc(0, 4, 1.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  if (step === 'mobile' && hitOK) {                       // 눌러서 열 수 있는 영역
    hits.push({ id: r.id, cx: x - Math.sin(a) * n.h / 2, cy: y + Math.cos(a) * n.h / 2, a, w: n.w, h: n.h });
    if (n.cm) {
      const d = n.h + n.cm.th, ax = x - Math.sin(a) * d, ay = y + Math.cos(a) * d, b = a + a2;
      hits.push({ id: r.id, cx: ax - Math.sin(b) * n.cm.h / 2, cy: ay + Math.cos(b) * n.cm.h / 2, a: b, w: n.cm.w, h: n.cm.h });
    }
  }
}

// 모빌 걸이 높이: 곧 < 조만간 < 언젠간 순으로 높아져 (머리글 아래에서 시작)
const barYof = (ci) => 140 + height * [0.15, 0.085, 0.02][ci];

// 천장 실은 머리글 글자를 가리지 않게, 아래에서부터 서서히 나타나
function ceilThread(ctx, x, barY) {
  const y0 = 96, g = ctx.createLinearGradient(0, y0, 0, y0 + 60);
  g.addColorStop(0, `rgba(${INK},0)`); g.addColorStop(1, `rgba(${INK},${0.75 * ghostA})`);
  ctx.strokeStyle = g; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, barY); ctx.stroke();
}

// 스와이프할 때 옆 모빌이 화면 가장자리에서 은은하게 번져 보이도록
function edgeFade(ctx) {
  const gw = width * 0.15;
  let g = ctx.createLinearGradient(0, 0, gw, 0);
  g.addColorStop(0, `rgba(${BG},.9)`); g.addColorStop(1, `rgba(${BG},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, gw, height);
  g = ctx.createLinearGradient(width, 0, width - gw, 0);
  g.addColorStop(0, `rgba(${BG},.9)`); g.addColorStop(1, `rgba(${BG},0)`);
  ctx.fillStyle = g; ctx.fillRect(width - gw, 0, gw, height);
}

function drawMobiles() {
  hits = [];
  const ctx = drawingContext, t = millis() / 1000, cw = width / 3;
  const isView = step === 'mobile', isDesign = step === 'design', isFit = isDesign || step === 'comfort';
  // 'all'은 세 모빌을 한 화면에, 'focus'는 모빌 하나를 크게 (옆으로 스와이프)
  const mode = step === 'place' ? 'all' : isView ? viewMode : 'focus';
  let list = Store.byMonth(isView ? viewKey : Store.nowKey());
  if (!isView && draft && draft.mobile) list = list.concat([draft]);

  // 모양·색을 고르는 동안에는 오브제가 걸린 모빌 하나만 크게 보여줘
  const pick = isFit && draft ? COL_IDX[draft.mobile] : -1;
  if (pick >= 0) cam = pick;
  else if (isView && mode === 'focus' && !(sw && sw.on)) cam += (focus - cam) * 0.12;
  const reserve = step === 'place' ? 150 : isView ? (mode === 'all' ? 190 : 160) : isDesign ? 240 : 360;
  const baseGhost = isView ? 1 : isFit ? 0.55 : 0.4;   // 새 감정을 정리하는 동안 기존 오브제는 흐릿하게

  COLS.forEach((c, ci) => {
    if (pick >= 0 && ci !== pick) return;
    const barY = barYof(ci);
    let cx, availW, maxSc, w = 1;
    hitOK = isView;
    if (mode === 'all') { cx = cw * (ci + 0.5); availW = cw * 0.9; maxSc = 1; }
    else {
      const rel = ci - cam;
      cx = width / 2 + rel * width * SPACING; availW = width * FOCUS_W; maxSc = 1.5;
      if (isView) { w = Math.max(0, 1 - Math.abs(rel) * 0.5); hitOK = Math.abs(rel) < 0.5; }   // 옆 모빌은 흐리게
      if (w < 0.02) return;
    }
    ghostA = baseGhost * w;
    const lay = layoutFor(c, list.filter((r) => r.mobile === c.key), availW, reserve, maxSc, barY);

    if (step === 'place' && hotCol === c.key) {
      ctx.fillStyle = 'rgba(88,119,113,.08)';
      ctx.beginPath(); rr(ctx, cw * ci + 8, 0, cw - 16, height - 130, 26); ctx.fill();
    }

    if (lay) {
      const x0 = cx + lay.off;
      ceilThread(ctx, x0, barY);
      dot(ctx, x0, barY);
      drawNode(lay.root, x0, barY, t);
    } else {                                              // 비어 있는 모빌: 실과 빈 가로대만
      const keep = ghostA; ghostA = Math.max(keep, 0.5 * w); wire(ctx);
      ceilThread(ctx, cx, barY);
      wire(ctx);
      ctx.beginPath(); ctx.moveTo(cx - 38, barY + 9);
      ctx.quadraticCurveTo(cx - 19, barY, cx, barY); ctx.quadraticCurveTo(cx + 19, barY, cx + 38, barY + 9);
      ctx.stroke();
      ghostA = keep;
    }

    if (mode === 'all') {                                 // 한 화면에 세 개를 볼 때만 모빌 이름을 그려
      noStroke(); textAlign(CENTER, CENTER);
      fill(63, 74, 72, step === 'place' && hotCol === c.key ? 255 : 215);
      textSize(20); text(c.label, cx, height - (isView ? 158 : 116));
      if (!isView) { fill(133, 140, 132); textSize(12); text(c.sub, cx, height - 84, cw - 14, 34); }
    }
  });

  if (isView && mode === 'focus') edgeFade(ctx);

  // 아직 모빌에 걸지 않은 감정 오브제 (끌어서 걸기)
  if (step === 'place' && draft && !draft.mobile) {
    if (!drag.on) {
      drag.x = lerp(drag.x, width / 2, 0.08);
      drag.y = lerp(drag.y, height - 175 + Math.sin(t * 1.6) * 5, 0.08);
    }
    const d = dims(draft), s = drag.on ? 1.08 : 1, w = d.w * s, h = d.h * s;
    const ax = drag.x, ay = drag.y - h / 2;
    ghostA = 1; wire(ctx); vline(ctx, ax, ay - 46, ay);   // 손에 매달려 있는 실
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(draft.rot * 0.4 + Math.sin(t * 1.2) * 0.05);
    ctx.fillStyle = fillFor(ctx, draft.color, 0, h, 0.95);
    shapePath(ctx, draft.shape, w, h, 0, h / 2); ctx.fill();
    ctx.restore();
  }

  if (isView && !list.length) {
    noStroke(); fill(133, 140, 132); textSize(15); textAlign(CENTER, CENTER);
    text('이번 달 모빌이 아직 비어 있어요.', width / 2, height * 0.58);
  }
}

/* ============================ 오브제 고르기: 모빌에 걸린 채로 모양 → 색 ============================ */
let designPhase = 'shape';

function startDesign() { designPhase = 'shape'; renderDesign(); }

function bindDesign() {
  $('#btn-design-next').addEventListener('click', () => {
    if (designPhase === 'shape') { designPhase = 'color'; renderDesign(); }
    else go('comfort');
  });
  $('#btn-design-back').addEventListener('click', () => {
    if (designPhase === 'color') { designPhase = 'shape'; renderDesign(); }
    else { draft.mobile = null; go('place'); }          // 모양 단계에서는 다른 모빌에 다시 걸 수 있어
  });
}

function shapeSVG(k, color, box) {
  const S = SHAPES[k % SHAPES.length], sc = (box - 6) / Math.max(S.w, S.h);
  const w = S.w * sc, h = S.h * sc, c = box / 2, p = paintSVG(color);
  const body = S.r === 'oval'
    ? `<ellipse cx="${c}" cy="${c}" rx="${w / 2}" ry="${h / 2}" fill="${p.fill}"/>`
    : `<rect x="${c - w / 2}" y="${c - h / 2}" width="${w}" height="${h}" rx="${Math.min(w, h) * S.r}" fill="${p.fill}"/>`;
  return `<svg viewBox="0 0 ${box} ${box}" aria-hidden="true">${p.defs}${body}</svg>`;
}

function renderDesign() {
  if (!draft) return;
  const isShape = designPhase === 'shape';
  const where = COLS.find((c) => c.key === draft.mobile);
  $('#design-title').textContent = isShape ? '어떤 모양으로 매달까요?' : '어떤 색으로 칠할까요?';
  $('#design-sub').textContent = isShape
    ? `‘${where ? where.label : ''}’ 모빌에 걸려 있어요. 마음에 드는 모양을 골라 보세요.`
    : '고른 모양에 색을 입혀 보세요. 모빌에서 바로 확인할 수 있어요.';
  $('#shape-opts').hidden = !isShape;
  $('#color-opts').hidden = isShape;
  $('#btn-design-back').textContent = isShape ? '다른 모빌에 걸기' : '모양 다시 고르기';
  $('#btn-design-next').textContent = isShape ? '색 고르기' : '이 오브제로 정하기';

  const so = $('#shape-opts'); so.innerHTML = '';
  SHAPES.forEach((_, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt' + (draft.shape === k ? ' on' : '');
    b.setAttribute('aria-label', SHAPE_NAMES[k]);
    b.innerHTML = shapeSVG(k, draft.color, 40);
    b.addEventListener('click', () => { draft.shape = k; kick(draft.id, 0.5); renderDesign(); });
    so.appendChild(b);
  });

  const co = $('#color-opts'); co.innerHTML = '';
  Store.PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt' + (draft.color === c ? ' on' : '');
    b.setAttribute('aria-label', COLOR_NAMES[i] || c);
    b.innerHTML = shapeSVG(draft.shape, c, 40);       // 고른 모양에 각 색을 입힌 모습
    b.addEventListener('click', () => { draft.color = c; kick(draft.id, 0.5); renderDesign(); });
    co.appendChild(b);
  });
}

/* ============================ 모빌 화면: 머리글 · 모빌 고르기 · 전체보기 ============================ */
function renderMobileHead() {
  const [y, m] = viewKey.split('-').map(Number);
  const isNow = viewKey === Store.nowKey();
  $('#m-title').textContent = `${y}년 ${m}월${isNow ? ' · 이번 달' : ''}`;
  $('#btn-new').hidden = !isNow;
  $('#btn-archive').hidden = !isNow;
  $('#btn-back').hidden = isNow;
  updateFocusUI();
}

// 지금 보이는 모빌(탭 표시, 모빌별 개수, 설명 문구)을 화면 글자에 반영
function updateFocusUI() {
  shownIdx = constrain(Math.round(cam), 0, 2);
  const list = Store.byMonth(viewKey);
  document.querySelectorAll('#pager [data-i]').forEach((b, i) => {
    b.querySelector('i').textContent = list.filter((r) => r.mobile === COLS[i].key).length;
    b.classList.toggle('on', viewMode === 'focus' && i === shownIdx);
  });
  $('#btn-overview').textContent = viewMode === 'focus' ? '전체보기' : '크게 보기';
  $('#m-sub').textContent = viewMode === 'focus'
    ? `${COLS[shownIdx].label} · ${COLS[shownIdx].sub}`
    : (list.length ? '모빌을 누르면 크게 볼 수 있어요' : '');
}

// 크게 보기 ↔ 전체보기: 화면이 천천히 흐려졌다가 바뀌어
function setViewMode(m, idx) {
  if (modeBusy || busy) return;
  modeBusy = true;
  cvs.style.opacity = 0;
  setTimeout(() => {
    viewMode = m;
    if (idx != null) { focus = idx; cam = idx; }
    cvs.style.opacity = 1;
    updateFocusUI();
    setTimeout(() => { modeBusy = false; }, 500);
  }, 500);
}

/* ============================ 지난 기록 (월별 폴더) ============================ */
function iconSVG(ic) {
  const S = SHAPES[ic.shape % SHAPES.length], sc = 36 / Math.max(S.w, S.h);
  const w = S.w * sc, h = S.h * sc, x = 24 - w / 2, y = 10, p = paintSVG(ic.color);
  const body = S.r === 'oval'
    ? `<ellipse cx="24" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${p.fill}"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * S.r}" fill="${p.fill}"/>`;
  return `<svg viewBox="0 0 48 56" aria-hidden="true">${p.defs}<g transform="rotate(${(ic.rot * 20).toFixed(1)} 24 2)">` +
    `<line x1="24" y1="0" x2="24" y2="${y}" stroke="rgb(${INK})" stroke-width="1.1"/>${body}</g></svg>`;
}
const EMPTY_ICON = `<svg viewBox="0 0 48 56" aria-hidden="true"><line x1="24" y1="0" x2="24" y2="12" stroke="rgba(${INK},.3)" stroke-width="1.1"/>` +
  `<ellipse cx="24" cy="30" rx="11" ry="16" fill="none" stroke="rgba(${INK},.3)" stroke-width="1.2" stroke-dasharray="3 4"/></svg>`;

function renderArchive() {
  const cur = Store.nowKey(), cy = +cur.slice(0, 4);
  archYear = constrain(archYear, Store.firstYear(), cy);
  $('#y-label').textContent = archYear + '년';
  $('#y-prev').disabled = archYear <= Store.firstYear();
  $('#y-next').disabled = archYear >= cy;

  const box = $('#months');
  box.innerHTML = '';
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const key = archYear + '-' + String(m).padStart(2, '0');
    const n = Store.byMonth(key).length;
    total += n;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mcard' + (key === cur ? ' now' : '') + (n ? '' : ' empty');
    b.disabled = !n && key !== cur;
    b.innerHTML = (n ? iconSVG(Store.iconOf(key)) : EMPTY_ICON) +
      `<span class="mn">${m}월</span><span class="mc">${n ? n + '개의 감정' : key === cur ? '이번 달' : '비어 있어요'}</span>`;
    b.addEventListener('click', () => { viewKey = key; go('mobile'); });
    box.appendChild(b);
  }
  $('#y-total').textContent = total ? `${archYear}년에 남긴 감정 ${total}개` : `${archYear}년에는 아직 기록이 없어요.`;
}

/* ============================ 기록 보기 ============================ */
function openDetail(id) {
  const r = Store.find(id);
  if (!r) return;
  const e = EMOTIONS.find((x) => x.k === r.emotion) || EMOTIONS[6];
  const where = COLS.find((c) => c.key === r.mobile);
  const when = new Date(r.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  $('#d-emotion').textContent = `${e.sym}  ${e.name}`;
  $('#d-meta').textContent = `${when} · ‘${where ? where.label : ''}’ 모빌`;
  $('#d-cause').textContent = r.cause || '적지 않았어요.';
  $('#d-comfort-box').hidden = !r.comfort;
  $('#d-comfort').textContent = r.comfort ? r.comfort.text : '';
  $('#btn-del').onclick = () => {
    if (confirm('이 기록을 지울까요? 되돌릴 수 없어요.')) {
      Store.remove(id); cache = {}; closeDetail(); renderMobileHead();
    }
  };
  $('#detail').hidden = false;
}

function closeDetail() {
  const d = $('#detail');
  d.classList.add('closing');
  setTimeout(() => { d.hidden = true; d.classList.remove('closing'); }, 450);
}