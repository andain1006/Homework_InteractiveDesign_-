/* sketch.js — MOODLING
 * 탭: 새 조각 / 드래그: 옮기기 / 길게 누르기: 고치기
 * 영역에 놓기: 간직하기(왼쪽) · 흘려보내기(오른쪽)
 *
 * 마우스·터치 중복을 피하려고 p5의 mouse/touch 함수 대신
 * Pointer Events 하나로 통합해서 처리해.
 */

const COLORS = ['#cfe8a9', '#d9ccf2', '#ffd2b8', '#fbe7a1', '#bccbd9'];

// 마음의 물리 법칙: wob 흔들림 크기, spd 흔들림 속도, follow 드래그 때 따라오는 속도(작을수록 무거움)
const MOTIONS = {
shaky: { wob: 0.14, spd: 0.02, follow: 0.35, drift: 0.01 },
heavy: { wob: 0.03, spd: 0.004, follow: 0.07, drift: 0.003 },
light: { wob: 0.06, spd: 0.008, follow: 0.28, drift: 0.01 },
};

const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE = 8;

// 연결: 이어진 조각은 (두 반지름 + LINK_GAP) 간격으로 서로 끌리고,
// 그 간격의 SNAP_RATIO배 이상 벌어지면 줄이 끊어져.
const LINK_GAP = 36;
const LINK_NEAR = 14;     // 이만큼 가까이 닿으면 연결 후보
const SNAP_RATIO = 1.9;
let linkTarget = null;    // 놓으면 연결될 조각

let pieces = [];
let held = null;            // 지금 잡고 있는 조각
let press = null;           // 현재 누른 상태 정보
let pressTimer = null;
let hotZone = null;         // 'keep' | 'let' | null
let editing = null;         // 고치는 중인 note
let newPos = null;          // 새 조각을 만들 위치
let pickedColor = COLORS[0];
let pickedMotion = 'light';
let undoAction = null;
let toastTimer = null;

const $ = (s) => document.querySelector(s);

