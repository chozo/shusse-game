// ブラウザ無しでゲームロジックを検証する headless シミュレータ。
//   node tools/simulate.js [試行回数]
// 物理・合体・スコア・ゲームオーバーが破綻なく回ることを確認する。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

global.window = global;
global.Matter = require(path.join(ROOT, 'vendor/matter.min.js'));

for (const f of ['js/config.js', 'js/stages.js', 'js/game.js']) {
  // 各スクリプトは window へ代入する前提なので、そのまま評価する
  (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const STEP = 1000 / 60;

function run(seed) {
  let s = seed;
  Math.random = () => {
    // 再現性のある擬似乱数（xorshift）
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  const game = new window.Game();
  const stats = { merges: 0, maxStage: 1, drops: 0, evolveCounts: {} };

  game.on('evolve', ({ stage }) => {
    stats.merges++;
    stats.maxStage = Math.max(stats.maxStage, stage);
    stats.evolveCounts[stage] = (stats.evolveCounts[stage] || 0) + 1;
  });

  const t0 = Date.now();
  let steps = 0;
  const maxSteps = 60 * 60 * 5;   // 5分ぶん

  while (game.state === 'playing' && steps < maxSteps) {
    if (game.canDrop()) {
      game.moveTo(Math.random() * window.CONFIG.board.width);
      if (game.drop()) stats.drops++;
    }
    game.update(STEP);
    steps++;

    // 不正な状態になっていないか
    for (const b of game.pieces()) {
      if (!isFinite(b.position.x) || !isFinite(b.position.y)) {
        throw new Error(`座標が NaN/Infinity になりました (stage ${b.plugin.shusse.stage})`);
      }
      if (b.position.y > window.CONFIG.board.height + 200) {
        throw new Error(`オブジェクトが床を突き抜けました (stage ${b.plugin.shusse.stage}, y=${b.position.y.toFixed(1)})`);
      }
    }
  }

  return {
    seed,
    score: game.score,
    state: game.state,
    seconds: (steps * STEP / 1000).toFixed(1),
    bodies: game.pieces().length,
    wallMs: Date.now() - t0,
    ...stats,
  };
}

const trials = parseInt(process.argv[2], 10) || 5;
console.log('ステージ数:', window.STAGES_DATA.stages.length);
console.log('各ステージの頂点数:', window.STAGES_DATA.stages.map((s) => s.verts.length).join(', '));
console.log('');

let allOk = true;
for (let i = 1; i <= trials; i++) {
  try {
    const r = run(i * 7919);
    const top = Object.keys(r.evolveCounts).map(Number).sort((a, b) => a - b).pop() || '-';
    console.log(
      `#${i} 結果=${r.state} スコア=${r.score} 落下=${r.drops} 合体=${r.merges} ` +
      `到達=${String(top).padStart(2, '0')} 残=${r.bodies}個 ゲーム内${r.seconds}秒 実時間${r.wallMs}ms`
    );
    if (r.state !== 'gameover' && r.bodies > 0) {
      console.log('   ! 時間切れ（ゲームオーバーに到達せず）');
    }
  } catch (e) {
    allOk = false;
    console.log(`#${i} 失敗: ${e.message}`);
  }
}
process.exit(allOk ? 0 : 1);
