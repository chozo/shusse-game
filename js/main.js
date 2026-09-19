// 起動・入力・UI
(function () {
  'use strict';

  var C = window.CONFIG;
  var STEP = 1000 / 60;

  var el = {
    canvas: document.getElementById('board'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    next: document.getElementById('next-img'),
    overlay: document.getElementById('overlay'),
    finalScore: document.getElementById('final-score'),
    finalBest: document.getElementById('final-best'),
    newRecord: document.getElementById('new-record'),
    restart: document.getElementById('restart'),
    loading: document.getElementById('loading'),
    chart: document.getElementById('chart'),
    mute: document.getElementById('mute'),
    muteIcon: document.getElementById('mute-icon'),
    app: document.getElementById('app'),
    title: document.getElementById('title'),
    titleChart: document.getElementById('title-chart'),
    titleBest: document.getElementById('title-best'),
    start: document.getElementById('start'),
    forcedNote: document.getElementById('forced-note'),
    audioNote: document.getElementById('audio-note'),
    toTitle: document.getElementById('to-title'),
  };

  function loadBest() {
    try { return parseInt(localStorage.getItem(C.storageKey), 10) || 0; }
    catch (e) { return 0; }
  }

  function saveBest(v) {
    try { localStorage.setItem(C.storageKey, String(v)); } catch (e) { /* 保存できなくても続行 */ }
  }

  /**
   * URL の ?p=001〜011 で落下する役職を1種類に固定する（紹介動画の撮影用）。
   * 001 形式でも 1 形式でも受け付ける。範囲外・未指定なら 0（通常の抽選）。
   */
  function parseForcedStage(search) {
    var m = /[?&]p=([^&#]*)/.exec(search || '');
    if (!m) return 0;
    var raw = decodeURIComponent(m[1]);
    if (!/^\d{1,3}$/.test(raw)) return 0;
    var n = parseInt(raw, 10);
    return (n >= 1 && n <= C.maxStage) ? n : 0;
  }
  window.__parseForcedStage = parseForcedStage;   // tools/dom_test.js から検証する

  var game = new window.Game();
  var renderer = new window.Renderer(el.canvas, game);
  var sound = new window.SoundEngine();
  window.__gameForTest = game;    // tools/dom_test.js から盤面を操作するためのフック
  window.__soundForTest = sound;
  var forcedStage = parseForcedStage(window.location.search);
  if (forcedStage) game.setForcedStage(forcedStage);

  var best = loadBest();
  el.best.textContent = best;
  el.next.src = game.stages[game.next - 1].src;

  // ------------------------------------------------------------ 画面遷移

  function showScreen(name) {
    el.app.setAttribute('data-screen', name);
    el.title.hidden = name !== 'title';
    el.overlay.hidden = name !== 'gameover';
  }

  if (forcedStage) {
    // 動画に映り込まないよう、表示はトップ画面だけに出す
    el.forcedNote.textContent = '撮影モード: ' + C.titles[forcedStage - 1] + ' だけが落ちてきます';
    el.forcedNote.hidden = false;
  }

  if (/[?&]debug=1(&|$)/.test(window.location.search)) {
    el.audioNote.hidden = false;
    setInterval(function () {
      var ctx = sound.ctx;
      el.audioNote.textContent = [
        'ctx=' + (ctx ? ctx.state : 'なし'),
        'session=' + ((window.navigator && navigator.audioSession) ? navigator.audioSession.type : '未対応'),
        'muted=' + sound.muted,
        'bgm=' + (sound.bgmTimer ? 'on' : 'off'),
      ].join(' / ');
    }, 500);
  }

  function goTitle() {
    sound.requestBgm(false);
    game.showTitle();
    el.titleBest.textContent = best;
    showScreen('title');
  }

  function startGame() {
    unlockAudio();
    game.start();
    showScreen('playing');
    sound.requestBgm(true);   // BGM はゲーム開始から
  }

  // ------------------------------------------------------------ サウンド

  function refreshMuteButton() {
    el.mute.setAttribute('aria-pressed', sound.muted ? 'true' : 'false');
    el.mute.setAttribute('aria-label', sound.muted ? '音を出す' : '音を消す');
    el.muteIcon.textContent = sound.muted ? '×' : '♪';
  }
  refreshMuteButton();

  // 自動再生制限があるので、最初の操作を受けてから音を出す。
  // 1回の操作では running にならない端末があるので、鳴るまで毎回試す。
  function unlockAudio() {
    if (sound.isRunning()) return;
    sound.unlock();
  }

  el.mute.addEventListener('click', function () {
    unlockAudio();
    sound.toggleMuted();
    if (!sound.muted && game.state === 'playing') sound.requestBgm(true);
    refreshMuteButton();
  });

  game.on('drop', function () { sound.playDrop(); });
  game.on('evolve', function (e) { sound.playMerge(e.stage, e.chain); });
  game.on('topmerge', function () { sound.playTopMerge(); });

  // 画面が隠れている間は鳴らさない。
  // iOS は復帰しても AudioContext が suspended のままなので、明示的に戻す。
  document.addEventListener('visibilitychange', function () {
    if (!sound.ctx) return;
    if (document.hidden) {
      sound.stopScheduler();
    } else {
      sound.resume();
      if (!sound.muted && game.state === 'playing') sound.startBgm();
    }
  });

  // ------------------------------------------------------------ 進化表

  var droppable = C.spawnWeights.length;   // 落下対象は先頭から spawnWeights の数だけ
  var ROW_SIZES = [4, 4, 3];                // トップ画面の進化図の段組み

  var titleRows = ROW_SIZES.map(function (n, i) {
    var row = document.createElement('ol');
    // 2段目以降は先頭にも矢印を出して、前の段からの続きであることを示す
    row.className = 'title-row' + (i > 0 ? ' continued' : '');
    el.titleChart.appendChild(row);
    return row;
  });

  function titleRowFor(stage) {
    var upto = 0;
    for (var i = 0; i < ROW_SIZES.length; i++) {
      upto += ROW_SIZES[i];
      if (stage <= upto) return titleRows[i];
    }
    return titleRows[titleRows.length - 1];   // 段組みより画像が多い場合は最終段へ
  }

  game.stages.forEach(function (s) {
    var title = C.titles[s.stage - 1];

    // 画面下のミニ進化表
    var li = document.createElement('li');
    var img = document.createElement('img');
    img.src = s.src;
    img.alt = title;
    li.appendChild(img);
    el.chart.appendChild(li);

    // トップ画面の進化図（役職名つき）
    var item = document.createElement('li');
    if (s.stage <= droppable) item.className = 'droppable';
    var fig = document.createElement('figure');
    var figImg = document.createElement('img');
    figImg.src = s.src;
    figImg.alt = '';
    var cap = document.createElement('figcaption');
    cap.textContent = title;
    fig.appendChild(figImg);
    fig.appendChild(cap);
    item.appendChild(fig);
    titleRowFor(s.stage).appendChild(item);
  });

  // ------------------------------------------------------------ イベント

  game.on('score', function (v) { el.score.textContent = v; });

  game.on('pieces', function (p) {
    el.next.src = game.stages[p.next - 1].src;
  });

  game.on('gameover', function (score) {
    var record = score > best;
    if (record) { best = score; saveBest(best); el.best.textContent = best; }
    el.finalScore.textContent = score;
    el.finalBest.textContent = best;
    el.newRecord.hidden = !record;
    showScreen('gameover');
    sound.requestBgm(false);
    sound.playGameOver();
  });

  el.start.addEventListener('click', startGame);
  el.restart.addEventListener('click', startGame);
  el.toTitle.addEventListener('click', goTitle);

  // ------------------------------------------------------------ 入力

  function toLogicalX(clientX) {
    var rect = el.canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * C.board.width;
  }

  var pointerActive = false;

  el.canvas.addEventListener('pointerdown', function (ev) {
    unlockAudio();
    if (game.state !== 'playing') return;
    pointerActive = true;
    el.canvas.setPointerCapture(ev.pointerId);
    game.moveTo(toLogicalX(ev.clientX));
    ev.preventDefault();
  });

  el.canvas.addEventListener('pointermove', function (ev) {
    if (game.state !== 'playing') return;
    // マウスは常時追従、タッチは押している間だけ追従
    if (ev.pointerType === 'mouse' || pointerActive) game.moveTo(toLogicalX(ev.clientX));
  });

  el.canvas.addEventListener('pointerup', function (ev) {
    if (!pointerActive) return;
    pointerActive = false;
    game.moveTo(toLogicalX(ev.clientX));
    game.drop();
    ev.preventDefault();
  });

  el.canvas.addEventListener('pointercancel', function () { pointerActive = false; });

  var held = {};
  window.addEventListener('keydown', function (ev) {
    unlockAudio();
    if (ev.key === 'm' || ev.key === 'M') {
      sound.toggleMuted();
      if (!sound.muted && game.state === 'playing') sound.requestBgm(true);
      refreshMuteButton();
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      held[ev.key] = true;
      ev.preventDefault();
    } else if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'ArrowDown') {
      if (game.state === 'playing') game.drop();
      else startGame();
      ev.preventDefault();
    } else if (ev.key === 'h' || ev.key === 'H') {
      renderer.showHitbox = !renderer.showHitbox;
    }
  });

  window.addEventListener('keyup', function (ev) { held[ev.key] = false; });

  window.addEventListener('resize', function () { renderer.resize(); });

  // ------------------------------------------------------------ ループ

  function applyKeyboardMove() {
    var d = 0;
    if (held.ArrowLeft) d -= 7;
    if (held.ArrowRight) d += 7;
    if (d) game.moveTo(game.holdX + d);
  }

  var last = 0;
  var acc = 0;

  function frame(now) {
    if (!last) last = now;
    var dt = Math.min(now - last, 100);   // タブ復帰時に一気に進まないよう上限を設ける
    last = now;

    applyKeyboardMove();

    acc += dt;
    while (acc >= STEP) {
      game.update(STEP);
      acc -= STEP;
    }
    renderer.draw();
    requestAnimationFrame(frame);
  }

  game.load().then(function () {
    el.loading.hidden = true;
    el.next.src = game.stages[game.next - 1].src;
    goTitle();
    requestAnimationFrame(frame);
  }).catch(function (err) {
    el.loading.textContent = err.message;
    console.error(err);
  });
})();
