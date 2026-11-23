/* ==========================================================
 * 나:옴 — sketch.js
 *  1. 현관 카메라 + 몸짓 인식 (p5.js + ml5.js)
 *       손 흔들기 = 외출(나옴) · V 흔들기 = 귀가(나 옴) · 주먹 내밀기 = 운동
 *  2. 몸짓 순간의 짧은 영상 녹화 (MediaRecorder)
 *  3. 화면(UI): 메모, 기록(현관 브이로그·캘린더), 설정
 * ========================================================== */

/* ---------- 조절하기 쉬운 값 ---------- */
let camW = 640, camH = 480; // 실제 카메라 크기로 바뀌어요 (폰 세로 화면이면 480×640 등)
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
const WAVE_WINDOW = 1600;   // 이 시간(ms) 안에서 흔들기를 셉니다
const WAVE_STEP = 28;       // 손목이 이만큼(px) 움직여야 한 번 움직인 걸로 봐요
const WAVE_NEEDED = 2;      // 좌→우→좌처럼 방향이 2번 바뀌면 "흔들었다"
const SHAPE_GRACE = 350;    // 흔드는 중 손 모양이 잠깐 흐려져도 봐주는 시간
const FIST_HOLD = 800;      // 주먹을 이만큼(ms) 내밀고 있으면 '운동'으로 인정
const COOLDOWN = 4000;      // 한 번 기록한 뒤 쉬는 시간
const CLIP_TAIL = 1200;     // 몸짓 뒤에 조금 더 찍는 시간
const IDLE_CLIP_MAX = 4000; // 몸짓이 없으면 미리 찍던 영상을 버리는 시간
const WHO_TIMEOUT = 5000;   // "누구예요?" 기다리는 시간

const TYPES = {
  out:  { label: '외출', say: '나옴',          emoji: '👋', color: '#E2703A' },
  home: { label: '귀가', say: '나 옴',         emoji: '✌️', color: '#2F8F7A' },
  gym:  { label: '운동', say: '운동 다녀올게', emoji: '👊', color: '#4C6BD6' },
};

const CHAINS = [
  ['wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip'],
  ['wrist', 'index_finger_mcp', 'index_finger_pip', 'index_finger_dip', 'index_finger_tip'],
  ['wrist', 'middle_finger_mcp', 'middle_finger_pip', 'middle_finger_dip', 'middle_finger_tip'],
  ['wrist', 'ring_finger_mcp', 'ring_finger_pip', 'ring_finger_dip', 'ring_finger_tip'],
  ['wrist', 'pinky_finger_mcp', 'pinky_finger_pip', 'pinky_finger_dip', 'pinky_finger_tip'],
];
const FINGERS = ['index_finger', 'middle_finger', 'ring_finger', 'pinky_finger'];

/* ---------- 상태 ---------- */
let video = null, videoReady = false;
let handPose = null, handReady = false, handRunning = false, hands = [];
let fistStart = 0; // 주먹을 내밀기 시작한 시각
let doorActive = false, guestMode = false;
let cooldownUntil = 0, firing = false;
let wave = { hist: [], shape: null, lastSeen: 0 };
let rec = null; // 지금 녹화 중인 클립

/* ==========================================================
 * 1. p5.js
 * ========================================================== */
function setup() {
  const stage = document.getElementById('stage');
  const c = createCanvas(Math.max(stage.clientWidth, 10), Math.max(stage.clientHeight, 10));
  c.parent('stage');
  pixelDensity(1);
  textFont('Pretendard');
  noLoop();
  UI.init();
}

function windowResized() { resizeStage(); }

function resizeStage() {
  const st = document.getElementById('stage');
  if (!st || !st.clientWidth) return;
  resizeCanvas(st.clientWidth, st.clientHeight);
}

function draw() {
  if (!doorActive) return;
  background(28, 24, 20);
  if (!videoReady) return;

  // 영상을 화면에 꽉 차게 (cover)
  const s = Math.max(width / camW, height / camH);
  const ox = (width - camW * s) / 2, oy = (height - camH * s) / 2;
  image(video, ox, oy, camW * s, camH * s);
  if (guestMode) return;

  const now = millis();
  const hand = hands && hands[0];
  let shape = 'none';
  if (hand) {
    shape = handShape(hand);
    drawHand(hand, s, ox, oy, shape);
  }
  const waves = trackWave(hand, shape, now);

  // 몸짓 판정
  if (now > cooldownUntil && !firing) {
    if (waves >= WAVE_NEEDED && wave.shape === 'palm') fireGesture('out');
    else if (waves >= WAVE_NEEDED && wave.shape === 'v') fireGesture('home');
    else if (shape === 'fist') {
      if (!fistStart) fistStart = now;
      if (now - fistStart > FIST_HOLD) fireGesture('gym');
    }
  }
  if (shape !== 'fist') fistStart = 0;

  // 누군가 카메라 앞에 있으면 미리 녹화를 시작 → 몸짓하는 모습까지 담겨요
  const someone = !!hand;
  if (someone && !rec && now > cooldownUntil && !firing) startClip();
  if (rec && !rec.keep && now - rec.startedAt > IDLE_CLIP_MAX) stopClip();

  drawHud(now, shape, waves);
}

function keyPressed() {
  // 테스트용: 1 외출 · 2 귀가 · 3 운동
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (!doorActive || guestMode || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  const map = { '1': 'out', '2': 'home', '3': 'gym' };
  if (map[key]) demoFire(map[key]);
}

/* ---------- 현관 켜기/끄기 ---------- */
function startDoor() {
  doorActive = true;
  resizeStage();
  loop();
  keepAwake(true);
  if (!video) {
    setCamMsg('카메라를 켜는 중…');
    // 폰에서는 앞(셀카) 카메라를 써요
    video = createCapture({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    }, { flipped: true });
    video.hide();
    video.elt.setAttribute('playsinline', '');
    video.elt.setAttribute('muted', '');
    video.elt.muted = true;
    video.elt.addEventListener('loadeddata', () => {
      // 실제 카메라 크기에 맞추기 (폰을 세로로 세우면 세로 영상이 와요)
      camW = video.elt.videoWidth || 640;
      camH = video.elt.videoHeight || 480;
      video.size(camW, camH);
      document.querySelector('.stage-wrap').style.aspectRatio = `${camW} / ${camH}`;
      resizeStage();
      videoReady = true;
      setCamMsg(handReady ? '' : '몸짓 인식 준비 중…');
      startDetect();
    });
    setTimeout(() => {
      if (videoReady) return;
      const insecure = !window.isSecureContext;
      setCamMsg(insecure
        ? '폰에서는 https 주소에서만 카메라가 켜져요. GitHub Pages나 Netlify에 올린 주소로 열어 주세요.'
        : '카메라를 쓸 수 없어요. 브라우저 설정에서 카메라 권한을 허용해 주세요.');
    }, 8000);
    // 폰은 가벼운 모델(lite)로 빠르게
    handPose = ml5.handPose({ maxHands: 1, flipped: true, modelType: IS_MOBILE ? 'lite' : 'full' }, () => {
      handReady = true;
      if (videoReady) setCamMsg('');
      startDetect();
    });
  } else {
    if (video.elt.paused) video.elt.play().catch(() => {});
    startDetect();
  }
}

function pauseDoor() {
  doorActive = false;
  stopDetect();
  stopClip();
  noLoop();
  keepAwake(false);
}

// 현관에 붙여 둔 폰 화면이 꺼지지 않게
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* 배터리 절약 모드 등에서는 안 될 수 있어요 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !doorActive) return;
  keepAwake(true);
  if (video && video.elt.paused) video.elt.play().catch(() => {});
});

