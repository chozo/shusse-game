// Canvas 描画
(function () {
  'use strict';

  var C = window.CONFIG;

  var LABEL_FONT = 'bold 15px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';

  /** 角丸矩形のパスを引く（ctx.roundRect に頼らない） */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 役職名のプレートを (cx, cy) 中心に描く */
  function drawLabel(ctx, cx, cy, text, boardW) {
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 20;
    var h = C.label.height;
    var x = Math.max(4, Math.min(boardW - w - 4, cx - w / 2));
    roundRect(ctx, x, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = 'rgba(30, 44, 60, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + w / 2, cy + 0.5);
  }

  function Renderer(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.showHitbox = false;
    this.resize();
  }

  /** 論理サイズ 480x720 を devicePixelRatio に合わせた実ピクセルへ割り当てる。 */
  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(C.board.width * dpr);
    this.canvas.height = Math.round(C.board.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingQuality = 'high';
  };

  Renderer.prototype.draw = function () {
    var ctx = this.ctx;
    var g = this.game;
    var w = C.board.width;
    var h = C.board.height;

    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h);
    this.drawDeadline(ctx, w);

    var pieces = g.pieces();
    for (var i = 0; i < pieces.length; i++) this.drawBody(ctx, pieces[i]);

    this.drawHeld(ctx);
    this.drawEffects(ctx);
  };

  Renderer.prototype.drawBackground = function (ctx, w, h) {
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#dbe7f3');
    grad.addColorStop(1, '#f4f1e8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 地面。この上面にオブジェクトが着地する（js/game.js の床と同じ高さ）
    ctx.fillStyle = 'rgba(90, 70, 45, 0.18)';
    ctx.fillRect(0, h - C.floorHeight, w, C.floorHeight);
  };

  Renderer.prototype.drawDeadline = function (ctx, w) {
    var g = this.game;
    var y = C.deadlineY;
    var danger = g.dangerRatio || 0;

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    if (danger > 0) {
      // 危険度に応じて赤く点滅させる
      var pulse = 0.4 + 0.6 * Math.abs(Math.sin(g.now / 120));
      ctx.strokeStyle = 'rgba(220, 50, 50, ' + (0.35 + 0.65 * danger * pulse) + ')';
      ctx.lineWidth = 2 + 2 * danger;
    } else {
      ctx.strokeStyle = 'rgba(200, 60, 60, 0.35)';
    }
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawBody = function (ctx, body) {
    var info = body.plugin.shusse;
    var def = this.game.stages[info.stage - 1];
    if (!def.image) return;

    // 生成直後は少しだけ拡大して現れる
    var age = this.game.now - info.bornAt;
    var scale = 1;
    if (age < C.effect.popMs) {
      var t = age / C.effect.popMs;
      scale = 1 + 0.18 * (1 - t) * Math.sin(t * Math.PI);
    }

    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(
      def.image,
      def.offsetX - def.renderW / 2,
      def.offsetY - def.renderH / 2,
      def.renderW,
      def.renderH
    );
    ctx.restore();

    if (this.showHitbox) this.drawHitbox(ctx, body);
  };

  Renderer.prototype.drawHitbox = function (ctx, body) {
    var v = body.vertices;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 80, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (var i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 128, 255, 0.9)';
    ctx.fillRect(body.position.x - 2, body.position.y - 2, 4, 4);
    ctx.restore();
  };

  /** 落下待機中のオブジェクトとガイド線 */
  Renderer.prototype.drawHeld = function (ctx) {
    var g = this.game;
    if (g.state !== 'playing') return;
    var def = g.stages[g.current - 1];
    if (!def.image) return;

    var ready = g.canDrop();

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = ready ? 'rgba(60, 80, 110, 0.35)' : 'rgba(60, 80, 110, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var holdY = g.holdYFor(g.current);
    ctx.moveTo(g.holdX, holdY + def.maxY + C.label.gap + C.label.height);   // 役職プレートの下から引く
    ctx.lineTo(g.holdX, C.board.height);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.35;
    ctx.translate(g.holdX, holdY);
    ctx.drawImage(
      def.image,
      def.offsetX - def.renderW / 2,
      def.offsetY - def.renderH / 2,
      def.renderW,
      def.renderH
    );
    ctx.restore();

    // 役職名はイラストに被せず、その真下に置く
    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.4;
    drawLabel(ctx, g.holdX, holdY + def.maxY + C.label.gap + C.label.height / 2,
      C.titles[g.current - 1], C.board.width);
    ctx.restore();
  };

  Renderer.prototype.drawEffects = function (ctx) {
    var effects = this.game.effects;
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      var t = e.t;
      if (e.type === 'pop' || e.type === 'burst') {
        var def = this.game.stages[e.stage - 1];
        var r = def.radius * (0.6 + 1.0 * t);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = e.type === 'burst' ? '#e8b93a' : '#ffffff';
        ctx.lineWidth = (e.type === 'burst' ? 8 : 5) * (1 - t);
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'score') {
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        ctx.translate(e.x, e.y - 44 * t);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        // 連鎖中は色を変えて勢いを出す
        ctx.fillStyle = e.chain > 1 ? '#d9581f' : '#2b4a72';
        if (e.title) {
          ctx.font = 'bold 28px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
          ctx.strokeText(e.title, 0, 0);
          ctx.fillText(e.title, 0, 0);
          ctx.font = 'bold 16px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
          ctx.lineWidth = 4;
          ctx.strokeText(e.text, 0, 21);
          ctx.fillText(e.text, 0, 21);
        } else {
          ctx.font = 'bold 24px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
          ctx.strokeText(e.text, 0, 0);
          ctx.fillText(e.text, 0, 0);
        }
        ctx.restore();
      }
    }
  };

  window.Renderer = Renderer;
})();
