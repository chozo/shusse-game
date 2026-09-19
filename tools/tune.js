// 盤面サイズ・成長率を振って難易度を測る。
//   node tools/tune.js
// ランダム投下（＝下手なプレイ）でどこまで到達するかを指標にする。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

global.window = global;
global.Matter = require(path.join(ROOT, 'vendor/matter.min.js'));

const sources = ['js/config.js', 'js/stages.js', 'js/game.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));

function reload() {
  for (const src of sources) (0, eval)(src);
}
reload();

const STEP = 1000 / 60;

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function playOnce(seed) {
  Math.random = seededRandom(seed);
  const game = new window.Game();
  let maxStage = 1;
  game.on('evolve', (e) => { if (e.stage > maxStage) maxStage = e.stage; });

  let steps = 0;
  const maxSteps = 60 * 60 * 6;
  while (game.state === 'playing' && steps < maxSteps) {
    if (game.canDrop()) {
      game.moveTo(Math.random() * window.CONFIG.board.width);
      game.drop();
    }
    game.update(STEP);
    steps++;
  }
  return { score: game.score, maxStage, seconds: steps * STEP / 1000, finished: game.state === 'gameover' };
}

function evaluate(label, trials) {
  const rs = [];
  for (let i = 1; i <= trials; i++) rs.push(playOnce(i * 7919));
  const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const stages = rs.map((r) => r.maxStage).sort((a, b) => a - b);
  console.log(
    `${label.padEnd(30)} 平均スコア ${String(Math.round(avg((r) => r.score))).padStart(6)}` +
    `  平均到達 ${avg((r) => r.maxStage).toFixed(1)}` +
    `  到達分布 ${stages.join(',')}` +
    `  平均 ${avg((r) => r.seconds).toFixed(0)}秒`
  );
}

const TRIALS = 8;

console.log('■ 盤面の高さを振る（幅480・現行の当たり判定サイズのまま）');
for (const h of [720, 660, 620, 580, 540, 500]) {
  window.CONFIG.board.height = h;
  reload.length; // noop
  evaluate(`高さ ${h}`, TRIALS);
}
window.CONFIG.board.height = 720;

console.log('\n■ 落下オブジェクトの重みを振る（高さ 600）');
window.CONFIG.board.height = 600;
for (const w of [[40, 30, 20, 10], [55, 25, 15, 5], [70, 20, 8, 2], [100, 0, 0, 0]]) {
  window.CONFIG.spawnWeights = w;
  evaluate(`重み ${w.join('/')}`, TRIALS);
}
