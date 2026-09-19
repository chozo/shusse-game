// ゲーム本体（物理・進化・スコア・ゲームオーバー判定）
(function () {
  'use strict';

  var Engine = Matter.Engine;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Composite = Matter.Composite;
  var Events = Matter.Events;

  var C = window.CONFIG;

  /**
   * stages.js のステージ定義に、実行時に必要な情報（画像・当たり判定の左右端）を足したもの。
   */
  function prepareStages(data) {
    return data.stages.map(function (s) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      s.verts.forEach(function (v) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });
      return {
        stage: s.stage,
        src: s.src,
        renderW: s.renderW,
        renderH: s.renderH,
        radius: s.radius,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        verts: s.verts,
        minX: minX, maxX: maxX, minY: minY, maxY: maxY,
        image: null,
      };
    });
  }

  function loadImages(stages) {
    return Promise.all(stages.map(function (s) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { s.image = img; resolve(); };
        img.onerror = function () { reject(new Error('画像を読み込めません: ' + s.src)); };
        img.src = s.src;
      });
    }));
  }

  function Game() {
    this.stages = prepareStages(window.STAGES_DATA);
    this.width = C.board.width;
    this.height = C.board.height;

    this.engine = Engine.create({
      enableSleeping: C.physics.enableSleeping,
      positionIterations: C.physics.positionIterations,
      velocityIterations: C.physics.velocityIterations,
    });
    this.engine.gravity.y = C.physics.gravity;
    this.world = this.engine.world;

    this.mergeQueue = [];
    this.effects = [];
    this.listeners = {};
    this.forcedStage = 0;

    var self = this;
    Events.on(this.engine, 'collisionStart', function (e) { self.onCollision(e); });

    this.buildWalls();
    this.reset();
  }

  Game.prototype.load = function () {
    return loadImages(this.stages);
  };

  Game.prototype.on = function (name, fn) {
    (this.listeners[name] || (this.listeners[name] = [])).push(fn);
  };

  Game.prototype.emit = function (name, payload) {
    (this.listeners[name] || []).forEach(function (fn) { fn(payload); });
  };

  // ------------------------------------------------------------ 初期化

  Game.prototype.buildWalls = function () {
    var t = C.wallThickness;
    var w = this.width;
    var h = this.height;
    var opts = {
      isStatic: true,
      friction: C.physics.friction,
      frictionStatic: C.physics.frictionStatic,
      restitution: C.physics.restitution,
      slop: C.physics.slop,
    };
    this.walls = [
      Bodies.rectangle(w / 2, h - C.floorHeight + t / 2, w + t * 2, t, opts),  // 床（上面 = 描画の地面）
      Bodies.rectangle(-t / 2, h / 2, t, h * 3, opts),          // 左壁
      Bodies.rectangle(w + t / 2, h / 2, t, h * 3, opts),       // 右壁
    ];
    Composite.add(this.world, this.walls);
  };

  Game.prototype.reset = function () {
    var self = this;
    Composite.allBodies(this.world).forEach(function (b) {
      if (!b.isStatic) Composite.remove(self.world, b);
    });

    this.mergeQueue.length = 0;
    this.effects.length = 0;
    this.score = 0;
    this.overTimer = 0;
    this.dangerRatio = 0;
    this.chainCount = 0;
    this.lastMergeAt = -Infinity;
    this.dropReadyAt = 0;
    this.now = 0;
    this.state = 'playing';
    this.holdX = this.width / 2;
    this.current = this.randomStage();
    this.next = this.randomStage();
    this.emit('score', this.score);
    this.emit('pieces', { current: this.current, next: this.next });
  };

  /** タイトル画面へ。盤面は空にして物理を止める */
  Game.prototype.showTitle = function () {
    this.reset();
    this.state = 'title';
  };

  /** タイトルからゲーム開始 */
  Game.prototype.start = function () {
    this.reset();
  };

  /**
   * 落下する役職を1種類に固定する（紹介動画の撮影用）。0 で通常の抽選に戻る。
   */
  Game.prototype.setForcedStage = function (stage) {
    this.forcedStage = (stage >= 1 && stage <= C.maxStage) ? stage : 0;
    if (this.forcedStage) {
      this.current = this.forcedStage;
      this.next = this.forcedStage;
      this.moveTo(this.holdX);
      this.emit('pieces', { current: this.current, next: this.next });
    }
  };

  Game.prototype.randomStage = function () {
    if (this.forcedStage) return this.forcedStage;
    var weights = C.spawnWeights;
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i + 1;
    }
    return 1;
  };

  // ------------------------------------------------------------ ボディ生成

  Game.prototype.createBody = function (stage, x, y) {
    var def = this.stages[stage - 1];
    // fromVertices は配列を書き換えることがあるのでコピーを渡す
    var verts = def.verts.map(function (v) { return { x: v.x, y: v.y }; });
    var body = Matter.Bodies.fromVertices(x, y, [verts], {
      restitution: C.physics.restitution,
      friction: C.physics.friction,
      frictionStatic: C.physics.frictionStatic,
      frictionAir: C.physics.frictionAir,
      density: C.physics.density,
      slop: C.physics.slop,
    });
    body.plugin.shusse = {
      stage: stage,
      merged: false,
      bornAt: this.now,
      graceMs: C.gameOver.graceMs,
    };
    Composite.add(this.world, body);
    return body;
  };

  /**
   * 待機位置の Y。通常の落下対象（001〜004）では C.holdY のままだが、
   * 撮影モードで大きい役職を指定したとき上端からはみ出さないよう下げる。
   */
  Game.prototype.holdYFor = function (stage) {
    var def = this.stages[stage - 1];
    return Math.max(C.holdY, -def.minY + 6);
  };

  Game.prototype.pieces = function () {
    return Composite.allBodies(this.world).filter(function (b) {
      return b.plugin.shusse && !b.plugin.shusse.merged;
    });
  };

  // ------------------------------------------------------------ 操作

  /** 待機オブジェクトのX座標を、壁からはみ出さない範囲に収めて設定する。 */
  Game.prototype.moveTo = function (x) {
    if (this.state !== 'playing') return;
    var def = this.stages[this.current - 1];
    var min = -def.minX;
    var max = this.width - def.maxX;
    this.holdX = Math.max(min, Math.min(max, x));
  };

  Game.prototype.canDrop = function () {
    return this.state === 'playing' && this.now >= this.dropReadyAt;
  };

  Game.prototype.drop = function () {
    if (!this.canDrop()) return false;
    var body = this.createBody(this.current, this.holdX, this.holdYFor(this.current));
    this.dropReadyAt = this.now + C.dropCooldownMs;
    this.current = this.next;
    this.next = this.randomStage();
    this.moveTo(this.holdX);  // 新しいサイズで再クランプ
    this.emit('pieces', { current: this.current, next: this.next });
    this.emit('drop', body);
    return true;
  };

  // ------------------------------------------------------------ 合体

  Game.prototype.onCollision = function (event) {
    if (this.state !== 'playing') return;
    for (var i = 0; i < event.pairs.length; i++) {
      var a = event.pairs[i].bodyA;
      var b = event.pairs[i].bodyB;
      var pa = a.plugin.shusse;
      var pb = b.plugin.shusse;
      if (!pa || !pb) continue;
      if (pa.merged || pb.merged) continue;
      if (pa.stage !== pb.stage) continue;
      // 衝突コールバック中に world を触らず、update 後にまとめて処理する
      pa.merged = true;
      pb.merged = true;
      this.mergeQueue.push([a, b]);
    }
  };

  Game.prototype.processMerges = function () {
    if (!this.mergeQueue.length) return;

    for (var i = 0; i < this.mergeQueue.length; i++) {
      var a = this.mergeQueue[i][0];
      var b = this.mergeQueue[i][1];
      var stage = a.plugin.shusse.stage;
      var x = (a.position.x + b.position.x) / 2;
      var y = (a.position.y + b.position.y) / 2;
      var vx = (a.velocity.x + b.velocity.x) / 2;
      var vy = (a.velocity.y + b.velocity.y) / 2;
      var av = (a.angularVelocity + b.angularVelocity) / 2;

      Composite.remove(this.world, a);
      Composite.remove(this.world, b);

      // 連鎖倍率
      if (this.now - this.lastMergeAt <= C.chain.windowMs) this.chainCount++;
      else this.chainCount = 1;
      this.lastMergeAt = this.now;
      var mult = Math.min(C.chain.max, 1 + (this.chainCount - 1) * C.chain.step);

      var gained;
      var title;
      if (stage >= C.maxStage) {
        // 最上位同士は進化先が無いので両方消滅＋ボーナス
        gained = Math.round(C.topMergeBonus * mult);
        title = C.titles[stage - 1];
        this.addEffect({ type: 'burst', x: x, y: y, stage: stage });
        this.emit('topmerge', stage);
      } else {
        var nextStage = stage + 1;
        gained = Math.round(nextStage * (nextStage + 1) / 2 * mult);
        title = C.titles[nextStage - 1];
        var body = this.createBody(nextStage, x, y);
        Body.setVelocity(body, { x: vx, y: vy });
        Body.setAngularVelocity(body, av);
        body.plugin.shusse.graceMs = C.mergeGraceMs;
        this.addEffect({ type: 'pop', x: x, y: y, stage: nextStage });
        this.emit('evolve', { stage: nextStage, chain: this.chainCount });
      }

      this.score += gained;
      this.addEffect({
        type: 'score', x: x, y: y,
        title: title, text: '+' + gained, chain: this.chainCount,
      });
      this.emit('score', this.score);
    }
    this.mergeQueue.length = 0;
  };

  // ------------------------------------------------------------ 演出

  Game.prototype.addEffect = function (e) {
    e.bornAt = this.now;
    this.effects.push(e);
  };

  Game.prototype.updateEffects = function () {
    var now = this.now;
    this.effects = this.effects.filter(function (e) {
      var life = e.type === 'score' ? C.effect.floatMs : C.effect.popMs;
      e.t = (now - e.bornAt) / life;
      return e.t < 1;
    });
  };

  // ------------------------------------------------------------ ゲームオーバー判定

  Game.prototype.checkGameOver = function (dt) {
    var pieces = this.pieces();
    var line = C.deadlineY;
    var violating = false;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var info = p.plugin.shusse;
      if (this.now - info.bornAt < info.graceMs) continue;   // 落下直後は除外
      if (p.speed > C.gameOver.settleSpeed) continue;        // 動いている間は除外
      if (p.bounds.min.y < line) { violating = true; break; }
    }

    this.overTimer = violating ? this.overTimer + dt : 0;
    this.dangerRatio = Math.min(1, this.overTimer / C.gameOver.overMs);

    if (this.overTimer >= C.gameOver.overMs) {
      this.state = 'gameover';
      this.emit('gameover', this.score);
    }
  };

  // ------------------------------------------------------------ ループ

  Game.prototype.update = function (dt) {
    this.now += dt;
    if (this.state === 'playing') {
      Engine.update(this.engine, dt);
      this.processMerges();
      this.checkGameOver(dt);
    }
    this.updateEffects();
  };

  window.Game = Game;
})();
