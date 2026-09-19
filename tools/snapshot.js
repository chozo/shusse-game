// 盤面を実際にプレイした状態まで進めて、各オブジェクトの位置・角度を JSON に書き出す。
// tools/render_snapshot.py がこれを画像に合成し、描画と当たり判定の一致を目視確認できるようにする。
//   node tools/snapshot.js [落とす個数] [出力先]
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

global.window = global;
global.Matter = require(path.join(ROOT, 'vendor/matter.min.js'));

for (const f of ['js/config.js', 'js/stages.js', 'js/game.js']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const STEP = 1000 / 60;
const drops = parseInt(process.argv[2], 10) || 26;
const out = process.argv[3] || path.join(ROOT, 'tools/debug/snapshot.json');

let seed = 20260913;
Math.random = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};

const game = new window.Game();
let dropped = 0;

while (dropped < drops && game.state === 'playing') {
  if (game.canDrop()) {
    game.moveTo(40 + Math.random() * (window.CONFIG.board.width - 80));
    if (game.drop()) dropped++;
  }
  game.update(STEP);
}
// 落ち着くまで回す
for (let i = 0; i < 60 * 6; i++) game.update(STEP);

const bodies = game.pieces().map((b) => ({
  stage: b.plugin.shusse.stage,
  x: +b.position.x.toFixed(2),
  y: +b.position.y.toFixed(2),
  angle: +b.angle.toFixed(4),
}));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  score: game.score,
  state: game.state,
  dropped,
  bodies,
}, null, 1));

const byStage = {};
bodies.forEach((b) => { byStage[b.stage] = (byStage[b.stage] || 0) + 1; });
console.log(`${dropped} 個投下 → 盤面 ${bodies.length} 個 / スコア ${game.score} / ${game.state}`);
console.log('内訳:', Object.keys(byStage).sort().map((k) => `${String(k).padStart(3, '0')}×${byStage[k]}`).join(' '));
console.log('=>', path.relpath ? out : path.relative(ROOT, out));
