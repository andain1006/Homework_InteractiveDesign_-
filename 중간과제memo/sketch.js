/* sketch.js — MOODLING: 감정을 매달아 두는 시간
 * 흐름: emotion → cause → breath → place → comfort → mobile
 * 화면 전환과 글 입력은 HTML, 물방울·모빌·드래그는 p5 캔버스가 맡아.
 * 마우스/터치는 Pointer Events 하나로 통합해서 처리해.
 */

const EMOTIONS = [
{ k: 'anxious', name: '불안', sym: '〰' }, { k: 'sad', name: '우울', sym: '☁' },
{ k: 'stuffy', name: '답답함', sym: '◉' }, { k: 'regret', name: '후회', sym: '↶' },
{ k: 'burden', name: '부담', sym: '◇' }, { k: 'lonely', name: '외로움', sym: '○' },
{ k: 'unsure', name: '잘 모르겠음', sym: '…' },
];

// 세 개의 모빌: 곧은 낮고 실이 짧게, 언젠간은 높고 실이 길고 천천히 크게 흔들려
const COLS = [
{ key: 'soon',    label: '곧',     sub: '내일 다시 살펴볼 수 있어',       barY: 0.34, len: [38, 66],  swing: 0.10 },
{ key: 'later',   label: '조만간', sub: '지금 당장 하지 않아도 괜찮아',   barY: 0.26, len: [64, 110], swing: 0.08 },
{ key: 'someday', label: '언젠간', sub: '지금 당장 답을 찾지 않아도 돼',  barY: 0.16, len: [96, 160], swing: 0.06 },
];

const PHRASES = [
'내일 천천히 다시 생각해 보자.', '지금 당장 답을 찾지 않아도 괜찮아.',
'시간이 조금 더 필요할 뿐이야.', '나는 이 순간을 지나갈 수 있어.',
];
const SPEEDS = { slow: [5, 7], normal: [4, 6], fast: [3, 4] };   // [들이쉬기, 내쉬기] 초
const ORDER = ['emotion', 'cause', 'breath', 'place', 'comfort'];
const $ = (s) => document.querySelector(s);

let step = 'emotion';
let draft = null;                          // 지금 만드는 기록 (저장 전)
let drag = { x: 0, y: 0, ox: 0, oy: 0, on: false };
let hotCol = null, hits = [], anim = {};   // anim: 오브제별 흔들림 충격값
let pressing = false, down = null;
let breath = { t: 0, r: 0, speed: 'normal', done: false, text: '' };

/* ============================ p5 ============================ */
function setup() {
const c = createCanvas(windowWidth, windowHeight);
c.parent('stage');
textFont('Gowun Dodum');
Store.load();
const el = c.elt;
el.style.touchAction = 'none';
el.addEventListener('pointerdown', onDown);
el.addEventListener('pointermove', onMove);
el.addEventListener('pointerup', onUp);
el.addEventListener('pointercancel', onUp);
el.addEventListener('contextmenu', (e) => e.preventDefault());
bindUI();
go('emotion');
}

function draw() {
clear();
if (step === 'breath') drawBreath();
else if (step === 'place' || step === 'comfort' || step === 'mobile') drawMobiles();
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

/* ============================ 화면 전환 ============================ */
function go(s) {
step = s;
document.querySelectorAll('.step').forEach((el) => (el.hidden = el.id !== 's-' + s));
const i = ORDER.indexOf(s);
$('#dots').hidden = i < 0;
document.querySelectorAll('#dots li').forEach((li, n) => li.classList.toggle('on', n === i));

if (s === 'emotion') $('#btn-to-mobile').hidden = Store.all().length === 0;
if (s === 'breath') { breath.t = 0; breath.done = false; breath.text = ''; breath.r = 0; }
if (s === 'place') { drag = { x: width / 2, y: height - 170, ox: 0, oy: 0, on: false }; hotCol = null; }
if (s === 'cause') setTimeout(() => $('#cause-text').focus(), 80);
}

function bindUI() {
  // 01 감정 선택
const box = $('#emotions');
EMOTIONS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'emo';
    b.innerHTML = `<b>${e.sym}</b><span>${e.name}</span>`;
    b.addEventListener('click', () => {
    draft = { ...Store.look(), emotion: e.k, cause: '', mobile: null, id: 'draft', comfort: null };
    $('#chosen').textContent = `${e.sym}  ${e.name}`;
    $('#cause-text').value = '';
    go('cause');
    });
    box.appendChild(b);
});
$('#btn-to-mobile').addEventListener('click', () => go('mobile'));

  // 02 원인
$('#btn-cause-back').addEventListener('click', () => go('emotion'));
$('#btn-cause-next').addEventListener('click', () => { draft.cause = $('#cause-text').value.trim(); go('breath'); });

  // 03 호흡
$('#btn-breath-next').addEventListener('click', () => go('place'));
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
    go('mobile');
});

  // 모빌 보기
