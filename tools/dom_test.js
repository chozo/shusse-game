// index.html を読み込んだ最小 DOM スタブ上で main.js / render.js を実際に走らせる
// スモークテスト。要素IDの取り違え・イベント配線・UI更新・描画時の例外を検出する。
//   node tools/dom_test.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  OK   ${name}`);
  else { failures++; console.log(`  NG   ${name}${detail ? '  → ' + detail : ''}`); }
}

// ---------------------------------------------------------------- DOM スタブ

// index.html に実在する id だけを引けるようにして、取り違えを検出する。
// あわせて hidden 属性の初期値も拾う（拾わないと初期表示状態がずれる）。
const ids = new Set();
const hiddenIds = new Set();
for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
  const tag = m[0];
  const id = /\bid="([^"]+)"/.exec(tag);
  if (!id) continue;
  ids.add(id[1]);
  if (/\shidden[\s>/]/.test(tag)) hiddenIds.add(id[1]);
}

class El {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.src = '';
    this.alt = '';
    this.style = {};
    this.width = 0;
    this.height = 0;
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs = this.attrs || {}; this.attrs[k] = String(v); }
  getAttribute(k) { return (this.attrs || {})[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 640, right: 480, bottom: 640 }; }
  click() { this.fire('click', {}); }
  fire(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev)));
  }
  getContext() { return makeCtx(); }
}

const drawCalls = { drawImage: 0, errors: [], texts: [] };

function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'drawImage') return (img) => {
        if (!img) drawCalls.errors.push('drawImage に画像が渡っていない');
        drawCalls.drawImage++;
      };
      if (prop === 'fillText' || prop === 'strokeText') return (text) => {
        if (text === undefined || text === null) drawCalls.errors.push(`${prop} に空の文字列が渡っている`);
        drawCalls.texts.push(String(text));
      };
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

const elements = new Map();
global.window = global;
global.document = {
  getElementById(id) {
    if (!ids.has(id)) throw new Error(`index.html に存在しない id を参照: "${id}"`);
    if (!elements.has(id)) {
      const e = new El('div', id);
      e.hidden = hiddenIds.has(id);
      elements.set(id, e);
    }
    return elements.get(id);
  },
  createElement(tag) { return new El(tag); },
  hidden: false,
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); },
  fire(type) { (this._listeners[type] || []).forEach((fn) => fn({})); },
};

const windowListeners = {};
global.addEventListener = (type, fn) => { (windowListeners[type] || (windowListeners[type] = [])).push(fn); };
global.fireWindow = (type, ev) => {
  (windowListeners[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev)));
};

global.devicePixelRatio = 2;

// SEARCH 環境変数でクエリ文字列を差し替えられるようにして、撮影モードも通しで検証する
//   SEARCH='?p=009' node tools/dom_test.js
global.location = { search: process.env.SEARCH || '' };

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
};

let imagesRequested = 0;
global.Image = class {
  constructor() { this._src = ''; }
  set src(v) {
    this._src = v;
    imagesRequested++;
    const full = path.join(ROOT, v);
    setImmediate(() => {
      if (fs.existsSync(full)) { this.width = 10; this.height = 10; if (this.onload) this.onload(); }
      else if (this.onerror) this.onerror();
    });
  }
  get src() { return this._src; }
};