/* =========================== 조각 =========================== */
class Piece {
constructor(note, fromX, fromY) {
    this.n = note;
    this.x = fromX ?? note.x * width;
    this.y = fromY ?? note.y * height;
    this.tx = this.x; this.ty = this.y;
    this.vx = 0; this.vy = 0;
    this.scale = 0.01;
    this.pulse = 0;
    this.held = false;
    this.leave = null;
    this.seed = random(1000);
}

get r() { return constrain(46 + this.n.text.length * 1.6, 46, 92); }
get m() { return MOTIONS[this.n.motion] || MOTIONS.light; }

update() {
    // 간직 / 흘려보내기 애니메이션
    if (this.leave) {
    this.leave.t += 0.045;
    this.x = lerp(this.x, this.leave.x, 0.12);
    this.y = lerp(this.y, this.leave.y, 0.12);
    this.scale = max(0, 1 - this.leave.t);
    if (this.leave.t >= 1) finishLeave(this);
    return;
    }

    this.scale = lerp(this.scale, 1, 0.12);
    this.pulse *= 0.9;

    // 잡고 있을 때: 무게에 따라 늦게 따라옴 (속도로 늘어나는 모양도 여기서 생김)
    if (this.held) {
    const nx = lerp(this.x, this.tx, this.m.follow);
    const ny = lerp(this.y, this.ty, this.m.follow);
    this.vx = nx - this.x; this.vy = ny - this.y;
    this.x = nx; this.y = ny;
    return;
    }

    // 천천히 떠다님
    const a = noise(this.seed, frameCount * 0.003) * TAU * 2;
    this.vx += cos(a) * this.m.drift;
    this.vy += sin(a) * this.m.drift;
    if (this.n.motion === 'light') this.vy -= 0.004;          // 가벼운 조각은 살짝 떠오름
    if (this.n.motion === 'shaky') { this.vx += random(-0.05, 0.05); this.vy += random(-0.05, 0.05); }

    // 조각끼리 말랑하게 밀어냄
    for (const o of pieces) {
    if (o === this || o.leave) continue;
    const dx = this.x - o.x, dy = this.y - o.y;
    const d = Math.hypot(dx, dy) || 1;
    const min = (this.r + o.r) * 0.95;
    if (d < min) {
        const push = (min - d) * 0.012;
        this.vx += (dx / d) * push;
        this.vy += (dy / d) * push;
    }
    }

    // 이어진 조각과는 줄로 연결된 듯 서로 끌어당김
    for (const o of linkedPieces(this)) {
    const dx = o.x - this.x, dy = o.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
      const f = (d - (this.r + o.r + LINK_GAP)) * 0.0025;
      this.vx += (dx / d) * f;
      this.vy += (dy / d) * f;
    }

    const damp = this.n.motion === 'heavy' ? 0.93 : 0.96;
    this.vx *= damp; this.vy *= damp;
    this.x += this.vx; this.y += this.vy;
    this.keepInside(true);
}

keepInside(bounce) {
    const r = this.r, top = 90, bottom = height - 70;
    if (this.x < r)          { this.x = r;          if (bounce) this.vx *= -0.6; }
    if (this.x > width - r)  { this.x = width - r;  if (bounce) this.vx *= -0.6; }
    if (this.y < top + r)    { this.y = top + r;    if (bounce) this.vy *= -0.6; }
    if (this.y > bottom - r) { this.y = bottom - r; if (bounce) this.vy *= -0.6; }
}

draw() {
    const { wob, spd } = this.m;
    const speed = Math.hypot(this.vx, this.vy);
    const ang = Math.atan2(this.vy, this.vx);
    const stretch = min(speed * 0.012, 0.35);
    const s = this.scale * (1 + this.pulse * 0.15);
    const r = this.r * s;

    push();
    translate(this.x, this.y);

    const ctx = drawingContext;
    ctx.shadowColor = 'rgba(74,68,88,0.18)';
    ctx.shadowBlur = this.held ? 36 : 22;
    ctx.shadowOffsetY = this.held ? 14 : 7;

    noStroke();
    fill(this.n.color);
    beginShape();
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const nz = noise(cos(a) + this.seed, sin(a) + this.seed, frameCount * spd);
      const rr = r * (1 + (nz - 0.5) * 2 * wob + stretch * cos(a - ang));
      vertex(cos(a) * rr, sin(a) * rr);
    }
    endShape(CLOSE);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // 글자
    const t = this.n.text;
    const shown = t.length > 18 ? t.slice(0, 17) + '…' : t;
    fill('#4a4458');
    textAlign(CENTER, CENTER);
    rectMode(CENTER);
    textSize(constrain(this.r * 0.2, 12, 17));
    textLeading(constrain(this.r * 0.26, 16, 22));
    text(shown, 0, 0, r * 1.45, r * 1.3);
    pop();
}

hit(px, py) { return Math.hypot(px - this.x, py - this.y) < this.r; }
}

/* =========================== p5 =========================== */
function setup() {
const c = createCanvas(windowWidth, windowHeight);
c.parent('stage');
textFont('Gowun Dodum');
Store.load();
Store.byStatus('active').forEach((n) => pieces.push(new Piece(n)));

bindPointer(c.elt);
buildComposerUI();
bindSheets();
refreshUI();
}

function draw() {
clear();
for (const p of pieces) p.update();

  // 잡고 끄는 중: 줄이 끊어지는지, 어느 조각과 이어질지 확인
linkTarget = null;
if (held && press && press.moved) {
    checkSnap(held);
    if (!hotZone) linkTarget = findLinkTarget(held);
}
drawLinks();

  // 잡은 조각이 위에 그려지도록 마지막에 그림
for (const p of pieces) if (p !== held) p.draw();
if (held) held.draw();
}

function windowResized() {
resizeCanvas(windowWidth, windowHeight);
  pieces.forEach((p) => { p.x = p.n.x * width; p.y = p.n.y * height; p.keepInside(false); });
}