function startDetect() {
  if (!doorActive || !videoReady || guestMode) return;
  if (handReady && !handRunning) {
    handPose.detectStart(video, r => { hands = r; });
    handRunning = true;
  }
}

function stopDetect() {
  if (handRunning) { handPose.detectStop(); handRunning = false; }
  hands = [];
  fistStart = 0;
}

function setCamMsg(msg) {
  const el = document.getElementById('camMsg');
  el.textContent = msg;
  el.hidden = !msg;
}

/* ---------- 손 모양 판단 ---------- */
function kp(hand, name) {
  return hand.keypoints.find(k => k.name === name);
}

function fingerOpen(hand, finger) {
  const w = kp(hand, 'wrist'), pip = kp(hand, finger + '_pip'), tip = kp(hand, finger + '_tip');
  if (!w || !pip || !tip) return false;
  // 손가락 끝이 가운데 마디보다 손목에서 충분히 멀면 "펴짐"
  return dist(w.x, w.y, tip.x, tip.y) > dist(w.x, w.y, pip.x, pip.y) * 1.15;
}

function handShape(hand) {
  const open = FINGERS.map(f => fingerOpen(hand, f));
  if (open.every(Boolean)) return 'palm';
  if (open[0] && open[1] && !open[2] && !open[3]) return 'v';
  if (!open.some(Boolean)) return 'fist'; // 네 손가락이 모두 접힘 = 주먹
  return 'other';
}

// 손목의 좌우 움직임에서 방향이 몇 번 바뀌었는지 셉니다
function trackWave(hand, shape, now) {
  const ok = shape === 'palm' || shape === 'v';
  if (ok) {
    if (shape !== wave.shape) { wave.hist = []; wave.shape = shape; }
    wave.lastSeen = now;
    const w = kp(hand, 'wrist');
    if (w) wave.hist.push({ t: now, x: w.x });
  } else if (now - wave.lastSeen > SHAPE_GRACE) {
    wave.hist = [];
    wave.shape = null;
  }
  wave.hist = wave.hist.filter(p => now - p.t < WAVE_WINDOW);

  let changes = 0, dir = 0;
  let anchor = wave.hist.length ? wave.hist[0].x : 0;
  for (const p of wave.hist) {
    const d = p.x - anchor;
    if (Math.abs(d) >= WAVE_STEP) {
      const nd = Math.sign(d);
      if (dir && nd !== dir) changes++;
      dir = nd;
      anchor = p.x;
    }
  }
  return changes;
}

/* ---------- 그리기 ---------- */
function drawHand(hand, s, ox, oy, shape) {
  const col = shape === 'palm' ? TYPES.out.color : shape === 'v' ? TYPES.home.color : '#F5EFE6';
  stroke(col);
  strokeWeight(3);
  noFill();
  for (const chain of CHAINS) {
    beginShape();
    for (const n of chain) {
      const p = kp(hand, n);
      if (p) vertex(ox + p.x * s, oy + p.y * s);
    }
    endShape();
  }
  noStroke();
  fill(col);
  for (const p of hand.keypoints) circle(ox + p.x * s, oy + p.y * s, 7);
}

function pill(x, y, label, bg) {
  textSize(17);
  textAlign(LEFT, CENTER);
  const w = textWidth(label) + 28;
  const c = color(bg);
  c.setAlpha(225);
  noStroke();
  fill(c);
  rect(x, y, w, 38, 19);
  fill(255);
  text(label, x + 14, y + 20);
  return w;
}

function drawHud(now, shape, waves) {
  const pad = 16;
  if (shape === 'palm' || shape === 'v') {
    const t = shape === 'palm' ? TYPES.out : TYPES.home;
    const w = pill(pad, pad, `${t.emoji}  좌우로 흔들면 '${t.say}'`, t.color);
    // 흔들기 진행 점
    for (let i = 0; i < WAVE_NEEDED; i++) {
      fill(i < waves ? 255 : 'rgba(255,255,255,0.3)');
      circle(pad + w + 16 + i * 18, pad + 19, 11);
    }
  } else if (shape === 'fist') {
    const w = pill(pad, pad, `${TYPES.gym.emoji}  그대로 잠깐! '${TYPES.gym.say}'`, TYPES.gym.color);
    // 얼마나 더 내밀고 있으면 되는지 채워지는 원
    const k = fistStart ? Math.min(1, (now - fistStart) / FIST_HOLD) : 0;
    const cx = pad + w + 22, cy = pad + 19;
    noFill();
    stroke('rgba(255,255,255,0.3)');
    strokeWeight(4);
    circle(cx, cy, 22);
    stroke(255);
    if (k > 0) arc(cx, cy, 22, 22, -HALF_PI, -HALF_PI + TWO_PI * k);
    noStroke();
  } else if (shape === 'other') {
    pill(pad, pad, '손바닥 · V · 주먹 중 하나를 보여주세요', '#3a332c');
  }

  if (rec) {
    fill('#E5484D');
    noStroke();
    circle(width - pad - 52, pad + 19, 12);
    fill(255);
    textSize(14);
    textAlign(LEFT, CENTER);
    text('REC', width - pad - 42, pad + 20);
  }
  if (now < cooldownUntil && !firing) {
    fill('rgba(255,255,255,0.75)');
    textSize(14);
    textAlign(CENTER, BOTTOM);
    text('잠깐 쉬는 중…', width / 2, height - pad);
  }
}

/* ==========================================================
 * 2. 녹화와 기록
 * ========================================================== */
