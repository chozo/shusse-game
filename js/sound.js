// BGM と効果音。Web Audio API で合成するので音声ファイルは持たない。
// AudioContext が使えない環境では全メソッドが無害な空振りになる。
(function () {
  'use strict';

  var C = window.CONFIG;

  // 平均律。n 半音上の周波数
  function note(base, n) { return base * Math.pow(2, n / 12); }

  var C3 = 130.81;
  var C5 = 523.25;

  // BGM のコード進行（Cmaj7 → Am7 → Dm7 → G7）。値は C3 からの半音
  var PROGRESSION = [
    { bass: 0, tones: [0, 4, 7, 11] },
    { bass: 9, tones: [9, 12, 16, 19] },
    { bass: 2, tones: [2, 5, 9, 12] },
    { bass: 7, tones: [7, 11, 14, 17] },
  ];
  var STEPS_PER_BAR = 8;                       // 8分音符
  var TOTAL_STEPS = PROGRESSION.length * STEPS_PER_BAR;
  var STEP_DUR = 60 / 104 / 2;                 // 104 BPM の8分音符

  // 進化音の音階（ペンタトニック）。添字 = ステージ番号 - 1
  var PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  /**
   * iOS では Web Audio の音が着信音スイッチ（マナーモード）で消される。
   * 音声セッションを再生用に宣言すると、マナーモードでも鳴るようになる。
   * Safari 16.4 未満や他ブラウザでは未対応なので、何もせず続行する。
   */
  function configureAudioSession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) { /* 未対応 */ }
  }

  function SoundEngine() {
    this.ctx = null;
    this.muted = false;
    this.bgmTimer = null;
    this.bgmWanted = false;
    this.step = 0;
    this.nextStepTime = 0;

    try {
      this.muted = localStorage.getItem(C.sound.storageKey) === '1';
    } catch (e) { /* 読めなくても既定値で続行 */ }
  }

  /** 実際に音が出せる状態か。suspended のままなら false */
  SoundEngine.prototype.isRunning = function () {
    return !!this.ctx && this.ctx.state === 'running';
  };

  /**
   * suspended を解除する。resume() は非同期なので、完了してから BGM を鳴らし直す。
   * iOS は他アプリへの切り替えなどで勝手に suspended に戻るため、復帰時にも呼ぶ。
   */
  SoundEngine.prototype.resume = function () {
    if (!this.ctx || this.ctx.state === 'running' || !this.ctx.resume) return;
    var self = this;
    var done = function () { if (self.bgmWanted && !self.muted) self.startBgm(); };
    var p;
    try { p = this.ctx.resume(); } catch (e) { return; }
    if (p && p.then) p.then(done, function () { /* 失敗しても次の操作で再試行する */ });
    else done();
  };

  /** ユーザー操作のたびに呼ぶ。1回で running にならない端末があるため何度でも試す。 */
  SoundEngine.prototype.unlock = function () {
    if (!this.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (e) {
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : C.sound.master;
      this.master.connect(this.ctx.destination);

      this.bgmBus = this.ctx.createGain();
      this.bgmBus.gain.value = C.sound.bgm;
      this.bgmBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = C.sound.sfx;
      this.sfxBus.connect(this.master);

      this.noise = this.makeNoise();
      configureAudioSession();
    }
    this.resume();
    if (this.bgmWanted) this.startBgm();
    return this.isRunning();
  };

  SoundEngine.prototype.makeNoise = function () {
    var len = Math.floor(this.ctx.sampleRate * 0.2);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  SoundEngine.prototype.setMuted = function (muted) {
    this.muted = muted;
    try { localStorage.setItem(C.sound.storageKey, muted ? '1' : '0'); } catch (e) { /* 保存できなくても続行 */ }
    if (this.master) {
      // 急に切ると耳障りなので短くフェードする
      var t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(muted ? 0.0001 : C.sound.master, t + 0.12);
    }
    if (muted) this.stopScheduler();
    else if (this.bgmWanted) this.startBgm();
  };

  SoundEngine.prototype.toggleMuted = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  // ------------------------------------------------------------ 音の素

  /**
   * 単音を鳴らす。
   * opts: { freq, toFreq, dur, gain, type, at, attack, bus }
   */
  SoundEngine.prototype.tone = function (opts) {
    if (!this.ctx || this.muted) return;
    var ctx = this.ctx;
    var t0 = opts.at || ctx.currentTime;
    var dur = opts.dur;
    var peak = opts.gain;

    var osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(opts.toFreq, t0 + dur);

    var g = ctx.createGain();
    var attack = opts.attack || 0.008;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(opts.bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  /** ノイズを一瞬鳴らす（ハイハット・着地感） */
  SoundEngine.prototype.hit = function (at, gain, hz, dur) {
    if (!this.ctx || this.muted || !this.noise) return;
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this.noise;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = hz;

    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(hp); hp.connect(g); g.connect(this.bgmBus);
    src.start(at);
    src.stop(at + dur + 0.02);
  };

  // ------------------------------------------------------------ 効果音

  SoundEngine.prototype.playDrop = function () {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime;
    this.tone({ freq: 320, toFreq: 150, dur: 0.09, gain: 0.18, type: 'sine', at: t });
  };

  /** 進化音。ステージが上がるほど高くなる */
  SoundEngine.prototype.playMerge = function (stage, chain) {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime;
    var n = PENTATONIC[Math.min(stage, PENTATONIC.length) - 1];
    // 連鎖するほどさらに上へ
    n += Math.min(4, Math.max(0, (chain || 1) - 1)) * 2;
    var f = note(C5, n);
    this.tone({ freq: f, dur: 0.12, gain: 0.2, type: 'triangle', at: t });
    this.tone({ freq: note(f, 7), dur: 0.16, gain: 0.16, type: 'triangle', at: t + 0.07 });
  };

  /** 011 同士が消えたときのファンファーレ */
  SoundEngine.prototype.playTopMerge = function () {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime;
    var self = this;
    [0, 4, 7, 12, 16].forEach(function (n, i) {
      self.tone({
        freq: note(C5, n), dur: 0.22, gain: 0.18, type: 'square',
        at: t + i * 0.075,
      });
    });
  };

  SoundEngine.prototype.playGameOver = function () {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime;
    var self = this;
    [0, -3, -5, -12].forEach(function (n, i) {
      self.tone({
        freq: note(C5, n), dur: 0.4, gain: 0.16, type: 'sawtooth',
        at: t + i * 0.16, attack: 0.02,
      });
    });
  };

  // ------------------------------------------------------------ BGM

  SoundEngine.prototype.requestBgm = function (on) {
    this.bgmWanted = on;
    if (on) this.startBgm();
    else this.stopScheduler();
  };

  SoundEngine.prototype.startBgm = function () {
    if (!this.ctx || this.muted || this.bgmTimer) return;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    var self = this;
    // 先読みしながら小刻みに予約する（setInterval だけではタイミングが揺れるため）
    this.bgmTimer = setInterval(function () { self.scheduleAhead(); }, 25);
    this.scheduleAhead();
  };

  SoundEngine.prototype.stopScheduler = function () {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  };

  SoundEngine.prototype.scheduleAhead = function () {
    // タイマー停止だけに頼らず、状態でも止める
    if (!this.ctx || !this.bgmWanted || this.muted) return;
    while (this.nextStepTime < this.ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP_DUR;
      this.step = (this.step + 1) % TOTAL_STEPS;
    }
  };

  SoundEngine.prototype.playStep = function (step, at) {
    var bar = Math.floor(step / STEPS_PER_BAR);
    var beat = step % STEPS_PER_BAR;
    var chord = PROGRESSION[bar];

    // ベース: 小節頭と3拍目
    if (beat === 0 || beat === 4) {
      this.tone({
        freq: note(C3, chord.bass - 12), dur: 0.42, gain: 0.3,
        type: 'triangle', at: at, bus: this.bgmBus, attack: 0.02,
      });
    }

    // アルペジオ: 8分音符でコードトーンを巡る
    var tone = chord.tones[beat % chord.tones.length];
    this.tone({
      freq: note(C3, tone + 12), dur: 0.26, gain: beat % 2 === 0 ? 0.13 : 0.08,
      type: 'triangle', at: at, bus: this.bgmBus,
    });

    // 裏拍に軽くハイハット
    if (beat % 2 === 1) this.hit(at, 0.035, 6000, 0.05);
  };

  window.SoundEngine = SoundEngine;
})();