$('#btn-new').addEventListener('click', () => go('emotion'));
$('#btn-clear').addEventListener('click', () => {
    if (confirm('저장된 감정 기록을 모두 지울까요? 되돌릴 수 없어요.')) { Store.clear(); anim = {}; }
});
$('#btn-close').addEventListener('click', () => ($('#detail').hidden = true));
$('#detail').addEventListener('pointerdown', (e) => { if (e.target.id === 'detail') $('#detail').hidden = true; });
}

// 쓰는 동안 작은 위로 오브제가 모빌에 미리 매달려 보임
function syncComfort() {
const t = $('#comfort-text').value.trim();
draft.comfort = t ? { text: t } : null;
}

/* ============================ 포인터 ============================ */
const colAt = (x) => COLS[constrain(floor(x / (width / 3)), 0, 2)].key;
function pos(e) { const r = e.target.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function onDown(e) {
e.target.setPointerCapture(e.pointerId);
const { x, y } = pos(e);
down = { x, y, moved: false };
if (step === 'breath') { pressing = true; breath.t = 0; }
else if (step === 'place' && draft && !draft.mobile && Math.hypot(x - drag.x, y - drag.y) < draft.size + 24) {
    drag.on = true; drag.ox = drag.x - x; drag.oy = drag.y - y;
}
}

function onMove(e) {
if (!down) return;
const { x, y } = pos(e);
if (Math.hypot(x - down.x, y - down.y) > 8) down.moved = true;
if (drag.on) {
    drag.x = x + drag.ox; drag.y = y + drag.oy;
    hotCol = drag.y < height - 130 ? colAt(drag.x) : null;
}
}

function onUp(e) {
if (!down) return;
const { x, y } = pos(e);
pressing = false;
if (drag.on) {
    drag.on = false;
    if (hotCol) { draft.mobile = hotCol; kick('draft', 0.5); go('comfort'); }   // 놓은 자리에 매달림
    hotCol = null;
} else if (step === 'mobile' && !down.moved) {
    const h = [...hits].reverse().find((o) => Math.hypot(x - o.x, y - o.y) < o.r);
    if (h) { kick(h.id, 0.5); openDetail(h.id); }
}
down = null;
}

/* ============================ 호흡 물방울 ============================ */
// 선택한 속도에 맞춰 안내 문구의 초(秒)를 바꿈
function updateGuide() {
const [inh, exh] = SPEEDS[breath.speed];
$('#g-in').textContent = inh;
$('#g-out').textContent = exh;
}

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

  const cx = width / 2, cy = height * 0.46, r = breath.r, ctx = drawingContext, t = frameCount;
  const amp = pressing ? 0.02 : 0.045;   // 가만히 있을 때도 미세하게 일렁임

  // 퍼져 나가는 물결
ctx.lineWidth = 1.5;
for (let k = 0; k < 3; k++) {
    const f = (t * 0.003 + k / 3) % 1;
    ctx.strokeStyle = `rgba(169,198,213,${(1 - f) * 0.3})`;
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.05 + f * 0.6), 0, TWO_PI); ctx.stroke();
}

  // 물방울 본체
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.1);
g.addColorStop(0, 'rgba(255,255,255,.85)');
g.addColorStop(0.55, 'rgba(169,198,213,.55)');
g.addColorStop(1, 'rgba(169,198,213,.2)');
ctx.fillStyle = g;
ctx.beginPath();
for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * TWO_PI;
    const rr = r * (1 + (noise(Math.cos(a) + 5, Math.sin(a) + 5, t * 0.012) - 0.5) * 2 * amp);
    i ? ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
}
ctx.closePath(); ctx.fill();

noStroke(); fill(31, 30, 54, 170); textAlign(CENTER, CENTER); textSize(16);
text(word, cx, cy);
}