/* =========================== 포인터 입력 =========================== */
function bindPointer(el) {
el.style.touchAction = 'none';
el.addEventListener('pointerdown', onDown);
el.addEventListener('pointermove', onMove);
el.addEventListener('pointerup', onUp);
el.addEventListener('pointercancel', onUp);
el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function pos(e) {
const r = e.target.getBoundingClientRect();
return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pieceAt(x, y) {
for (let i = pieces.length - 1; i >= 0; i--) {
    if (!pieces[i].leave && pieces[i].hit(x, y)) return pieces[i];
}
return null;
}

function onDown(e) {
if (isSheetOpen()) return;
e.target.setPointerCapture(e.pointerId);
const { x, y } = pos(e);
const p = pieceAt(x, y);
press = { x, y, moved: false, piece: p, longPressed: false };

if (p) {
    held = p;
    p.held = true;
    p.ox = p.x - x; p.oy = p.y - y;   // 잡은 위치 보정
    p.tx = p.x; p.ty = p.y;
    // 순서를 맨 뒤로 → 겹쳤을 때 위로
    pieces.splice(pieces.indexOf(p), 1);
    pieces.push(p);

    // 길게 누르기 → 잠시 머무르며 내용 보기·고치기
    pressTimer = setTimeout(() => {
    if (press && !press.moved) {
        press.longPressed = true;
        p.pulse = 1.2;
        p.held = false; held = null;
        if (navigator.vibrate) navigator.vibrate(15);
        openComposer(p.n, null);
    }
    }, LONG_PRESS_MS);
}
}

function onMove(e) {
if (!press) return;
const { x, y } = pos(e);
if (!press.moved && Math.hypot(x - press.x, y - press.y) > MOVE_TOLERANCE) {
    press.moved = true;
    clearTimeout(pressTimer);
    if (held) showZones(true);
}
if (held && press.moved) {
    held.tx = x + held.ox;
    held.ty = y + held.oy;
    setHot(zoneAt(x, y));
}
}

function onUp(e) {
clearTimeout(pressTimer);
if (!press) return;
const { x, y } = pos(e);
const p = press.piece;

if (held) {
    const zone = zoneAt(x, y);
    held.held = false;
    if (zone && press.moved) {
    sendAway(held, zone);
    } else if (!press.moved && !press.longPressed) {
      // 짧게 탭: 말랑하게 반응 + 전체 문장 보여주기
    held.pulse = 1;
    showToast(held.n.text);
    } else {
    held.keepInside(false);
    if (linkTarget) {
        const a = held.n.id, b = linkTarget.n.id;
        Store.link(a, b);
        held.pulse = linkTarget.pulse = 1;
        if (navigator.vibrate) navigator.vibrate(12);
        showToast('생각이 이어졌어요', () => Store.unlink(a, b));
    }
    syncPositions();
    }
} else if (!p && !press.moved && !press.longPressed) {
    openComposer(null, { x, y });   // 빈 공간 탭 → 새 조각
}

held = null; press = null; linkTarget = null;
showZones(false); setHot(null);
}

/* =========================== 연결하기 / 풀기 =========================== */
function linkedPieces(p) {
return Store.linksOf(p.n.id)
    .map((id) => pieces.find((q) => q.n.id === id && !q.leave))
    .filter(Boolean);
}

// 잡은 조각과 맞닿은, 아직 이어지지 않은 조각 중 가장 가까운 것
function findLinkTarget(p) {
let best = null, bd = Infinity;
for (const o of pieces) {
    if (o === p || o.leave || Store.hasLink(p.n.id, o.n.id)) continue;
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d < p.r + o.r + LINK_NEAR && d < bd) { best = o; bd = d; }
}
return best;
}

// 이어진 조각을 너무 멀리 끌면 줄이 끊어짐
function checkSnap(p) {
for (const o of linkedPieces(p)) {
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d > (p.r + o.r + LINK_GAP) * SNAP_RATIO) {
    const a = p.n.id, b = o.n.id;
    Store.unlink(a, b);
    p.pulse = o.pulse = 1;
    if (navigator.vibrate) navigator.vibrate(20);
    showToast('연결을 풀었어요', () => Store.link(a, b));
    }
}
}