const MIME = (() => {
  if (!window.MediaRecorder) return null;
  // mp4를 먼저: 안드로이드에서 찍은 영상을 아이폰에서도 볼 수 있게
  const list = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find(t => MediaRecorder.isTypeSupported(t)) || '';
})();

function camStream() {
  return video && video.elt ? video.elt.srcObject : null;
}

function startClip() {
  const stream = camStream();
  if (!stream || MIME === null) return;
  try {
    const mr = MIME
      ? new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 600000 })
      : new MediaRecorder(stream);
    const chunks = [];
    const clip = { mr, startedAt: millis(), keep: false };
    clip.done = new Promise(res => {
      mr.onstop = () => res(chunks.length ? new Blob(chunks, { type: mr.mimeType || 'video/webm' }) : null);
    });
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.start();
    rec = clip;
  } catch (e) {
    console.warn('녹화를 시작하지 못했어요', e);
    rec = null;
  }
}

function stopClip() {
  if (!rec) return Promise.resolve(null);
  const c = rec;
  rec = null;
  if (c.mr.state !== 'inactive') c.mr.stop();
  return c.done;
}

function demoFire(type) {
  if (firing || millis() < cooldownUntil) return;
  if (!rec) startClip();
  setTimeout(() => fireGesture(type), 400);
}

async function fireGesture(type) {
  if (firing) return;
  firing = true;
  cooldownUntil = millis() + COOLDOWN;
  wave.hist = [];
  fistStart = 0;
  UI.flash(type);

  // 몸짓 뒤 조금 더 찍고 녹화 끝내기
  let clipPromise = Promise.resolve(null);
  if (rec) {
    const c = rec;
    c.keep = true;
    clipPromise = new Promise(res => setTimeout(() => {
      if (rec === c) rec = null;
      if (c.mr.state !== 'inactive') c.mr.stop();
      c.done.then(res);
    }, CLIP_TAIL));
  }

  try {
    const [memberId, blob] = await Promise.all([resolveActor(type), clipPromise]);
    await Naom.addLog({ type, memberId, video: blob });
    UI.toast(`${Naom.nameOf(memberId)} · ${TYPES[type].say} 기록했어요`, type);
  } catch (e) {
    console.error(e);
    UI.toast('기록을 저장하지 못했어요', 'err');
  }
  firing = false;
  cooldownUntil = Math.max(cooldownUntil, millis() + 1500);
}

// 누가 했는지: 상태로 먼저 추측하고, 헷갈릴 때만 물어봐요
// (귀가 → 지금 밖에 있는 사람, 외출·운동 → 지금 집에 있는 사람)
async function resolveActor(type) {
  const status = await Naom.getStatus();
  const kids = Naom.members().filter(m => m.role === 'kid');
  const atHome = id => !status[id] || status[id].type === 'home';
  const cands = type === 'home' ? kids.filter(m => !atHome(m.id)) : kids.filter(m => atHome(m.id));
  if (cands.length === 1) return cands[0].id;
  return UI.askWho(type, kids);
}