// --- AudioContext スタブ。予約された音を記録する
const audio = { notes: [], noises: [], resumed: 0, created: 0 };
class StubParam {
  constructor() { this.value = 0; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class StubNode {
  constructor() { this.gain = new StubParam(); this.frequency = new StubParam(); }
  connect() {}
  disconnect() {}
}
// resumeFailures 回だけ resume を空振りさせて、iOS のように
// 1回の操作では running にならない端末を再現する
audio.resumeFailures = 0;
global.AudioContext = class {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.sampleRate = 48000;
    audio.created++;
  }
  resume() {
    audio.resumed++;
    if (audio.resumeFailures > 0) { audio.resumeFailures--; return Promise.resolve(); }
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; }
  createGain() { return new StubNode(); }
  createBiquadFilter() { return new StubNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createOscillator() {
    const n = new StubNode();
    const rec = { type: 'sine', freq: 0, at: 0 };
    n.start = (t) => { rec.at = t; rec.freq = n.frequency.value; rec.type = n.type; audio.notes.push(rec); };
    n.stop = () => {};
    return n;
  }
  createBufferSource() {
    const n = new StubNode();
    n.start = (t) => audio.noises.push(t);
    n.stop = () => {};
    return n;
  }
};

let rafQueue = [];
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };

let clock = 0;
global.performance = { now: () => clock };

// ---------------------------------------------------------------- CSS の hidden 衝突

// hidden 属性は UA の [hidden]{display:none} で効くが、作者スタイルの
// .overlay{display:flex} 等と同じ詳細度で作者側が勝つため、display を指定した要素に
// hidden を付けても消えない。この事故を検出する。
console.log('\n[CSS と hidden 属性の衝突]');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const mainJs = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');

  // display を指定しているセレクタを集める（[hidden] 用の打ち消しルールは除く）
  const displaySelectors = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (/\[hidden\]/.test(selector)) continue;
    if (/(^|[;\s])display\s*:/.test(m[2])) displaySelectors.push(selector);
  }

  // JS が hidden を切り替える要素の id
  const varToId = {};
  for (const m of mainJs.matchAll(/(\w+):\s*document\.getElementById\('([^']+)'\)/g)) {
    varToId[m[1]] = m[2];
  }
  const toggled = new Set(hiddenIds);
  for (const m of mainJs.matchAll(/el\.(\w+)\.hidden\s*=/g)) {
    if (varToId[m[1]]) toggled.add(varToId[m[1]]);
  }

  // その要素の id / class が display 指定セレクタに含まれていないか
  const conflicts = [];
  for (const id of toggled) {
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html);
    const classes = tag ? (/\bclass="([^"]+)"/.exec(tag[0]) || [, ''])[1].split(/\s+/).filter(Boolean) : [];
    const tokens = ['#' + id, ...classes.map((c) => '.' + c)];
    for (const sel of displaySelectors) {
      const parts = sel.split(',').map((x) => x.trim());
      if (parts.some((pt) => tokens.some((tk) => new RegExp(tk.replace('.', '\\.') + '(?![\\w-])').test(pt)))) {
        conflicts.push(`#${id} が "${sel}" の display 指定と衝突`);
      }
    }
  }

  const guarded = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css);
  check('hidden を使う要素が display 指定と衝突していない、または [hidden] で打ち消している',
    conflicts.length === 0 || guarded,
    conflicts.join(' / ') + '（[hidden]{display:none!important} が未定義）');
  check('[hidden] の打ち消しルールが存在する', guarded,
    '作者スタイルで display を指定した要素は hidden 属性だけでは消えない');
}

// ---------------------------------------------------------------- 読み込み

global.Matter = require(path.join(ROOT, 'vendor/matter.min.js'));

// index.html が読み込む順序どおりに評価する
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
console.log('\n[index.html のスクリプト読み込み]');
check('vendor + js を順に読み込める',
  scriptSrcs[0] === 'vendor/matter.min.js' &&
  scriptSrcs[scriptSrcs.length - 1] === 'js/main.js' &&
  ['js/config.js', 'js/stages.js', 'js/game.js', 'js/render.js', 'js/sound.js']
    .every((f) => scriptSrcs.includes(f)),
  scriptSrcs.join(' → '));

for (const src of scriptSrcs.slice(1)) {   // matter は require 済み
  (0, eval)(fs.readFileSync(path.join(ROOT, src), 'utf8'));
}

// ---------------------------------------------------------------- 実行

function pumpFrames(n, stepMs) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue;
    rafQueue = [];
    clock += stepMs;
    q.forEach((fn) => fn(clock));
  }
}