function drawLinks() {
const ctx = drawingContext;
for (const l of Store.links()) {
    const a = pieces.find((p) => p.n.id === l.a && !p.leave);
    const b = pieces.find((p) => p.n.id === l.b && !p.leave);
    if (!a || !b) continue;

    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const rest = a.r + b.r + LINK_GAP;
    const tension = constrain((d / rest - 1) / (SNAP_RATIO - 1), 0, 1);   // 0 느슨 → 1 끊어지기 직전
    const sag = (1 - tension) * 16 * Math.sin(frameCount * 0.03 + a.seed);
    const mx = (a.x + b.x) / 2 - ((b.y - a.y) / d) * sag;
    const my = (a.y + b.y) / 2 + ((b.x - a.x) / d) * sag;
    const w = lerp(8, 1.5, tension);

    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, a.n.color);
    g.addColorStop(1, b.n.color);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.strokeStyle = 'rgba(74,68,88,0.22)'; ctx.lineWidth = w + 2.5; ctx.stroke();   // 바탕선
    ctx.strokeStyle = g; ctx.lineWidth = w; ctx.stroke();                              // 색선
    ctx.restore();
}

  // 놓으면 이어질 후보: 점선 미리보기 + 두 조각이 살짝 부풀어 오름
if (held && linkTarget) {
    ctx.save();
    ctx.setLineDash([6, 8]); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(74,68,88,0.5)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(held.x, held.y); ctx.lineTo(linkTarget.x, linkTarget.y); ctx.stroke();
    ctx.restore();
    held.pulse = max(held.pulse, 0.5);
    linkTarget.pulse = max(linkTarget.pulse, 0.5);
}
}

/* =========================== 간직하기 / 흘려보내기 =========================== */
function zoneRect(id) {
const r = $(id).getBoundingClientRect();
return { l: r.left - 16, r: r.right + 16, t: r.top - 16, b: r.bottom + 16, cx: (r.left + r.right) / 2, cy: r.bottom - 40 };
}

function zoneAt(x, y) {
for (const [name, id] of [['keep', '#zone-keep'], ['let', '#zone-let']]) {
    const z = zoneRect(id);
    if (x > z.l && x < z.r && y > z.t && y < z.b) return name;
}
return null;
}

function showZones(on) {
$('#zone-keep').classList.toggle('show', on);
$('#zone-let').classList.toggle('show', on);
}

function setHot(z) {
if (z === hotZone) return;
hotZone = z;
$('#zone-keep').classList.toggle('hot', z === 'keep');
$('#zone-let').classList.toggle('hot', z === 'let');
}

function sendAway(piece, zone) {
const z = zoneRect(zone === 'keep' ? '#zone-keep' : '#zone-let');
piece.leave = { t: 0, x: z.cx, y: z.cy, zone };
}

function finishLeave(piece) {
const status = piece.leave.zone === 'keep' ? 'archived' : 'released';
const note = Store.setStatus(piece.n.id, status);
pieces = pieces.filter((p) => p !== piece);
syncPositions();
refreshUI();
const msg = status === 'archived' ? '간직했어요' : '흘려보냈어요';
showToast(msg, () => restore(note.id));
}

function restore(id) {
const note = Store.find(id);
if (!note) return;
Store.setStatus(id, 'active');
  // 화면 가운데 근처에서 톡 튀어나옴
note.x = random(0.3, 0.7); note.y = random(0.35, 0.6);
pieces.push(new Piece(note));
Store.save();
refreshUI();
}

function syncPositions() {
pieces.forEach((p) => { if (!p.leave) { p.n.x = p.x / width; p.n.y = p.y / height; } });
Store.save();
}
window.addEventListener('pagehide', syncPositions);

/* =========================== 입력창 =========================== */
function buildComposerUI() {
const box = $('#swatches');
COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.style.background = c;
    b.setAttribute('aria-label', '색 ' + c);
    b.addEventListener('click', () => { pickedColor = c; paintPicks(); });
    box.appendChild(b);
});
document.querySelectorAll('#motions .chip').forEach((b) =>
    b.addEventListener('click', () => { pickedMotion = b.dataset.motion; paintPicks(); })
);
$('#btn-save').addEventListener('click', saveComposer);
$('#btn-cancel').addEventListener('click', closeComposer);
$('#composer').addEventListener('pointerdown', (e) => { if (e.target.id === 'composer') closeComposer(); });
$('#memo-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveComposer(); }
    if (e.key === 'Escape') closeComposer();
});
}

