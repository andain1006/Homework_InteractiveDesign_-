/* ==========================================================
 * 나:옴 — storage.js
 * 기록(현관 영상), 메모, 하루 코멘트, 설정을 저장하고
 * 가족 폰에 푸시 알림을 보내는 파일
 *
 * ▶ 저장 방식 두 가지
 *   1) 이 기기에만 저장 (기본) : NAOM_CONFIG.firebase 가 null 이면
 *      브라우저 안(IndexedDB)에 저장, 같은 컴퓨터의 다른 창끼리만 공유
 *   2) 가족 공유 (폰끼리)      : NAOM_CONFIG.firebase 를 채우면
 *      Firebase Firestore(무료 Spark 요금제)에 저장, 모든 폰에 실시간 반영
 *      짧은 영상·사진은 Firestore 문서 안에 글자(base64)로 넣어요
 *      (Firebase Storage 는 유료 요금제가 필요해서 쓰지 않아요)
 *
 * ▶ 가족 로그인 : 구글 계정 (가족 공유 모드에서만)
 *   가족 명단(이메일)은 이 코드가 아니라 Firestore 안
 *   families/naom-family/config/roster 문서에만 적어요.
 *   → 깃허브에 코드를 공개해도 가족 이메일이 드러나지 않아요.
 *   나·오빠 = 모든 기능, 엄마·아빠 = 기록 보기 + 귀가 알림 설정
 *
 * ▶ 폰 푸시 알림 : ntfy (무료 앱, 회원가입 없음)
 *   토픽 이름 앞부분(ntfyPrefix)도 같은 roster 문서에만 적어요.
 *   외출·귀가·운동·메모 때
 *   가족 폰으로 푸시가 가요. 앱을 닫아 둬도 와요.
 *   각자 폰의 ntfy 앱에서 '자기 토픽'만 구독하면 끝 (설정 화면에 나와요).
 * ========================================================== */

const NAOM_CONFIG = {
  // Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 의 firebaseConfig 를 그대로 붙여 넣어요.
  // null 이면 이 기기에만 저장돼요.
  firebase: {
    apiKey: "AIzaSyBtYMGMekaNZ8ZSCWLJeiboSbNIxn9onjM",
    authDomain: "naom-f336b.firebaseapp.com",
    projectId: "naom-f336b",
    storageBucket: "naom-f336b.firebasestorage.app",
    messagingSenderId: "463532041717",
    appId: "1:463532041717:web:93c879a5cf1effcd56acbc",
  },
  /* 예시
  firebase: {
    apiKey: "AIza....",
    authDomain: "naom-xxxx.firebaseapp.com",
    projectId: "naom-xxxx",
    storageBucket: "naom-xxxx.firebasestorage.app",
    messagingSenderId: "1234",
    appId: "1:1234:web:abcd",
  },
  */

  // ⚠ 가족 이메일과 ntfy 토픽 이름은 여기에 적지 않아요! (깃허브에 공개되니까)
  //   Firestore 콘솔의 families/naom-family/config/roster 문서에 적어요. (README 참고)

  // Firestore 안의 우리 가족 폴더 이름 (바꿀 필요 없어요)
  familyCode: 'naom-family',

  // (체험 모드 전용) ntfy 토픽 앞부분. 가족 공유 모드에서는 roster 문서의 값을 써요.
  ntfyPrefix: '',
  ntfyServer: 'https://ntfy.sh',

  // 푸시를 누르면 열릴 주소 (비우면 지금 앱 주소)
  appUrl: '',
};