setTimeout(() => {
  console.log('\n[起動]');
  const loading = document.getElementById('loading');
  const score = document.getElementById('score');
  const next = document.getElementById('next-img');
  const chart = document.getElementById('chart');
  const canvas = document.getElementById('board');
  const overlay = document.getElementById('overlay');
  const restart = document.getElementById('restart');

  check('操作前は AudioContext を作らない（自動再生制限）', audio.created === 0,
    `${audio.created} 個作られている`);
  check('11枚の画像を読み込む', imagesRequested >= 11, `要求 ${imagesRequested} 件`);
  check('読み込み完了で「読み込み中」が消える', loading.hidden === true);
  check('NEXT に画像が設定される', /img\/optimized\/\d{3}\.png/.test(next.src), next.src);
  check('進化表に11要素が並ぶ', chart.children.length === 11, `${chart.children.length} 件`);
  const dpr = global.devicePixelRatio;
  check('canvas が devicePixelRatio 倍で確保される',
    canvas.width === window.CONFIG.board.width * dpr && canvas.height === window.CONFIG.board.height * dpr,
    `${canvas.width}x${canvas.height} / 期待 ${window.CONFIG.board.width * dpr}x${window.CONFIG.board.height * dpr}`);

  console.log('\n[トップ画面]');
  const app = document.getElementById('app');
  const title = document.getElementById('title');
  const start = document.getElementById('start');
  const toTitle = document.getElementById('to-title');
  {
    check('起動直後はトップ画面が表示される', title.hidden === false && app.getAttribute('data-screen') === 'title',
      `title.hidden=${title.hidden} screen=${app.getAttribute('data-screen')}`);
    check('トップ画面ではゲームオーバー画面は出ない', overlay.hidden === true);
    check('トップ画面ではゲームが動いていない', window.__gameForTest.state === 'title',
      window.__gameForTest.state);

    // 進化図: 全11役職 + 役職名 + 矢印
    const chart = document.getElementById('title-chart');
    const titles = window.CONFIG.titles;
    const rows = chart.children;
    const items = rows.reduce((acc, r) => acc.concat(r.children), []);
    const EXPECTED_ROWS = [4, 4, 3];
    check('進化図が3段に分かれる', rows.length === EXPECTED_ROWS.length, `${rows.length} 段`);
    check('1段目4つ・2段目4つ・3段目3つで並ぶ',
      rows.length === EXPECTED_ROWS.length &&
      EXPECTED_ROWS.every((n, i) => rows[i].children.length === n),
      rows.map((r) => r.children.length + '枚').join(' / '));
    check('2段目以降は前段からの続きとして矢印を出す',
      rows.slice(1).every((r) => /\bcontinued\b/.test(r.className)) &&
      !/\bcontinued\b/.test(rows[0].className),
      rows.map((r) => r.className).join(' | '));
    check('トップ画面に全11役職が並ぶ', items.length === 11, `${items.length} 件`);

    const caps = items.map((li) => {
      const fig = li.children[0];
      const cap = fig.children.find((c) => c.tagName === 'figcaption');
      return cap ? cap.textContent : '(なし)';
    });
    check('進化図に役職名が正しい順で入る', caps.join(',') === titles.join(','), caps.join(' '));

    const srcs = items.map((li) => {
      const img = li.children[0].children.find((c) => c.tagName === 'img');
      return img ? img.src : '';
    });
    check('進化図に11枚の画像が入る',
      srcs.length === 11 && srcs.every((v, i) => v === window.STAGES_DATA.stages[i].src),
      srcs.filter((v, i) => v !== window.STAGES_DATA.stages[i].src).join(' ') || 'すべて一致');

    check('落下対象の 001〜004 に印が付く',
      items.filter((li) => li.className === 'droppable').length === window.CONFIG.spawnWeights.length,
      `${items.filter((li) => li.className === 'droppable').length} 件`);

    // 矢印は CSS の li + li::before。行末に矢印が残らない実装になっているか
    const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    check('矢印は疑似要素で出す（独立要素だと行末に残る）',
      /\.title-row li \+ li::before/.test(css) && /\.title-row\.continued li:first-child::before/.test(css),
      '矢印の CSS が見つからない');
    check('イラストの間隔を CSS 変数で一括指定している',
      /--chart-gap:/.test(css) && /gap:\s*var\(--chart-gap\)/.test(css) &&
      /left:\s*calc\(var\(--chart-gap\) \/ -2\)/.test(css),
      '矢印は空きの中央に置くこと');

    // トップ画面で盤面を触っても落ちない
    canvas.fire('pointerdown', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    pumpFrames(20, 16.7);
    check('トップ画面では盤面を触っても落ちない', window.__gameForTest.pieces().length === 0,
      `${window.__gameForTest.pieces().length} 個`);
    check('ゲーム開始前は BGM が鳴らない', audio.notes.length === 0, `${audio.notes.length} 音`);

    // 開始ボタン
    start.fire('click', {});
    check('ゲーム開始ボタンでゲーム画面に遷移する',
      title.hidden === true && app.getAttribute('data-screen') === 'playing' &&
      window.__gameForTest.state === 'playing',
      `title.hidden=${title.hidden} screen=${app.getAttribute('data-screen')} state=${window.__gameForTest.state}`);
    check('ゲーム開始ボタンで BGM が始まる', audio.notes.length > 0, `${audio.notes.length} 音`);
  }

  console.log('\n[撮影モード（URL の p=）]');
  {
    const parse = window.__parseForcedStage;
    const cases = [
      ['', 0], ['?p=001', 1], ['?p=004', 4], ['?p=011', 11],
      ['?p=1', 1], ['?p=11', 11],
      ['?p=000', 0], ['?p=012', 0], ['?p=99', 0], ['?p=', 0], ['?p=abc', 0], ['?p=-1', 0],
      ['?x=1&p=005', 5], ['?p=005#frag', 5], ['?pp=005', 0],
    ];
    const bad = cases.filter(([q, want]) => parse(q) !== want)
      .map(([q, want]) => `"${q}"→${parse(q)}(期待${want})`);
    check('p= の解釈が正しい（範囲外・不正値は通常抽選に戻す）', bad.length === 0, bad.join(' '));

    const expected = parse(location.search);
    const note = document.getElementById('forced-note');
    check('URL の指定がゲームに反映される', window.__gameForTest.forcedStage === expected,
      `search="${location.search}" forcedStage=${window.__gameForTest.forcedStage} 期待=${expected}`);
    check('撮影モードの表示はトップ画面にだけ出す', note.hidden === !expected,
      `hidden=${note.hidden} forced=${expected}`);
    if (expected) {
      check('固定した役職だけが抽選される',
        new Set(Array.from({ length: 200 }, () => window.__gameForTest.randomStage())).size === 1);
      check('待機中のイラストが画面上端からはみ出さない',
        window.__gameForTest.holdYFor(expected) +
        Math.min(...window.__gameForTest.stages[expected - 1].verts.map((v) => v.y)) >= 0,
        `上端 y=${(window.__gameForTest.holdYFor(expected) + Math.min(...window.__gameForTest.stages[expected - 1].verts.map((v) => v.y))).toFixed(0)}`);
    }
  }

  console.log('\n[描画]');
  pumpFrames(10, 16.7);
  check('描画ループが例外なく回る', drawCalls.errors.length === 0, drawCalls.errors.join(' / '));
  check('drawImage が呼ばれている', drawCalls.drawImage > 0, `${drawCalls.drawImage} 回`);

  console.log('\n[操作]');
  // 画面中央をクリックして落とす
  const before = drawCalls.drawImage;
  canvas.fire('pointerdown', { clientX: 240, clientY: 300, pointerId: 1, pointerType: 'mouse' });
  canvas.fire('pointerup', { clientX: 240, clientY: 300, pointerId: 1, pointerType: 'mouse' });
  pumpFrames(30, 16.7);
  check('クリックでオブジェクトが落ちる', drawCalls.drawImage > before);

  // キーボード
  fireWindow('keydown', { key: 'ArrowLeft' });
  pumpFrames(10, 16.7);
  fireWindow('keyup', { key: 'ArrowLeft' });
  fireWindow('keydown', { key: ' ' });
  pumpFrames(10, 16.7);
  check('キーボード操作で例外が出ない', drawCalls.errors.length === 0);

  fireWindow('keydown', { key: 'h' });   // 当たり判定表示トグル
  pumpFrames(5, 16.7);
  check('当たり判定表示トグルで例外が出ない', drawCalls.errors.length === 0);
  fireWindow('keydown', { key: 'h' });

  console.log('\n[BGM と効果音]');
  {
    const mute = document.getElementById('mute');
    const g = window.__gameForTest;
    const boardH = window.CONFIG.board.height;

    check('AudioContext は1つだけ作られ resume されている',
      audio.created === 1 && audio.resumed >= 1, `created=${audio.created} resumed=${audio.resumed}`);

    // BGM のスケジューラを進める（内部で currentTime を見て先読みする）
    const ctx = window.__soundForTest.ctx;
    let bgmNotes = 0;
    for (let i = 0; i < 40; i++) {         // 仮想時間で4秒ぶん
      audio.notes.length = 0;
      ctx.currentTime += 0.1;
      window.__soundForTest.scheduleAhead();
      bgmNotes += audio.notes.length;
    }
    check('BGM が先読みで予約される', bgmNotes > 8, `4秒で ${bgmNotes} 音`);
    check('BGM にハイハットが入る', audio.noises.length > 0, `${audio.noises.length} 回`);

    // 落下音（クールダウンを明けてから）
    pumpFrames(40, 16.7);
    audio.notes.length = 0;
    canvas.fire('pointerdown', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    check('落とすと効果音が鳴る', audio.notes.length > 0, `${audio.notes.length} 音`);

    // 進化音はステージが上がるほど高い
    const pitchOf = (stage) => {
      audio.notes.length = 0;
      window.__soundForTest.playMerge(stage, 1);
      return audio.notes.length ? audio.notes[0].freq : 0;
    };
    const low = pitchOf(2);
    const high = pitchOf(11);
    check('進化音がステージに応じて高くなる', high > low && low > 0,
      `002=${low.toFixed(0)}Hz 011=${high.toFixed(0)}Hz`);

    // 実際の合体でも鳴るか
    audio.notes.length = 0;
    g.createBody(1, 150, boardH - 40);
    g.createBody(1, 176, boardH - 40);
    for (let i = 0; i < 90 && audio.notes.length === 0; i++) pumpFrames(2, 16.7);
    check('合体すると進化音が鳴る', audio.notes.length > 0, `${audio.notes.length} 音`);

    // ミュート
    mute.fire('click', {});
    audio.notes.length = 0;
    window.__soundForTest.playMerge(5, 1);
    window.__soundForTest.playDrop();
    check('ミュート中は音を出さない', audio.notes.length === 0, `${audio.notes.length} 音`);
    check('ミュート状態がボタンに反映される', mute.getAttribute('aria-pressed') === 'true',
      String(mute.getAttribute('aria-pressed')));
    check('ミュート状態が localStorage に保存される', store['shusse-game-muted'] === '1',
      JSON.stringify(store));

    mute.fire('click', {});
    audio.notes.length = 0;
    window.__soundForTest.playDrop();
    check('解除すると再び音が鳴る', audio.notes.length > 0);
    check('解除がボタンに反映される', mute.getAttribute('aria-pressed') === 'false');

    // M キー
    fireWindow('keydown', { key: 'm' });
    check('M キーでミュートできる', window.__soundForTest.muted === true);
    fireWindow('keydown', { key: 'm' });
    check('M キーで解除できる', window.__soundForTest.muted === false);

    // 音域が常識的な範囲に収まっているか（周波数の計算ミス検出）
    audio.notes.length = 0;
    for (let i = 0; i < 60; i++) { ctx.currentTime += 0.1; window.__soundForTest.scheduleAhead(); }
    for (let st = 2; st <= 11; st++) window.__soundForTest.playMerge(st, 1);
    window.__soundForTest.playGameOver();
    window.__soundForTest.playTopMerge();
    const freqs = audio.notes.map((n) => n.freq);
    const lo = Math.min(...freqs);
    const hi = Math.max(...freqs);
    check('全ての音が可聴かつ常識的な音域に収まる', lo > 50 && hi < 4000,
      `${lo.toFixed(0)}Hz 〜 ${hi.toFixed(0)}Hz`);

    // --- スマホで起きがちな失敗の再現
    const snd = window.__soundForTest;

    // 1) 1回の操作で running にならない端末（iOS など）
    snd.ctx.state = 'suspended';
    audio.resumeFailures = 2;
    const before = audio.resumed;
    canvas.fire('pointerdown', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    check('1回で解除できなくても次の操作で再試行する', audio.resumed > before,
      `resume 呼び出し ${audio.resumed - before} 回`);
    canvas.fire('pointerdown', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerdown', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 200, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    check('操作を繰り返せば最終的に音が出る状態になる', snd.isRunning(), `state=${snd.ctx.state}`);

    // 2) 他アプリへ切り替えて戻ったとき（iOS は suspended のまま戻る）
    snd.requestBgm(true);
    document.hidden = true;
    document.fire('visibilitychange');
    check('画面が隠れたら BGM を止める', snd.bgmTimer === null);
    snd.ctx.state = 'suspended';
    document.hidden = false;
    document.fire('visibilitychange');
    check('復帰時に AudioContext を running へ戻す', snd.isRunning(), `state=${snd.ctx.state}`);
    audio.notes.length = 0;
    for (let i = 0; i < 20; i++) { snd.ctx.currentTime += 0.1; snd.scheduleAhead(); }
    check('復帰後に BGM が鳴り直す', audio.notes.length > 0, `${audio.notes.length} 音`);

    // 3) iOS のマナーモード対策（音声セッションの宣言）
    const soundSrc = fs.readFileSync(path.join(ROOT, 'js/sound.js'), 'utf8');
    check('iOS 向けに音声セッションを playback として宣言する',
      /navigator\.audioSession/.test(soundSrc) && /['"]playback['"]/.test(soundSrc),
      'マナーモードで Web Audio が消音される');

    // AudioContext が無い環境（古いブラウザ等）で落ちないこと
    const saved = global.AudioContext;
    delete global.AudioContext;
    let threw = null;
    try {
      const s2 = new window.SoundEngine();
      s2.unlock();
      s2.playDrop();
      s2.playMerge(3, 1);
      s2.playTopMerge();
      s2.playGameOver();
      s2.requestBgm(true);
      s2.setMuted(true);
      s2.stopScheduler();
    } catch (e) { threw = e; }
    global.AudioContext = saved;
    check('AudioContext が無い環境でも例外を出さない', threw === null, threw && threw.message);
  }

  console.log('\n[役職名の表示]');
  {
    const titles = window.CONFIG.titles;
    check('役職名が11件定義されている', titles.length === 11, titles.join('/'));
    // 落下待機中のプレートに、いま持っているオブジェクトの役職名が出ているか
    drawCalls.texts.length = 0;
    pumpFrames(3, 16.7);
    const held = titles[/* current */ 0] && drawCalls.texts.some((t) => titles.includes(t));
    check('落下待機中のイラストに役職名が描かれる', held,
      `描画された文字: ${[...new Set(drawCalls.texts)].join(' ')}`);

    // 合体させて、ポップアップに進化後の役職名が出るか
    drawCalls.texts.length = 0;
    const g = window.__gameForTest;
    const boardH = window.CONFIG.board.height;
    g.createBody(1, 200, boardH - 40);
    g.createBody(1, 226, boardH - 40);
    for (let i = 0; i < 90 && !drawCalls.texts.includes(titles[1]); i++) pumpFrames(2, 16.7);
    check('合体時に進化後の役職名が表示される', drawCalls.texts.includes(titles[1]),
      `期待 "${titles[1]}" / 実際 ${[...new Set(drawCalls.texts)].join(' ')}`);
    check('合体時に加算点も併記される', drawCalls.texts.some((t) => /^\+\d+$/.test(t)),
      [...new Set(drawCalls.texts)].join(' '));
    check('「連鎖」の文字は表示しない', !drawCalls.texts.some((t) => t.includes('連鎖')));
  }

  console.log('\n[スコアとゲームオーバー]');
  // 同じ位置に落とし続けて合体させ、最終的にゲームオーバーまで進める
  const forced = window.__gameForTest.forcedStage;
  let guard = 0;
  while (overlay.hidden && guard < 4000) {
    canvas.fire('pointerdown', { clientX: 150 + (guard % 5) * 20, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    canvas.fire('pointerup', { clientX: 150 + (guard % 5) * 20, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    pumpFrames(6, 16.7);
    guard++;
  }
  check('合体でスコアが加算される', parseInt(score.textContent, 10) > 0, `score=${score.textContent}`);

  // 撮影モードで上位の役職を固定すると、011 同士が消えて盤面が空くため終わらない
  const reachedOver = overlay.hidden === false;
  if (reachedOver) {
    check('ゲームオーバーでオーバーレイが出る', true);
    check('最終スコアが表示される',
      document.getElementById('final-score').textContent === parseInt(score.textContent, 10),
      `final=${document.getElementById('final-score').textContent} score=${score.textContent}`);
    check('ハイスコアが localStorage に保存される', store['shusse-game-best'] !== undefined,
      JSON.stringify(store));
  } else {
    check('盤面が空き続ける設定では終わらずに遊べる',
      forced > 0 && window.__gameForTest.state === 'playing',
      `forcedStage=${forced} state=${window.__gameForTest.state}`);
  }

  console.log('\n[リスタート]');
  restart.click();
  pumpFrames(10, 16.7);
  check('リスタートでオーバーレイが閉じる', overlay.hidden === true);
  check('リスタートでスコアが 0 に戻る', score.textContent === 0 || score.textContent === '0',
    `score=${score.textContent}`);
  check('リスタート後も描画が続く', drawCalls.errors.length === 0);

  fireWindow('resize', {});
  check('リサイズで例外が出ない', drawCalls.errors.length === 0);

  console.log('\n[トップに戻る]');
  {
    check('ゲームオーバー画面に「トップに戻る」がある', !!toTitle);

    const ctx2 = window.__soundForTest.ctx;
    toTitle.fire('click', {});
    check('トップに戻るとトップ画面が表示される',
      title.hidden === false && app.getAttribute('data-screen') === 'title',
      `title.hidden=${title.hidden} screen=${app.getAttribute('data-screen')}`);
    check('トップに戻るとゲームオーバー画面が閉じる', overlay.hidden === true);
    check('トップに戻ると盤面が空になる', window.__gameForTest.pieces().length === 0,
      `${window.__gameForTest.pieces().length} 個`);

    audio.notes.length = 0;
    for (let i = 0; i < 30; i++) { ctx2.currentTime += 0.1; window.__soundForTest.scheduleAhead(); }
    check('トップに戻ると BGM が止まる', audio.notes.length === 0, `${audio.notes.length} 音`);

    start.fire('click', {});
    audio.notes.length = 0;
    for (let i = 0; i < 30; i++) { ctx2.currentTime += 0.1; window.__soundForTest.scheduleAhead(); }
    check('トップから再開すると BGM が戻る', audio.notes.length > 0, `${audio.notes.length} 音`);
    check('トップから再開するとゲーム画面になる', app.getAttribute('data-screen') === 'playing');
  }

  console.log(failures === 0 ? '\nすべて成功\n' : `\n${failures} 件失敗\n`);
  process.exit(failures === 0 ? 0 : 1);
}, 50);