function paintPicks() {
document.querySelectorAll('.swatch').forEach((b, i) => b.classList.toggle('on', COLORS[i] === pickedColor));
document.querySelectorAll('#motions .chip').forEach((b) => b.classList.toggle('on', b.dataset.motion === pickedMotion));
}

function openComposer(note, at) {
editing = note; newPos = at;
pickedColor = note ? note.color : random(COLORS);
pickedMotion = note ? note.motion : 'light';
$('#memo-text').value = note ? note.text : '';
$('#composer-title').textContent = note
    ? '잠시 머물러 볼까요? 고치고 싶은 만큼만 고쳐도 돼요.'
    : '잘 정리하지 않아도 괜찮아요. 떠오르는 대로 남겨보세요.';
$('#btn-save').textContent = note ? '저장하기' : '조각 만들기';
paintPicks();
$('#composer').hidden = false;
setTimeout(() => $('#memo-text').focus(), 60);
}

function closeComposer() {
$('#composer').hidden = true;
editing = null; newPos = null;
}

function saveComposer() {
const text = $('#memo-text').value.trim();
if (!text) { closeComposer(); return; }

if (editing) {
    Store.update(editing.id, { text, color: pickedColor, motion: pickedMotion });
    const p = pieces.find((q) => q.n === editing);
    if (p) p.pulse = 1;
} else {
    const note = Store.add({
    text, color: pickedColor, motion: pickedMotion,
    x: newPos.x / width, y: newPos.y / height,
    });
    const p = new Piece(note);
    p.keepInside(false);
    pieces.push(p);
}
closeComposer();
refreshUI();
}

/* =========================== 오늘의 마음 · 보관함 =========================== */
function bindSheets() {
$('#btn-vault').addEventListener('click', () => { renderVault(); $('#vault').hidden = false; });
$('#btn-vault-close').addEventListener('click', () => ($('#vault').hidden = true));
$('#vault').addEventListener('pointerdown', (e) => { if (e.target.id === 'vault') $('#vault').hidden = true; });
}

function isSheetOpen() { return !$('#composer').hidden || !$('#vault').hidden; }

function renderVault() {
const s = Store.summary();
$('#summary').textContent =
    `남겨둔 생각 ${s.active}개 · 오늘 간직한 생각 ${s.archived}개 · 오늘 흘려보낸 생각 ${s.released}개`;
fillList('#list-archived', Store.byStatus('archived'), '아직 간직한 생각이 없어요.');
fillList('#list-released', Store.byStatus('released'), '흘려보낸 생각이 없어요.');
}

function fillList(sel, notes, emptyMsg) {
const ul = $(sel);
ul.innerHTML = '';
if (!notes.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = emptyMsg;
    ul.appendChild(li); return;
}
notes.slice().reverse().forEach((n) => {
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = n.color;
    const txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = n.text;
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '꺼내기';
    btn.addEventListener('click', () => { restore(n.id); renderVault(); });
    li.append(dot, txt, btn);
    ul.appendChild(li);
});
}

/* =========================== 공통 UI =========================== */
function refreshUI() {
const count = Store.byStatus('active').length;
$('#count-badge').textContent = count;
$('#hint').classList.toggle('quiet', count > 0);
$('#hint-text').textContent = count
    ? ''
    : '지금 머릿속에는 어떤 생각이 떠다니고 있나요? 빈 곳을 톡 눌러보세요.';
}

function showToast(msg, undo) {
clearTimeout(toastTimer);
$('#toast-msg').textContent = msg;
const u = $('#toast-undo');
u.hidden = !undo;
undoAction = undo || null;
$('#toast').hidden = false;
toastTimer = setTimeout(() => ($('#toast').hidden = true), undo ? 5000 : 2600);
}

$('#toast-undo').addEventListener('click', () => {
if (undoAction) undoAction();
undoAction = null;
$('#toast').hidden = true;
});