/* ==========================================================
 * 3. 화면(UI)
 * ========================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(n).padStart(2, '0');
const hhmm = ts => { const d = new Date(ts); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function keyToDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function longDate(key) { const d = keyToDate(key); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; }
function shortDay(ts) {
  const k = Naom.dateKey(ts), today = Naom.dateKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (k === today) return '오늘';
  if (k === Naom.dateKey(y)) return '어제';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const UI = {
  view: null,
  dayKey: null,
  monthKey: null,
  memoKind: 'visit',
  attach: null,
  loc: null,
  dayLogs: [],
  urls: {},
  wipeArmed: false,

  init() {
    this.dayKey = Naom.dateKey(new Date());
    this.monthKey = this.dayKey.slice(0, 7);
    Naom.onChange(msg => this.onChange(msg));
    $$('[data-view]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.view)));
    this.bindDoor();
    this.bindMemo();
    this.bindLog();
    this.bindSettings();
    this.bindWelcome();
    this.refreshMe();
    this.applyMode();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').then(r => { this.swReg = r; }).catch(() => {});
    }
    this.bindLogin();
    this.bindCamera();
    Naom.onAuth(state => this.onAuth(state));
    Naom.startAuth();
  },

  /* ---------- 구글 로그인 ----------
   * 가족 공유 모드(Firebase)에서는 우리 가족 계정 4개만 들어올 수 있어요.
   * 체험 모드(Firebase 없이)에서는 로그인 없이 '누가 쓰는 폰'만 골라요. */
  bindLogin() {
    $('#loginBtn').addEventListener('click', async () => {
      const btn = $('#loginBtn');
      btn.disabled = true;
      btn.textContent = '로그인 중…';
      try { await Naom.signIn(); }
      catch (e) { $('#loginMsg').textContent = '로그인하지 못했어요: ' + (e.code || e.message); }
      finally { btn.disabled = false; btn.textContent = '구글 계정으로 로그인'; }
    });
    $('#loginOther').addEventListener('click', () => Naom.signOut());
    $('#signOutBtn').addEventListener('click', () => Naom.signOut());
  },

  onAuth(state) {
    const box = $('#login');
    const msg = $('#loginMsg');
    if (state.status === 'demo' || state.status === 'ok') {
      box.hidden = true;
      this.boot();
      return;
    }
    box.hidden = false;
    $('#loginBtn').hidden = state.status === 'denied' || state.status === 'loading';
    $('#loginOther').hidden = state.status !== 'denied';
    if (state.status === 'loading') {
      $('#loginTitle').textContent = '불러오는 중…';
      msg.textContent = '';
    } else if (state.status === 'denied') {
      $('#loginTitle').textContent = '우리 가족 계정이 아니에요';
      msg.textContent = `${state.email} 계정은 나:옴에 등록되어 있지 않아요. 가족 계정으로 다시 로그인해 주세요.`;
    } else if (state.status === 'error') {
      $('#loginTitle').textContent = '연결하지 못했어요';
      msg.textContent = `${state.error}. 인터넷 연결과 Firebase 설정(README의 가족 명단 만들기)을 확인한 뒤 새로고침해 주세요.`;
      $('#loginBtn').hidden = true;
      $('#loginOther').hidden = false;
    } else {
      $('#loginTitle').textContent = '우리 가족만 들어올 수 있어요';
      msg.textContent = state.error
        ? `로그인하지 못했어요 (${state.error})`
        : '엄마 · 아빠 · 오빠 · 나, 네 개의 구글 계정으로만 로그인돼요.';
    }
  },

  async boot() {
    if (this.booted) return;
    this.booted = true;
    this.refreshMe();
    this.applyMode();
    this.updateMemoPreview();
    this.prefs = await Naom.getPrefs();
    if (Naom.isFirstRun()) this.openWelcome();
    else this.show(this.defaultView());
  },

  // 현관 기기 ↔ 들고 다니는 폰: 첫 탭이 '현관(카메라)' 또는 '우리 집(요약)'이 돼요
  // 기기 용도에 따라 보이는 화면이 달라요
  //  - 현관 기기(아이패드): 현관 화면만 (설정은 오른쪽 위 작은 버튼)
  //  - 가족 폰: 메모 · 기록 · 설정
  //  - 나·오빠 폰: 메모 · 기록 · 설정
  //  - 엄마·아빠 폰: 기록 · 설정 (귀가 알림)
  applyMode() {
    const st = Naom.getSettings();
    document.body.dataset.mode = st.mode;
    document.body.dataset.role = this.isParent() ? 'parent' : 'kid';
    document.body.dataset.auth = Naom.cloud ? 'cloud' : 'demo';
  },
  isDoor() { return Naom.getSettings().mode === 'door'; },
  isParent() { return Naom.role(Naom.getSettings().user) === 'parent'; },
  defaultView() {
    if (this.isDoor()) return 'door';
    return this.isParent() ? 'log' : 'memo'; // 부모님은 기록부터
  },
  allowed(name) {
    if (this.isDoor()) return ['door', 'settings'].includes(name);
    if (this.isParent()) return ['log', 'settings'].includes(name);
    return ['memo', 'log', 'settings'].includes(name);
  },

  /* ---------- 처음 열었을 때 ---------- */
  bindWelcome() {
    // 휴대폰이면 '가족 폰', 아이패드·컴퓨터면 '현관 기기'를 먼저 골라 둬요
    const isPhone = /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent);
    this.welcomePick = { user: null, mode: isPhone ? 'phone' : 'door' };
    $('#welcomeWho').addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      this.welcomePick.user = b.dataset.id;
      $$('#welcomeWho button').forEach(x => x.classList.toggle('active', x === b));
      // 부모님은 보통 '들고 다니는 폰'
      const m = Naom.member(b.dataset.id);
      if (m && m.role === 'parent') this.pickWelcomeMode('phone');
      this.updateWelcomeGo();
    });
    $('#welcomeMode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (b) this.pickWelcomeMode(b.dataset.mode);
    });
    $('#welcomeGo').addEventListener('click', () => {
      const { user, mode } = this.welcomePick;
      if (!user && mode !== 'door' && !Naom.cloud) return;
      Naom.saveSettings(user ? { user, mode } : { mode });
      $('#welcome').hidden = true;
      this.refreshMe();
      this.applyMode();
      this.updateMemoPreview();
      this.show(this.defaultView());
    });
  },
  pickWelcomeMode(mode) {
    this.welcomePick.mode = mode;
    $$('#welcomeMode button').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
    // 현관 기기는 '누가'를 고르지 않아도 돼요
    $('#welcomeWhoBox').hidden = mode === 'door' || Naom.cloud; // 로그인했으면 누구인지 이미 알아요
    this.updateWelcomeGo();
  },
  updateWelcomeGo() {
    $('#welcomeGo').disabled = !(this.welcomePick.mode === 'door' || this.welcomePick.user || Naom.cloud);
  },
  openWelcome() {
    $('#welcomeWho').innerHTML = Naom.members().map(m =>
      `<button type="button" data-id="${m.id}"><span>${m.emoji}</span>${esc(m.name)}</button>`).join('');
    this.pickWelcomeMode(this.welcomePick.mode);
    $('#welcome').hidden = false;
  },

  show(name) {
    if (!this.allowed(name)) name = this.defaultView();
    this.view = name;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'door') startDoor();
    else pauseDoor();
    if (name === 'door') this.renderDoor();
    window.scrollTo(0, 0);
    if (name === 'memo') this.renderMemos();
    if (name === 'log') this.renderLog();
    if (name === 'settings') this.renderSettings();
  },

  async onChange(msg) {
    if (msg.kind === 'prefs') {
      this.prefs = await Naom.getPrefs();
      if (this.view === 'settings') this.renderSettings();
      return;
    }
    if (msg.remote) this.maybeNotify(msg);
    if (this.view === 'door') this.renderDoor();
    if (this.view === 'memo') this.renderMemos();
    if (this.view === 'log') this.renderLog();
  },

  // 알림 규칙: 남매는 서로의 기록·메모를 바로 받고,
  // 부모님은 기본 알림 없음 ('귀가했을 때만'을 켜면 귀가만)
  maybeNotify(msg) {
    if (msg.kind !== 'log' && msg.kind !== 'memo') return;
    const st = Naom.getSettings();
    if (st.mode === 'door') {
      if (msg.kind === 'memo') this.toast(`📝 ${Naom.nameOf(msg.memberId)}: ${msg.preview}`, 'memo');
      return;
    }
    if (msg.memberId && msg.memberId === st.user) return;
    const ok = this.isParent()
      ? !!(this.prefs && this.prefs[st.user]) && msg.kind === 'log' && msg.type === 'home'
      : true;
    if (!ok) return;
    const who = Naom.nameOf(msg.memberId);
    const body = msg.kind === 'log'
      ? `${who}: ${TYPES[msg.type].say} (${TYPES[msg.type].label})`
      : `${who}: ${msg.preview}`;
    this.toast('🔔 ' + body, msg.kind === 'log' ? msg.type : 'memo');
    if (navigator.vibrate) navigator.vibrate(120);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // 안드로이드 크롬은 서비스 워커로만 알림을 띄울 수 있어요
    if (this.swReg) {
      this.swReg.showNotification('나:옴', { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: msg.id });
    } else {
      try { new Notification('나:옴', { body, icon: 'icon-192.png' }); } catch (e) { /* 미지원 브라우저 */ }
    }
  },

  /* ---------- 공통 ---------- */
  url(blob, group) {
    if (typeof blob === 'string') return blob; // 가족 공유 모드에서는 이미 주소(data:) 형태예요
    const u = URL.createObjectURL(blob);
    (this.urls[group] ||= []).push(u);
    return u;
  },
  revoke(group) {
    (this.urls[group] || []).forEach(u => URL.revokeObjectURL(u));
    this.urls[group] = [];
  },
  toast(msg, type = 'memo') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('leaving'), 2800);
    setTimeout(() => el.remove(), 3300);
  },
  refreshMe() {
    const st = Naom.getSettings();
    const m = Naom.member(st.user);
    $('#meName').textContent = m ? `${m.emoji} ${m.name}` : '가족';
  },
  setTmStatus(msg) {
    const el = $('#tmStatus');
    if (el) el.textContent = msg;
  },

  /* ---------- 현관 ---------- */
  bindDoor() {
    // 몸짓 목록의 숫자 버튼: 키보드가 없는 폰에서 시연할 때
    $('.gesture-list').addEventListener('click', e => {
      const b = e.target.closest('[data-demo]');
      if (b && doorActive && !guestMode) demoFire(b.dataset.demo);
    });
    $('#guestToggle').addEventListener('change', e => {
      guestMode = e.target.checked;
      $('#guestCover').hidden = !guestMode;
      if (guestMode) { stopDetect(); stopClip(); }
      else startDetect();
    });
  },

  async renderStatus(sel) {
    const status = await Naom.getStatus();
    const kids = Naom.members().filter(m => m.role === 'kid');
    $(sel).innerHTML = kids.map(m => {
      const s = status[m.id];
      const t = s ? TYPES[s.type] : null;
      const state = !s ? '기록 없음' : s.type === 'home' ? '집에 있어요' : s.type === 'gym' ? '운동 중' : '외출 중';
      return `<li class="status ${s ? s.type : 'none'}">
        <span class="st-emoji">${t ? t.emoji : '·'}</span>
        <b>${esc(m.name)}</b><span class="st-state">${state}</span>
        <time>${s ? shortDay(s.time) + ' ' + hhmm(s.time) : ''}</time></li>`;
    }).join('');
  },

  async renderDoor() {
    this.renderStatus('#statusList');
    const memos = await Naom.getRecentMemos(18);
    $('#doorMemoList').innerHTML = memos.length
      ? memos.slice(0, 3).map(m => this.memoItem(m, null, false)).join('')
      : '<li class="empty">최근 메모가 없어요</li>';

  },

  flash(type) {
    const t = TYPES[type];
    const el = $('#doorFlash');
    el.className = `door-flash ${type}`;
    el.innerHTML = `<span class="f-emoji">${t.emoji}</span><b>${t.say}</b><small>${t.label} 기록 중</small>`;
    el.hidden = false;
    $('.stage-wrap').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // 폰에서 화면 밖이면 보이게
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, 1800);
  },

  askWho(type, cands) {
    return new Promise(resolve => {
      const box = $('#whoPicker');
      $('#whoTitle').textContent = `${TYPES[type].emoji} ${TYPES[type].say} — 누구예요?`;
      $('#whoBtns').innerHTML = cands.map(m => `<button type="button" data-id="${m.id}">${m.emoji} ${esc(m.name)}</button>`).join('');
      box.hidden = false;
      let done = false, timer = null;
      const finish = id => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        box.hidden = true;
        resolve(id);
      };
      $('#whoBtns').onclick = e => {
        const b = e.target.closest('button');
        if (b) finish(b.dataset.id);
      };
      timer = setTimeout(() => finish(null), WHO_TIMEOUT);
    });
  },

  /* ---------- 메모용 카메라 (사진 / 5초 영상) ----------
   * '카메라로 찍기'를 누르면 앱 안에서 바로 카메라가 열려요.
   * 영상은 5초까지, 가볍게 찍어서 가족 공유 용량(700KB) 안에 들어가요. */
  bindCamera() {
    this.cam = { stream: null, facing: 'environment', mode: 'photo', rec: null, timer: null };
    $('#camBtn').addEventListener('click', () => this.openCamera());
    $('#camClose').addEventListener('click', () => this.closeCamera());
    $('#camFlip').addEventListener('click', () => {
      if (this.cam.rec) return;
      this.cam.facing = this.cam.facing === 'environment' ? 'user' : 'environment';
      this.startCamStream();
    });
    $('#camModes').addEventListener('click', e => {
      const b = e.target.closest('[data-cmode]');
      if (!b || this.cam.rec) return;
      this.cam.mode = b.dataset.cmode;
      $$('#camModes button').forEach(x => x.classList.toggle('active', x === b));
      $('#camSheet').dataset.cmode = this.cam.mode;
    });
    $('#camShutter').addEventListener('click', () => {
      if (this.cam.mode === 'photo') this.takePhoto();
      else if (this.cam.rec) this.stopCamVideo();
      else this.startCamVideo();
    });
  },

  async openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#memoMedia').click(); // 카메라를 못 쓰는 브라우저면 앨범으로
      return;
    }
    $('#camSheet').hidden = false;
    $('#camSheet').dataset.cmode = this.cam.mode;
    document.body.classList.add('no-scroll');
    await this.startCamStream();
  },

  async startCamStream() {
    this.stopCamStream();
    try {
      this.cam.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.cam.facing, width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      const v = $('#camPreview');
      v.srcObject = this.cam.stream;
      v.classList.toggle('mirror', this.cam.facing === 'user');
      await v.play().catch(() => {});
    } catch (e) {
      this.closeCamera();
      this.toast(window.isSecureContext ? '카메라 권한을 허용해 주세요' : 'https 주소에서만 카메라를 쓸 수 있어요', 'err');
    }
  },

  stopCamStream() {
    if (this.cam.stream) this.cam.stream.getTracks().forEach(t => t.stop());
    this.cam.stream = null;
  },

  closeCamera() {
    if (this.cam.rec) { this.cam.rec.discard = true; this.stopCamVideo(); }
    this.stopCamStream();
    $('#camPreview').srcObject = null;
    $('#camSheet').hidden = true;
    document.body.classList.remove('no-scroll');
  },

  takePhoto() {
    const v = $('#camPreview');
    if (!v.videoWidth) return;
    const s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    const ctx = c.getContext('2d');
    if (this.cam.facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // 셀카는 보이는 대로
    ctx.drawImage(v, 0, 0, c.width, c.height);
    $('#camSheet').classList.add('flash');
    setTimeout(() => $('#camSheet').classList.remove('flash'), 180);
    c.toBlob(b => {
      if (!b) return;
      this.attach = new File([b], 'photo.jpg', { type: 'image/jpeg' });
      this.renderAttach();
      this.closeCamera();
    }, 'image/jpeg', 0.82);
  },

  startCamVideo() {
    if (!this.cam.stream || MIME === null) { this.toast('이 브라우저는 영상 촬영을 지원하지 않아요', 'err'); return; }
    const chunks = [];
    const mr = MIME
      ? new MediaRecorder(this.cam.stream, { mimeType: MIME, videoBitsPerSecond: 800000 })
      : new MediaRecorder(this.cam.stream);
    const rec = { mr, discard: false, started: Date.now() };
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(this.cam.timer);
      $('#camTimer').hidden = true;
      $('#camSheet').classList.remove('recording');
      if (rec.discard || !chunks.length) return;
      const type = (mr.mimeType || 'video/mp4').split(';')[0];
      this.attach = new File(chunks, type.includes('mp4') ? 'clip.mp4' : 'clip.webm', { type });
      this.renderAttach();
      this.closeCamera();
    };
    mr.start();
    this.cam.rec = rec;
    $('#camSheet').classList.add('recording');
    $('#camTimer').hidden = false;
    const tick = () => {
      const left = Math.max(0, 5 - Math.floor((Date.now() - rec.started) / 1000));
      $('#camTimer').textContent = `0:0${left}`;
      if (Date.now() - rec.started >= 5000) this.stopCamVideo();
    };
    tick();
    this.cam.timer = setInterval(tick, 200);
  },

  stopCamVideo() {
    const rec = this.cam.rec;
    this.cam.rec = null;
    if (rec && rec.mr.state !== 'inactive') rec.mr.stop();
  },

  /* ---------- 메모 ---------- */
  bindMemo() {
    $('#memoKinds').addEventListener('click', e => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      this.memoKind = b.dataset.kind;
      $$('#memoKinds .chip').forEach(c => c.classList.toggle('active', c === b));
      $$('.kind-field').forEach(f => { f.hidden = f.dataset.for !== this.memoKind; });
      this.updateMemoPreview();
    });
    ['visitCount', 'visitTime', 'etaTime', 'whereText', 'memoText'].forEach(id =>
      $('#' + id).addEventListener('input', () => this.updateMemoPreview()));
    $('#memoMedia').addEventListener('change', e => {
      this.attach = e.target.files[0] || null;
      this.renderAttach();
    });
    $('#locBtn').addEventListener('click', () => this.grabLocation());
    $('#attachPreview').addEventListener('click', e => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      if (b.dataset.remove === 'media') { this.attach = null; $('#memoMedia').value = ''; }
      if (b.dataset.remove === 'loc') { this.loc = null; $('#locBtn').textContent = '📍 지금 위치 한 번'; }
      this.renderAttach();
    });
    $('#memoForm').addEventListener('submit', e => { e.preventDefault(); this.sendMemo(); });

    // 귀가 예정 기본값: 지금부터 2시간 뒤
    const d = new Date(Date.now() + 2 * 3600 * 1000);
    $('#etaTime').value = `${two(d.getHours())}:${two(Math.floor(d.getMinutes() / 10) * 10)}`;
    this.updateMemoPreview();
  },

  composeMemo() {
    const k = this.memoKind;
    let main = '';
    if (k === 'visit') {
      const n = Math.max(1, parseInt($('#visitCount').value, 10) || 1);
      const t = $('#visitTime').value;
      main = `친구 ${n}명 잠깐 방문 예정${t ? ` (${t}쯤)` : ''}`;
    }
    if (k === 'eta') {
      const t = $('#etaTime').value;
      main = t ? `${t} 귀가 예정` : '귀가 예정';
    }
    if (k === 'where') main = $('#whereText').value.trim();
    const extra = $('#memoText').value.trim();
    return [main, extra].filter(Boolean).join(' · ');
  },

  updateMemoPreview() {
    const body = this.composeMemo();
    const who = Naom.nameOf(Naom.getSettings().user);
    $('#memoPreview').textContent = body ? `${who}: ${body}` : '';
  },

  grabLocation() {
    if (!navigator.geolocation) { this.toast('이 브라우저는 위치를 지원하지 않아요', 'err'); return; }
    $('#locBtn').textContent = '📍 위치 찾는 중…';
    navigator.geolocation.getCurrentPosition(p => {
      this.loc = {
        lat: +p.coords.latitude.toFixed(5),
        lng: +p.coords.longitude.toFixed(5),
        acc: Math.round(p.coords.accuracy),
      };
      $('#locBtn').textContent = '📍 위치 첨부됨';
      this.renderAttach();
    }, () => {
      $('#locBtn').textContent = '📍 지금 위치 한 번';
      this.toast('위치를 가져오지 못했어요', 'err');
    }, { enableHighAccuracy: true, timeout: 10000 });
  },

  renderAttach() {
    this.revoke('attach');
    let html = '';
    if (this.attach) {
      const u = this.url(this.attach, 'attach');
      html += this.attach.type.startsWith('video')
        ? `<div class="att"><video src="${u}" muted playsinline controls></video><button type="button" data-remove="media">✕</button></div>`
        : `<div class="att"><img src="${u}" alt="첨부 미리보기"><button type="button" data-remove="media">✕</button></div>`;
    }
    if (this.loc) {
      html += `<div class="att att-loc">📍 보낼 위치 (오차 약 ${this.loc.acc}m)<button type="button" data-remove="loc">✕</button></div>`;
    }
    $('#attachPreview').innerHTML = html;
  },

  async sendMemo() {
    const body = this.composeMemo();
    if (!body && !this.attach && !this.loc) { this.toast('메모 내용을 적어 주세요', 'err'); return; }
    const st = Naom.getSettings();
    const btn = $('#memoForm button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '보내는 중…';
    try {
      const media = await Naom.shrinkImage(this.attach);
      const conn = await Naom.connection();
      if (media && media.size > conn.mediaLimit) {
        this.toast('첨부가 너무 커요. 영상은 3초 안쪽으로 찍어 주세요.', 'err');
        return;
      }
      await Naom.addMemo({
        memberId: st.user,
        kind: this.memoKind,
        body,
        media,
        mediaType: media ? media.type : null,
        loc: this.loc,
      });
    } catch (e) {
      console.error(e);
      this.toast('메모를 보내지 못했어요. 인터넷 연결을 확인해 주세요.', 'err');
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = '보내기';
    }
    $('#memoText').value = '';
    $('#whereText').value = '';
    $('#memoMedia').value = '';
    $('#locBtn').textContent = '📍 지금 위치 한 번';
    this.attach = null;
    this.loc = null;
    this.renderAttach();
    this.updateMemoPreview();
    this.toast('메모를 보냈어요', 'memo');
  },

  memoItem(m, group, full = true) {
    const who = Naom.member(m.memberId);
    let media = '';
    if (m.media && full && group) {
      const u = this.url(m.media, group);
      media = m.mediaType && m.mediaType.startsWith('video')
        ? `<video src="${u}" controls playsinline muted></video>`
        : `<img src="${u}" alt="첨부 사진">`;
    } else if (m.media) {
      media = '<span class="tag">📷 첨부</span>';
    }
    const loc = m.loc
      ? (full
        ? `<a class="loc" href="https://maps.google.com/?q=${m.loc.lat},${m.loc.lng}" target="_blank" rel="noopener">📍 보낸 순간의 위치 보기</a>`
        : '<span class="tag">📍 위치</span>')
      : '';
    return `<li class="memo kind-${m.kind}">
      <div class="memo-head"><b>${who ? who.emoji + ' ' + esc(who.name) : '가족'}</b><time>${shortDay(m.time)} ${hhmm(m.time)}</time></div>
      <p>${esc(m.body || '')}</p>${media}${loc}</li>`;
  },

  async renderMemos() {
    this.revoke('memo');
    const list = await Naom.getRecentMemos(72);
    $('#memoList').innerHTML = list.length
      ? list.map(m => this.memoItem(m, 'memo')).join('')
      : '<li class="empty">최근 3일 동안 남긴 메모가 없어요</li>';
  },

  /* ---------- 기록 (현관 브이로그 + 캘린더) ---------- */
  bindLog() {
    $('#dayPrev').addEventListener('click', () => this.shiftDay(-1));
    $('#dayNext').addEventListener('click', () => this.shiftDay(1));
    $('#monPrev').addEventListener('click', () => this.shiftMonth(-1));
    $('#monNext').addEventListener('click', () => this.shiftMonth(1));
    $('#calGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-key]');
      if (!b || b.disabled) return;
      this.dayKey = b.dataset.key;
      this.renderLog();
    });
    // 영상 카드를 누르면 재생/멈춤 (기록 화면, 우리 집 화면 둘 다)
    $('#clipGrid').addEventListener('click', e => {
      const v = e.target.closest('.clip') && e.target.closest('.clip').querySelector('video');
      if (v) { v.paused ? v.play() : v.pause(); }
    });
    $('#playDay').addEventListener('click', () => this.playDay());
    $('#closePlayer').addEventListener('click', () => this.closePlayer());
    $('#commentForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('#commentInput').value.trim();
      if (!body) return;
      await Naom.addComment({ dateKey: this.dayKey, memberId: Naom.getSettings().user, body });
      $('#commentInput').value = '';
    });
  },

  shiftDay(n) {
    const d = keyToDate(this.dayKey);
    d.setDate(d.getDate() + n);
    const k = Naom.dateKey(d);
    if (k > Naom.dateKey(new Date())) return;
    this.dayKey = k;
    this.monthKey = k.slice(0, 7);
    this.renderLog();
  },

  shiftMonth(n) {
    const [y, m] = this.monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    const k = Naom.dateKey(d).slice(0, 7);
    if (k > Naom.dateKey(new Date()).slice(0, 7)) return;
    this.monthKey = k;
    this.renderCalendar();
  },

  async renderLog() {
    this.revoke('log');
    // 폰인데 가족 공유가 꺼져 있으면, 현관 기기의 기록이 안 보인다고 알려 주기
    Naom.connection().then(c => {
      const warn = $('#syncWarn');
      warn.hidden = c.shared || Naom.getSettings().mode !== 'phone';
      warn.textContent = '지금은 이 폰 안에만 저장되고 있어서 현관 기기의 기록이 여기 보이지 않아요. storage.js에 Firebase 설정을 넣으면 가족 모두의 폰에서 볼 수 있어요. (README 2단계)';
    });
    this.renderStatus('#logStatusList');
    const key = this.dayKey;
    $('#dayTitle').textContent = longDate(key);
    $('#dayNext').disabled = key >= Naom.dateKey(new Date());
    const [logs, memos, comments] = await Promise.all([
      Naom.getLogsByDate(key),
      this.isParent() ? [] : Naom.getMemosByDate(key), // 부모님은 메모를 불러오지도 않아요
      Naom.getComments(key),
    ]);
    logs.sort((a, b) => a.time - b.time);
    this.dayLogs = logs;

    $('#clipGrid').innerHTML = logs.length
      ? logs.map(l => this.clipCard(l)).join('')
      : '<p class="empty">이 날은 현관 기록이 없어요.</p>';
    $('#playDay').disabled = !logs.some(l => l.video);

    memos.sort((a, b) => a.time - b.time);
    $('#dayMemoList').innerHTML = memos.length
      ? memos.map(m => this.memoItem(m, 'log', false)).join('')
      : '<li class="empty">메모 없음</li>';

    $('#commentList').innerHTML = comments.length
      ? comments.map(c => {
        const who = Naom.member(c.memberId);
        return `<li><b>${who ? who.emoji + ' ' + esc(who.name) : '가족'}</b><p>${esc(c.body)}</p><time>${hhmm(c.time)}</time></li>`;
      }).join('')
      : '<li class="empty">아직 코멘트가 없어요. 오늘 현관 한 줄 평을 남겨 보세요.</li>';

    this.renderCalendar();
  },

  clipCard(l, group = 'log') {
    const t = TYPES[l.type];
    const who = Naom.member(l.memberId);
    const media = l.video
      ? `<video src="${this.url(l.video, group)}" muted playsinline loop preload="metadata"></video>`
      : `<div class="no-video">${t.emoji}</div>`;
    return `<figure class="clip ${l.type}">${media}
      <figcaption><span class="badge">${t.emoji} ${t.say}</span>
      <b>${who ? esc(who.name) : '가족'}</b><time>${hhmm(l.time)}</time></figcaption></figure>`;
  },

  playDay() {
    const clips = this.dayLogs.filter(l => l.video);
    if (!clips.length) return;
    this.revoke('player');
    const box = $('#dayPlayer'), v = $('#dayPlayerVideo'), cap = $('#dayPlayerCap');
    box.hidden = false;
    let i = 0;
    const next = () => {
      if (i >= clips.length) { this.closePlayer(); return; }
      const l = clips[i++];
      v.src = this.url(l.video, 'player');
      cap.textContent = `${i}/${clips.length} · ${hhmm(l.time)} · ${Naom.nameOf(l.memberId)} · ${TYPES[l.type].say}`;
      v.play().catch(() => {});
    };
    v.onended = next;
    next();
  },

  closePlayer() {
    const v = $('#dayPlayerVideo');
    v.pause();
    v.onended = null;
    v.removeAttribute('src');
    v.load();
    $('#dayPlayer').hidden = true;
    this.revoke('player');
  },

  async renderCalendar() {
    const mk = this.monthKey;
    const [y, m] = mk.split('-').map(Number);
    $('#monTitle').textContent = `${y}년 ${m}월`;
    $('#monNext').disabled = mk >= Naom.dateKey(new Date()).slice(0, 7);
    const logs = await Naom.getLogsByMonth(mk);
    const byDay = {};
    logs.forEach(l => {
      const c = (byDay[l.dateKey] ||= { out: 0, home: 0, gym: 0 });
      c[l.type]++;
    });
    const startDow = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const todayKey = Naom.dateKey(new Date());
    let html = '';
    for (let i = 0; i < startDow; i++) html += '<span class="cal-cell blank"></span>';
    for (let d = 1; d <= days; d++) {
      const key = `${mk}-${two(d)}`;
      const c = byDay[key];
      const dots = c
        ? Object.entries(c).filter(([, n]) => n).map(([t, n]) => `<i class="dot ${t}" title="${TYPES[t].label} ${n}번"></i>`).join('')
        : '';
      const total = c ? c.out + c.home + c.gym : 0;
      const cls = ['cal-cell'];
      if (key === todayKey) cls.push('today');
      if (key === this.dayKey) cls.push('selected');
      const future = key > todayKey;
      html += `<button type="button" class="${cls.join(' ')}" data-key="${key}" ${future ? 'disabled' : ''}>
        <span class="num">${d}</span><span class="dots">${dots}</span>${total ? `<span class="cnt">${total}</span>` : ''}</button>`;
    }
    $('#calGrid').innerHTML = html;
  },

  /* ---------- 설정 ---------- */
  bindSettings() {
    $('#setUser').addEventListener('change', e => {
      Naom.saveSettings({ user: e.target.value });
      this.refreshMe();
      this.updateMemoPreview();
    });
    $$('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
      Naom.saveSettings({ mode: r.value });
      this.applyMode();
      this.show('settings');
      this.toast(r.value === 'door' ? '이 기기를 현관 기기로 바꿨어요' : '이 기기를 들고 다니는 폰으로 바꿨어요', 'home');
    }));
    $('#homeAlert').addEventListener('change', async e => {
      const on = e.target.checked;
      try {
        await Naom.setHomeAlert(Naom.getSettings().user, on);
        this.prefs = await Naom.getPrefs();
        this.toast(on ? '귀가 알림을 켰어요' : '귀가 알림을 껐어요', 'home');
      } catch (err) {
        e.target.checked = !on;
        this.toast('설정을 저장하지 못했어요', 'err');
      }
    });
    $('#nameFields').addEventListener('change', e => {
      const input = e.target.closest('[data-member]');
      if (!input) return;
      const names = { ...Naom.getSettings().names, [input.dataset.member]: input.value.trim() };
      Naom.saveSettings({ names });
      this.refreshMe();
      this.renderSettings();
    });
    $('#copyTopic').addEventListener('click', async () => {
      const t = $('#myTopic').textContent;
      try { await navigator.clipboard.writeText(t); this.toast('토픽 이름을 복사했어요', 'home'); }
      catch (e) { this.toast(t, 'memo'); }
    });
    $('#notifBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) { this.toast('이 브라우저는 알림을 지원하지 않아요', 'err'); return; }
      await Notification.requestPermission();
      this.renderSettings();
    });
    $('#wipeBtn').addEventListener('click', async () => {
      const btn = $('#wipeBtn');
      if (!this.wipeArmed) {
        this.wipeArmed = true;
        btn.textContent = '정말 지울까요? 한 번 더 누르세요';
        setTimeout(() => { this.wipeArmed = false; btn.textContent = '모든 기록 지우기'; }, 3000);
        return;
      }
      this.wipeArmed = false;
      btn.textContent = '모든 기록 지우기';
      await Naom.clearAll();
      this.toast('모든 기록을 지웠어요', 'err');
    });
  },

  renderSettings() {
    const st = Naom.getSettings();
    const ms = Naom.members();
    $('#setUser').innerHTML = ms.map(m => `<option value="${m.id}" ${m.id === st.user ? 'selected' : ''}>${m.emoji} ${esc(m.name)}</option>`).join('');
    $$('input[name="mode"]').forEach(r => { r.checked = r.value === st.mode; });
    const me = Naom.member(st.user);
    $('#accountWho').textContent = me ? `${me.emoji} ${me.name}` : '';
    Naom.connection().then(c => { $('#accountEmail').textContent = c.email; });
    $('#homeAlert').checked = !!(this.prefs && this.prefs[st.user]);
    $('#nameFields').innerHTML = ms.map(m => `<label class="name-field"><span>${m.emoji}</span>
      <input data-member="${m.id}" value="${esc(m.name)}" maxlength="8" aria-label="${m.role === 'kid' ? '자녀' : '부모님'} 이름"></label>`).join('');
    Naom.connection().then(c => {
      // 폰 푸시 (ntfy)
      const ps = $('#pushStatus');
      ps.className = 'conn ' + (c.pushOn ? 'on' : 'off');
      ps.textContent = c.pushOn
        ? '🟢 푸시 켜짐 · 앱을 닫아도 ntfy 앱으로 알림이 와요'
        : '⚪ 푸시 꺼짐 (storage.js의 ntfyPrefix를 정하면 켜져요)';
      $('#pushHow').hidden = !c.pushOn;
      if (c.pushOn) {
        $('#myTopic').textContent = c.topic;
        const p = this.prefs || {};
        const onOff = id => (p[id] ? '켜짐' : '꺼짐');
        $('#pushRule').textContent = this.isParent()
          ? '위의 귀가 알림을 켰을 때만, 이 토픽으로 귀가 소식이 와요.'
          : `${me ? me.name : '나'} 토픽에는 다른 가족의 외출·귀가·운동·메모 알림이 와요. (부모님 귀가 알림: ${Naom.nameOf('mom')} ${onOff('mom')} · ${Naom.nameOf('dad')} ${onOff('dad')})`;
      }

      const el = $('#connStatus');
      el.className = 'conn ' + (c.shared ? 'on' : 'off');
      el.textContent = c.shared
        ? '🟢 가족 공유 중 · 모든 가족 폰에 실시간으로 반영돼요'
        : c.configured
          ? `🔴 Firebase 연결 실패 → 이 기기에만 저장 중 (${c.error})`
          : '⚪ 체험 모드 · 이 기기에만 저장 중 (storage.js에 Firebase 설정을 넣으면 폰끼리 공유돼요)';
    });
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    $('#notifBtn').textContent = perm === 'granted' ? '🔔 앱 안 알림 켜짐'
      : perm === 'denied' ? '🔕 알림이 막혀 있어요 (브라우저 설정에서 허용)'
      : perm === 'unsupported' ? '이 브라우저는 알림 미지원' : '🔔 브라우저 알림 허용하기';
  },
};