const Naom = (() => {
  const FB_VERSION = '12.11.0';
  const STORES = ['logs', 'memos', 'comments'];
  const SETTINGS_KEY = 'naom-settings';
  const DEVICE_KEY = 'naom-device';
  const CLOUD_MEDIA_LIMIT = 700 * 1024;      // Firestore 문서 1MB 제한 (base64 로 1.33배 커져요)
  const LOCAL_MEDIA_LIMIT = 50 * 1024 * 1024;

  const DEFAULT_MEMBERS = [
    { id: 'me',   name: '나',   role: 'kid',    emoji: '🙋‍♀️' },
    { id: 'oppa', name: '오빠', role: 'kid',    emoji: '🧑' },
    { id: 'mom',  name: '엄마', role: 'parent', emoji: '👩' },
    { id: 'dad',  name: '아빠', role: 'parent', emoji: '👨' },
  ];

  // 폰으로 열면 기본은 '들고 다니는 폰', 컴퓨터·태블릿이면 '현관 기기'
  const IS_PHONE = /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);

  const DEFAULT_SETTINGS = {
    user: 'me',            // 이 기기를 쓰는 사람
    mode: IS_PHONE ? 'phone' : 'door', // 'door' = 현관에 붙인 기기, 'phone' = 들고 다니는 폰
    parentNotify: 'none',  // 앱 안 알림: 'none' = 없음, 'home' = 귀가만
    parentAlerts: { mom: false, dad: false }, // (이 기기에만 저장 모드용) 부모님 귀가 알림
    names: {},
  };

  const CLOUD = !!NAOM_CONFIG.firebase;
  let signedMember = null;   // 구글로 로그인한 가족 (me/oppa/mom/dad)
  let roster = null;         // Firestore 에서 읽어 온 가족 명단 (로그인한 가족만 읽을 수 있어요)
  let ntfyPrefixRT = CLOUD ? '' : NAOM_CONFIG.ntfyPrefix; // 실제로 쓰는 토픽 앞부분

  const TYPE_TEXT = {
    out:  { say: '나옴',          label: '외출', tag: 'wave' },
    home: { say: '나 옴',         label: '귀가', tag: 'v' },
    gym:  { say: '운동 다녀올게', label: '운동', tag: 'punch' },
  };

  /* ---------- 작은 도우미 ---------- */
  const pad = n => String(n).padStart(2, '0');
  function dateKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  const DEVICE_ID = (() => {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = uid(); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return uid(); }
  })();
  const hhmm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }

  // 사진은 가로·세로 최대 1280px JPEG 로 줄여요. 영상은 그대로.
  async function shrinkImage(file, max = 1280, quality = 0.8) {
    if (!file) return null;
    if (!file.type || !file.type.startsWith('image')) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', quality));
    } catch (e) {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- 설정 ---------- */
  // 주소 뒤에 ?user=oppa&mode=phone 처럼 붙이면 그 창만 다른 사람으로 열려요.
  function urlOverrides() {
    const p = new URLSearchParams(location.search);
    const out = {};
    if (DEFAULT_MEMBERS.some(m => m.id === p.get('user'))) out.user = p.get('user');
    if (['door', 'phone'].includes(p.get('mode'))) out.mode = p.get('mode');
    return out;
  }
  function readSaved() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function getSettings() {
    const saved = readSaved();
    const s = { ...DEFAULT_SETTINGS, ...saved, ...urlOverrides(), names: { ...(saved.names || {}) } };
    s.parentAlerts = { ...DEFAULT_SETTINGS.parentAlerts, ...(saved.parentAlerts || {}) };
    if (CLOUD) s.user = signedMember;          // 가족 공유 모드: 로그인한 계정이 곧 '나'
    if (CLOUD && s.mode === 'door' && role(s.user) === 'parent') s.mode = 'phone'; // 부모님은 현관 기기 불가
    return s;
  }
  function saveSettings(patch) {
    const url = new URL(location.href);
    let urlChanged = false;
    ['user', 'mode'].forEach(k => {
      if (k in patch && url.searchParams.has(k)) {
        url.searchParams.set(k, patch[k]);
        urlChanged = true;
      }
    });
    if (urlChanged) history.replaceState(null, '', url);
    const next = { ...readSaved(), ...patch };
    ['user', 'mode'].forEach(k => { if (url.searchParams.has(k)) delete next[k]; });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* 저장 공간 없음 */ }
    return getSettings();
  }

  // 처음 연 기기인지 (누구 기기인지 아직 안 골랐는지)
  function isFirstRun() {
    // 현관 기기는 '누가'를 안 고르니까, 용도(mode)를 골랐으면 처음이 아니에요
    const saved = readSaved(), url = urlOverrides();
    if (CLOUD) return role(signedMember) === 'kid' && !('mode' in saved) && !('mode' in url);
    return !('user' in saved) && !('mode' in saved) && !('user' in url) && !('mode' in url);
  }
  function role(id) {
    const m = DEFAULT_MEMBERS.find(x => x.id === id);
    return m ? m.role : null;
  }

  /* ---------- 가족 ---------- */
  function members() {
    const { names } = getSettings();
    return DEFAULT_MEMBERS.map(m => ({ ...m, name: names[m.id] || m.name }));
  }
  function member(id) { return members().find(m => m.id === id) || null; }
  function nameOf(id) { const m = member(id); return m ? m.name : '가족'; }

  /* ---------- 화면 새로고침용 이벤트 ---------- */
  const listeners = [];
  let active = null;      // 실제로 쓰는 저장소 (Local 또는 Cloud)
  let cloudError = '';
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('naom') : null;
  if (channel) {
    channel.onmessage = e => {
      if (active === Local) listeners.forEach(fn => fn({ ...e.data, remote: true }));
    };
  }
  function emitLocal(msg) {
    if (channel && active === Local) channel.postMessage(msg);
    listeners.forEach(fn => fn({ ...msg, remote: false }));
  }
  function emitRemote(msg) {
    listeners.forEach(fn => fn({ ...msg, remote: true }));
  }

  /* ==========================================================
   * 폰 푸시 (ntfy)
   *  - 모두 각자 자기 토픽 하나 (예: naom-k7x2-me, naom-k7x2-mom)
   *  - 나·오빠: 서로의 외출·귀가·운동·메모가 와요
   *  - 엄마·아빠: 앱 설정에서 '귀가 알림'을 켠 사람에게만 귀가가 와요
   * ========================================================== */
  function topicFor(userId) {
    if (!ntfyPrefixRT || !userId) return '';
    return `${ntfyPrefixRT}-${userId}`;
  }
  function pushTopics(kind, type, actorId) {
    if (!ntfyPrefixRT) return [];
    const prefs = getPrefsNow();
    const topics = DEFAULT_MEMBERS
      .filter(m => m.role === 'kid' && m.id !== actorId)
      .map(m => topicFor(m.id));
    if (kind === 'log' && type === 'home') {
      DEFAULT_MEMBERS.filter(m => m.role === 'parent' && prefs[m.id]).forEach(m => topics.push(topicFor(m.id)));
    }
    return topics;
  }

  /* ---------- 부모님 귀가 알림 켜기/끄기 ---------- */
  let cloudPrefs = { mom: false, dad: false };
  function getPrefsNow() {
    return active === Cloud ? { ...cloudPrefs } : { ...getSettings().parentAlerts };
  }
  function push(kind, type, actorId, message) {
    const topics = pushTopics(kind, type, actorId);
    if (!topics.length) return;
    const click = NAOM_CONFIG.appUrl || (location.origin + location.pathname);
    const tags = kind === 'log' ? [TYPE_TEXT[type].tag] : ['memo'];
    topics.forEach(topic => {
      // Content-Type 을 일부러 안 붙여요 (브라우저 사전 확인 요청 없이 바로 보내기)
      fetch(NAOM_CONFIG.ntfyServer.replace(/\/$/, '') + '/', {
        method: 'POST',
        body: JSON.stringify({ topic, title: '나:옴', message, tags, click }),
      }).catch(e => console.warn('푸시를 보내지 못했어요', topic, e));
    });
  }

  /* ==========================================================
   * 저장소 1) 이 기기에만 (IndexedDB)
   * ========================================================== */
  const Local = (() => {
    let dbPromise = null;
    function openDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('naom-db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          STORES.forEach(name => {
            if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, { keyPath: 'id' }).createIndex('dateKey', 'dateKey');
            }
          });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }
    const asPromise = req => new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    async function put(store, obj) {
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      return new Promise((res, rej) => { tx.oncomplete = () => res(obj); tx.onerror = () => rej(tx.error); });
    }
    async function getAll(store) {
      const db = await openDB();
      return asPromise(db.transaction(store).objectStore(store).getAll());
    }
    async function byDate(store, key) {
      const db = await openDB();
      return asPromise(db.transaction(store).objectStore(store).index('dateKey').getAll(key));
    }
    async function byMonth(store, mk) {
      const db = await openDB();
      return asPromise(db.transaction(store).objectStore(store).index('dateKey')
        .getAll(IDBKeyRange.bound(`${mk}-01`, `${mk}-31`)));
    }
    return {
      addLog: log => put('logs', log),
      getLogsByDate: key => byDate('logs', key),
      getLogsByMonth: mk => byMonth('logs', mk),
      async getStatus() {
        const status = {};
        (await getAll('logs')).forEach(l => {
          if (l.memberId && (!status[l.memberId] || status[l.memberId].time < l.time)) {
            status[l.memberId] = { type: l.type, time: l.time };
          }
        });
        return status;
      },
      addMemo: memo => put('memos', memo),
      getMemosByDate: key => byDate('memos', key),
      async getRecentMemos(since) { return (await getAll('memos')).filter(m => m.time >= since); },
      addComment: c => put('comments', c),
      getComments: key => byDate('comments', key),
      async clearAll() {
        const db = await openDB();
        const tx = db.transaction(STORES, 'readwrite');
        STORES.forEach(s => tx.objectStore(s).clear());
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      },
    };
  })();

  /* ==========================================================
   * 저장소 2) 가족 공유 (Firebase Firestore)
   *  families/{가족코드}/logs     현관 기록 (영상 빼고)
   *  families/{가족코드}/clips    현관 영상 (기록과 같은 id)
   *  families/{가족코드}/status   가족별 마지막 상태
   *  families/{가족코드}/memos    메모 (사진·짧은 영상 포함)
   *  families/{가족코드}/comments 하루 코멘트
   * ========================================================== */
  const Cloud = (() => {
    let fs = null, db = null, au = null, auth = null, initPromise = null, readyPromise = null;
    // 1단계: Firebase 프로그램 불러오기 (로그인 화면을 띄우는 데 필요)
    function init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
        const appMod = await import(`${base}/firebase-app.js`);
        fs = await import(`${base}/firebase-firestore.js`);
        au = await import(`${base}/firebase-auth.js`);
        const app = appMod.initializeApp(NAOM_CONFIG.firebase);
        db = fs.getFirestore(app);
        auth = au.getAuth(app);
      })();
      return initPromise;
    }
    // 2단계: 로그인한 뒤 가족 기록에 연결
    function ready() {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        await init();
        await authOk;
        // 연결 확인 (규칙이 막혀 있으면 여기서 오류가 나요)
        await fs.getDocs(fs.query(col('status'), fs.limit(1)));
        fs.onSnapshot(col('prefs'), snap => {
          const next = { mom: false, dad: false };
          snap.forEach(d => { next[d.id] = !!d.data().homeAlert; });
          cloudPrefs = next;
          listeners.forEach(fn => fn({ kind: 'prefs', remote: true }));
        }, err => console.warn('알림 설정 연결 오류', err));
        watch();
      })();
      return readyPromise;
    }
    const col = name => fs.collection(db, 'families', NAOM_CONFIG.familyCode, name);
    const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 다른 기기에서 새로 생긴 기록을 실시간으로 받아요
    function watch() {
      const since = Date.now() - 60 * 1000;
      const watched = [['logs', 'log'], ['memos', 'memo'], ['comments', 'comment']]
        .filter(([name]) => !(name === 'memos' && role(signedMember) === 'parent')); // 부모님은 메모 볼 권한 없음
      watched.forEach(([name, kind]) => {
        let first = true;
        fs.onSnapshot(fs.query(col(name), fs.where('time', '>=', since)), snap => {
          if (first) { first = false; return; }
          snap.docChanges().forEach(ch => {
            if (ch.type !== 'added') return;
            const d = ch.doc.data();
            if (d.deviceId === DEVICE_ID) return;
            emitRemote({
              kind, id: ch.doc.id, type: d.type, memberId: d.memberId, time: d.time,
              memoKind: d.kind, preview: (d.body || (d.loc ? '위치를 보냈어요' : '사진을 보냈어요')).slice(0, 60),
              dateKey: d.dateKey,
            });
          });
        }, err => console.warn('실시간 연결 오류', err));
      });
    }

    return {
      init, ready,
      // 가족 명단 읽기 (규칙상 가족 계정만 읽을 수 있어요. 남이면 permission-denied)
      async loadRoster() {
        const snap = await fs.getDoc(fs.doc(db, 'families', NAOM_CONFIG.familyCode, 'config', 'roster'));
        return snap.exists() ? snap.data() : null;
      },
      get auth() { return auth; },
      get au() { return au; },
      async setHomeAlert(memberId, on) {
        await fs.setDoc(fs.doc(col('prefs'), memberId), { homeAlert: !!on, time: Date.now() });
      },
      async addLog(log) {
        const { video, ...meta } = log;
        let hasVideo = false;
        if (video && video.size < CLOUD_MEDIA_LIMIT) {
          // 영상을 먼저 저장해야, 다른 폰이 기록을 받았을 때 영상도 바로 보여요
          await fs.setDoc(fs.doc(col('clips'), log.id), { data: await blobToDataURL(video), dateKey: log.dateKey });
          hasVideo = true;
        } else if (video) {
          console.warn('영상이 너무 커서 기록만 저장했어요');
        }
        await fs.setDoc(fs.doc(col('logs'), log.id), { ...meta, hasVideo });
        if (log.memberId) await fs.setDoc(fs.doc(col('status'), log.memberId), { type: log.type, time: log.time });
      },
      async getLogsByDate(key) {
        const logs = rows(await fs.getDocs(fs.query(col('logs'), fs.where('dateKey', '==', key))));
        await Promise.all(logs.map(async l => {
          if (!l.hasVideo) return;
          const c = await fs.getDoc(fs.doc(col('clips'), l.id));
          l.video = c.exists() ? c.data().data : null;
        }));
        return logs;
      },
      async getLogsByMonth(mk) {
        return rows(await fs.getDocs(fs.query(col('logs'),
          fs.where('dateKey', '>=', `${mk}-01`), fs.where('dateKey', '<=', `${mk}-31`))));
      },
      async getStatus() {
        const status = {};
        (await fs.getDocs(col('status'))).forEach(d => { status[d.id] = d.data(); });
        return status;
      },
      async addMemo(memo) {
        const media = memo.media ? await blobToDataURL(memo.media) : null;
        await fs.setDoc(fs.doc(col('memos'), memo.id), { ...memo, media });
      },
      async getMemosByDate(key) {
        return rows(await fs.getDocs(fs.query(col('memos'), fs.where('dateKey', '==', key))));
      },
      async getRecentMemos(since) {
        return rows(await fs.getDocs(fs.query(col('memos'), fs.where('time', '>=', since))));
      },
      async addComment(c) {
        await fs.setDoc(fs.doc(col('comments'), c.id), c);
      },
      async getComments(key) {
        return rows(await fs.getDocs(fs.query(col('comments'), fs.where('dateKey', '==', key))));
      },
      async clearAll() {
        for (const name of ['logs', 'clips', 'status', 'memos', 'comments']) { // 알림 설정(prefs)은 남겨요
          const snap = await fs.getDocs(col(name));
          await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
        }
      },
    };
  })();

  // 어떤 저장소를 쓸지 정하기 (Firebase 가 안 되면 이 기기 저장으로 대신)
  let choosing = null;
  function S() {
    if (active) return Promise.resolve(active);
    if (!choosing) {
      choosing = (async () => {
        if (CLOUD) {
          try {
            await Cloud.ready(); // 로그인할 때까지 기다려요
            active = Cloud;
            return active;
          } catch (e) {
            console.error('Firebase 연결 실패', e);
            cloudError = (e && (e.code || e.message)) || '알 수 없는 오류';
          }
        }
        active = Local;
        return active;
      })();
    }
    return choosing;
  }
  if (!CLOUD) S();

  /* ==========================================================
   * 구글 로그인 (가족 공유 모드)
   * ========================================================== */
  const authListeners = [];
  let authState = { status: CLOUD ? 'loading' : 'demo' };
  let authOkResolve;
  const authOk = new Promise(r => { authOkResolve = r; });
  function setAuth(state) {
    authState = state;
    authListeners.forEach(fn => fn(state));
  }
  function memberIdByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    const hit = DEFAULT_MEMBERS.map(m => m.id)
      .find(id => roster && typeof roster[id] === 'string' && roster[id].trim().toLowerCase() === e);
    return hit || null;
  }
  async function startAuth() {
    if (!CLOUD) { setAuth({ status: 'demo' }); return; }
    try {
      await Cloud.init();
    } catch (e) {
      console.error('Firebase 를 불러오지 못했어요', e);
      cloudError = (e && (e.code || e.message)) || '알 수 없는 오류';
      setAuth({ status: 'error', error: cloudError });
      return;
    }
    const { au, auth } = Cloud;
    au.getRedirectResult(auth).catch(e => setAuth({ status: 'signedOut', error: e.code || e.message }));
    au.onAuthStateChanged(auth, async user => {
      if (!user) { signedMember = null; setAuth({ status: 'signedOut' }); return; }
      try {
        roster = await Cloud.loadRoster();
      } catch (e) {
        // 규칙에 없는 계정이면 명단을 읽을 권한이 없어요 = 우리 가족이 아니에요
        if (e && e.code === 'permission-denied') { setAuth({ status: 'denied', email: user.email }); return; }
        setAuth({ status: 'error', error: (e && (e.code || e.message)) || '명단을 읽지 못했어요' });
        return;
      }
      if (!roster) {
        setAuth({ status: 'error', error: 'Firestore에 가족 명단(config/roster)이 아직 없어요' });
        return;
      }
      ntfyPrefixRT = typeof roster.ntfyPrefix === 'string' ? roster.ntfyPrefix.trim() : '';
      const id = memberIdByEmail(user.email);
      if (!id) { setAuth({ status: 'denied', email: user.email }); return; }
      signedMember = id;
      authOkResolve();
      S();
      setAuth({ status: 'ok', memberId: id, email: user.email, photo: user.photoURL });
    });
  }
  async function signIn() {
    const { au, auth } = Cloud;
    const provider = new au.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    // 홈 화면에 추가한 앱(아이폰)에서는 팝업이 잘 안 떠서 페이지 이동 방식으로
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return au.signInWithRedirect(auth, provider);
    try {
      await au.signInWithPopup(auth, provider);
    } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
        return au.signInWithRedirect(auth, provider);
      }
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
    }
  }
  async function signOut() {
    if (CLOUD && Cloud.auth) await Cloud.au.signOut(Cloud.auth);
    location.reload();
  }

  // 부모님 귀가 알림 (가족 공유면 모든 폰에 공유, 아니면 이 기기에만)
  async function setHomeAlert(memberId, on) {
    const store = await S();
    if (store === Cloud) {
      cloudPrefs = { ...cloudPrefs, [memberId]: !!on };
      await Cloud.setHomeAlert(memberId, on);
    } else {
      saveSettings({ parentAlerts: { ...getSettings().parentAlerts, [memberId]: !!on } });
    }
  }
  async function getPrefs() {
    await S();
    return getPrefsNow();
  }

  /* ==========================================================
   * 화면(sketch.js)에서 쓰는 함수들
   * ========================================================== */

  // type: 'out'(외출) | 'home'(귀가) | 'gym'(운동)
  async function addLog({ type, memberId = null, video = null }) {
    const store = await S();
    const now = Date.now();
    const log = { id: uid(), type, memberId, time: now, dateKey: dateKey(now), video, deviceId: DEVICE_ID };
    await store.addLog(log);
    emitLocal({ kind: 'log', id: log.id, type, memberId, time: now });
    const t = TYPE_TEXT[type];
    push('log', type, memberId, `${nameOf(memberId)}: ${t.say} (${t.label}) · ${hhmm(now)}`);
    return log;
  }

  // kind: 'visit'(친구 방문) | 'eta'(귀가 예정) | 'where'(지금 어디) | 'free'
  async function addMemo({ memberId, kind, body, media = null, mediaType = null, loc = null }) {
    const store = await S();
    const now = Date.now();
    const memo = { id: uid(), memberId, kind, body, media, mediaType, loc, time: now, dateKey: dateKey(now), deviceId: DEVICE_ID };
    await store.addMemo(memo);
    const preview = (body || (loc ? '위치를 보냈어요' : '사진을 보냈어요')).slice(0, 60);
    emitLocal({ kind: 'memo', id: memo.id, memberId, memoKind: kind, preview, time: now });
    push('memo', null, memberId, `${nameOf(memberId)}: ${preview}${loc && body ? ' 📍' : ''}`);
    return memo;
  }

  async function addComment({ dateKey: key, memberId, body }) {
    const store = await S();
    const c = { id: uid(), dateKey: key, memberId, body, time: Date.now(), deviceId: DEVICE_ID };
    await store.addComment(c);
    emitLocal({ kind: 'comment', id: c.id, memberId, dateKey: key });
    return c;
  }

  async function getRecentMemos(hours = 24) {
    const list = await (await S()).getRecentMemos(Date.now() - hours * 3600 * 1000);
    return list.sort((a, b) => b.time - a.time);
  }
  async function getComments(key) {
    return (await (await S()).getComments(key)).sort((a, b) => a.time - b.time);
  }
  async function clearAll() {
    await (await S()).clearAll();
    emitLocal({ kind: 'clear' });
  }

  // 설정 화면에 보여 줄 연결 상태
  async function connection() {
    await S();
    const shared = active === Cloud;
    return {
      shared,
      configured: !!NAOM_CONFIG.firebase,
      error: cloudError,
      familyCode: NAOM_CONFIG.familyCode,
      email: authState.email || '',
      mediaLimit: shared ? CLOUD_MEDIA_LIMIT : LOCAL_MEDIA_LIMIT,
      pushOn: !!ntfyPrefixRT,
      ntfyServer: NAOM_CONFIG.ntfyServer,
      topic: topicFor(getSettings().user),
    };
  }

  return {
    dateKey, members, member, nameOf,
    getSettings, saveSettings, isFirstRun, shrinkImage, connection, topicFor, role,
    cloud: CLOUD,
    startAuth, signIn, signOut,
    onAuth: fn => { authListeners.push(fn); fn(authState); },
    getPrefs, setHomeAlert,
    addLog,
    getLogsByDate: async key => (await S()).getLogsByDate(key),
    getLogsByMonth: async mk => (await S()).getLogsByMonth(mk),
    getStatus: async () => (await S()).getStatus(),
    addMemo,
    getMemosByDate: async key => (await S()).getMemosByDate(key),
    getRecentMemos,
    addComment, getComments,
    clearAll,
    onChange: fn => listeners.push(fn),
  };
})();