/* ============================ 모빌 ============================ */
const kick = (id, v) => (anim[id] = v);
const hash = (id) => ([...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % 1000) / 1000;

// 6가지 기하 도형
function drawObj(k, x, y, r, rot, col, alpha) {
const ctx = drawingContext;
push(); translate(x, y); rotate(rot); noStroke();
ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  const c = color(col); c.setAlpha(alpha * 255); fill(c);
  if (k === 0) ellipse(0, 0, r * 2);
  else if (k === 1) { rectMode(CENTER); rect(0, 0, r * 1.7, r * 1.7, r * 0.15); }
else {
    const n = [0, 0, 3, 6, 10, 4][k];
    beginShape();
    for (let i = 0; i < n; i++) {
      const a = -HALF_PI + (i * TWO_PI) / n;
      const rr = k === 4 && i % 2 ? r * 0.45 : r;
      vertex(Math.cos(a) * rr * (k === 5 ? 0.75 : 1), Math.sin(a) * rr);
    }
    endShape(CLOSE);
}
ctx.shadowColor = 'transparent';
pop();
}

function drawMobiles() {
hits = [];
const t = millis() / 1000, cw = width / 3;
const list = Store.all().slice();
if (draft && draft.mobile) list.push(draft);
  const ghost = step === 'mobile' ? 1 : 0.35;    // 새 감정을 정리하는 동안 기존 모빌은 흐릿하게

COLS.forEach((c, ci) => {
    const cx = cw * (ci + 0.5), by = height * c.barY, tilt = 0.025 * Math.sin(t * 0.5 + ci * 2);
    const half = cw * 0.4;

    if (step === 'place' && hotCol === c.key) {
    noStroke(); fill(255, 255, 255, 24); rectMode(CORNER);
      rect(cw * ci + 8, 0, cw - 16, height - 130, 26);
    }
    // 천장 실 + 가로대
    stroke(242, 238, 251, 110); strokeWeight(1.5);
    line(cx, 0, cx, by);
    line(cx - half * Math.cos(tilt), by - half * Math.sin(tilt), cx + half * Math.cos(tilt), by + half * Math.sin(tilt));

    const items = list.filter((r) => r.mobile === c.key), n = items.length;
    const sp = n > 1 ? Math.min((half * 2) / (n - 1), 64) : 0;

    items.forEach((r, i) => {
    const al = r === draft ? 1 : ghost, h = hash(r.id), k = anim[r.id] || 0;
      const dx = (i - (n - 1) / 2) * sp, ax = cx + dx * Math.cos(tilt), ay = by + dx * Math.sin(tilt);
      const L = c.len[0] + (i % 2) * (c.len[1] - c.len[0]) + h * 14, R = r.size;
      const a = c.swing * Math.sin(t * (0.6 + h * 0.4) + h * 6) + k * Math.sin(t * 6);
      const mx = ax + Math.sin(a) * (L + R), my = ay + Math.cos(a) * (L + R);

      stroke(242, 238, 251, 120 * al); strokeWeight(1.2);
      line(ax, ay, mx - Math.sin(a) * R, my - Math.cos(a) * R);
    drawObj(r.shape, mx, my, R, r.rot + a, r.color, al);
    if (step === 'mobile') hits.push({ id: r.id, x: mx, y: my, r: R + 10 });

      // 메인 오브제에 매달린 작은 위로 오브제
    if (r.comfort && r.comfort.text) {
        const a2 = 0.14 * Math.sin(t * 1.2 + h * 5) + k * Math.sin(t * 6 + 1), r2 = R * 0.5;
        stroke(242, 238, 251, 120 * al);
        line(mx + Math.sin(a2) * R, my + Math.cos(a2) * R, mx + Math.sin(a2) * (R + 34), my + Math.cos(a2) * (R + 34));
        const px = mx + Math.sin(a2) * (R + 34 + r2), py = my + Math.cos(a2) * (R + 34 + r2);
        drawObj(r.shape, px, py, r2, -r.rot - a2, r.color, al);
        if (step === 'mobile') hits.push({ id: r.id, x: px, y: py, r: r2 + 10 });
    }
    });

    // 모빌 이름
    noStroke(); rectMode(CENTER); textAlign(CENTER, CENTER);
    fill(242, 238, 251, step === 'place' && hotCol === c.key ? 255 : 210);
    textSize(20); text(c.label, cx, height - 112);
    fill(179, 173, 208); textSize(12); text(c.sub, cx, height - 86, cw - 14, 34);
});

  // 끌고 있는(아직 걸리지 않은) 감정 오브제
if (step === 'place' && draft && !draft.mobile) {
    if (!drag.on) {
    drag.x = lerp(drag.x, width / 2, 0.1);
      drag.y = lerp(drag.y, height - 170 + Math.sin(t * 2) * 5, 0.1);
    }
    drawObj(draft.shape, drag.x, drag.y, draft.size * (drag.on ? 1.15 : 1), draft.rot + Math.sin(t) * 0.1, draft.color, 1);
}

if (step === 'mobile' && !list.length) {
    fill(179, 173, 208); textSize(15); textAlign(CENTER, CENTER);
    text('아직 매달린 감정이 없어요.', width / 2, height * 0.5);
}
  for (const id in anim) anim[id] *= 0.97;
}

/* ============================ 기록 보기 ============================ */
function openDetail(id) {
const r = Store.find(id);
if (!r) return;
const e = EMOTIONS.find((x) => x.k === r.emotion) || EMOTIONS[6];
const where = COLS.find((c) => c.key === r.mobile);
const when = new Date(r.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
$('#d-emotion').textContent = `${e.sym}  ${e.name}`;
$('#d-meta').textContent = `${when} · ‘${where ? where.label : ''}’ 모빌`;
$('#d-cause').textContent = r.cause || '적지 않았어요.';
$('#d-comfort-box').hidden = !r.comfort;
$('#d-comfort').textContent = r.comfort ? r.comfort.text : '';
$('#btn-del').onclick = () => {
    if (confirm('이 기록을 지울까요? 되돌릴 수 없어요.')) { Store.remove(id); $('#detail').hidden = true; }
};
$('#detail').hidden = false;
}