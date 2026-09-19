// 仕様の細部を検証する。
//   node tools/test.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);

global.window = global;
global.Matter = require(path.join(ROOT, 'vendor/matter.min.js'));

for (const f of ['js/config.js', 'js/stages.js', 'js/game.js']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const C = window.CONFIG;
const STEP = 1000 / 60;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    failures++;
    console.log(`  NG   ${name}${detail ? '  → ' + detail : ''}`);
  }
}

function settle(game, ms) {
  for (let t = 0; t < ms; t += STEP) game.update(STEP);
}

// ---------------------------------------------------------------- 当たり判定

console.log('\n[当たり判定ポリゴン]');
{
  const game = new window.Game();
  let allConvex = true;
  let allSingle = true;
  let detail = '';
  for (let s = 1; s <= C.maxStage; s++) {
    const body = game.createBody(s, 240, 300);
    if (body.parts.length !== 1) { allSingle = false; detail = `stage ${s} が ${body.parts.length} パーツに分割された`; }
    if (!Matter.Vertices.isConvex(body.vertices)) { allConvex = false; detail = `stage ${s} が凸でない`; }
    Matter.Composite.remove(game.world, body);
  }
  check('11ステージすべて単一の凸ボディとして生成される', allConvex && allSingle, detail);

  // 面積が進化順に単調増加しているか
  let monotonic = true;
  let prev = 0;
  const areas = [];
  for (let s = 1; s <= C.maxStage; s++) {
    const body = game.createBody(s, 240, 300);
    areas.push(Math.round(body.area));
    if (body.area <= prev) monotonic = false;
    prev = body.area;
    Matter.Composite.remove(game.world, body);
  }
  check('当たり判定の面積が 001→011 で単調増加', monotonic, areas.join(' < '));
}

// ---------------------------------------------------------------- 壁のクランプ

console.log('\n[落下位置のクランプ]');
{
  const game = new window.Game();
  let ok = true;
  let detail = '';
  for (let s = 1; s <= 4; s++) {
    game.current = s;
    const def = game.stages[s - 1];
    game.moveTo(-9999);
    if (game.holdX + def.minX < -0.01) { ok = false; detail = `stage ${s} が左壁を越える`; }
    game.moveTo(9999);
    if (game.holdX + def.maxX > C.board.width + 0.01) { ok = false; detail = `stage ${s} が右壁を越える`; }
  }
  check('001〜004 が左右の壁からはみ出さない', ok, detail);
}

// ---------------------------------------------------------------- 地面

console.log('\n[地面の高さ]');
{
  const game = new window.Game();
  const drawn = C.board.height - C.floorHeight;   // js/render.js が描く地面の上端
  const floor = game.walls[0];
  check('物理の床の上面が描画の地面と一致する', floor.bounds.min.y === drawn,
    `床=${floor.bounds.min.y} 描画=${drawn}`);

  const body = game.createBody(1, 240, 200);
  settle(game, 4000);
  const sink = body.bounds.max.y - drawn;
  check('着地したオブジェクトが地面に沈み込まない', sink < 1,
    `${sink.toFixed(2)}px 沈んでいる`);
  check('着地したオブジェクトが地面から浮かない', sink > -2,
    `${(-sink).toFixed(2)}px 浮いている`);
}

// ---------------------------------------------------------------- 役職プレートの位置

console.log('\n[役職プレートの配置]');
{
  const game = new window.Game();
  let overlap = '';
  let crossing = '';
  for (let s = 1; s <= 4; s++) {          // 落下対象は 001〜004 のみ
    const def = game.stages[s - 1];
    const bottom = C.holdY + def.maxY;                      // イラスト下端
    const top = C.holdY + def.maxY + C.label.gap - C.label.height / 2;
    const plateBottom = top + C.label.height;
    // 足元に掛かるのは許容し、顔や胴体まで隠していないかを見る（高さの15%まで）
    const limit = def.renderH * 0.15;
    if (bottom - top > limit) {
      overlap += `${C.titles[s - 1]}(${(bottom - top).toFixed(1)}px 掛かる / 上限 ${limit.toFixed(1)}px) `;
    }
    if (plateBottom >= C.deadlineY) crossing += `${C.titles[s - 1]}(${plateBottom.toFixed(0)}≧${C.deadlineY}) `;
  }
  check('役職プレートがイラスト本体を覆わない', overlap === '', overlap);
  check('役職プレートがデッドラインを越えない', crossing === '', crossing);
}

// ---------------------------------------------------------------- 合体とスコア

console.log('\n[合体とスコア]');
{
  // 各ステージの合体で想定どおりのスコアが入るか（連鎖倍率を避けるため毎回新しい Game を使う）
  let ok = true;
  const got = [];
  for (let s = 1; s < C.maxStage; s++) {
    const game = new window.Game();
    const k = s + 1;
    const expected = k * (k + 1) / 2;
    game.createBody(s, 200, 600);
    game.createBody(s, 230, 600);
    settle(game, 2000);
    got.push(`${String(s).padStart(2, '0')}+${String(s).padStart(2, '0')}→${String(k).padStart(2, '0')}:${game.score}`);
    if (game.score !== expected) ok = false;
  }
  check('進化スコアが k(k+1)/2 になる', ok, got.join(' '));
}

{
  const game = new window.Game();
  game.createBody(C.maxStage, 200, 600);
  game.createBody(C.maxStage, 260, 600);
  settle(game, 2500);
  const remaining = game.pieces().filter((b) => b.plugin.shusse.stage === C.maxStage).length;
  check('011 同士は両方消滅する', remaining === 0, `残 ${remaining} 個`);
  check('011 同士でボーナス加算', game.score === C.topMergeBonus, `score=${game.score}`);
}

{
  // 3個同時接触で「1個だけ消える」等の破綻が起きないこと
  const game = new window.Game();
  game.createBody(1, 200, 640);
  game.createBody(1, 224, 640);
  game.createBody(1, 248, 640);
  settle(game, 3000);
  const stages = game.pieces().map((b) => b.plugin.shusse.stage).sort();
  check('001 を3個並べても消失・重複が起きない', stages.length >= 1 && stages.length <= 2, `残: [${stages}]`);
}

// ---------------------------------------------------------------- ゲームオーバー

console.log('\n[ゲームオーバー判定]');
{
  const game = new window.Game();
  // デッドライン直下に落ち着くだけでは終わらない
  game.createBody(1, 240, 700);
  settle(game, 5000);
  check('床に1個置いただけでは終わらない', game.state === 'playing', `state=${game.state}`);
}

{
  // ルールそのものの検証: 無重力にして静止した状態を作り、ライン超過だけを見る
  const game = new window.Game();
  game.engine.gravity.y = 0;
  game.createBody(3, 240, C.deadlineY + 60);   // ライン下に完全に収まる位置
  settle(game, C.gameOver.graceMs + C.gameOver.overMs + 600);
  check('ライン下で静止していれば終わらない', game.state === 'playing', `state=${game.state}`);
}

{
  const game = new window.Game();
  game.engine.gravity.y = 0;
  const body = game.createBody(3, 240, C.deadlineY - 20);   // 上端がラインを越える位置
  settle(game, C.gameOver.graceMs - 200);
  const early = game.state;
  settle(game, C.gameOver.overMs + 400);
  check('猶予時間内はゲームオーバーにならない', early === 'playing', `state=${early}`);
  check('ライン超過が継続するとゲームオーバー', game.state === 'gameover',
    `state=${game.state} 上端y=${body.bounds.min.y.toFixed(1)} ライン=${C.deadlineY}`);
}

{
  // 実プレイ経路の検証: ランダムに落とし続ければ必ずゲームオーバーで終わる
  const results = [];
  let allOver = true;
  for (let trial = 0; trial < 5; trial++) {
    let seed = (trial + 1) * 7919;
    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    };
    const original = Math.random;
    Math.random = rand;
    const game = new window.Game();
    let steps = 0;
    while (game.state === 'playing' && steps < 60 * 60 * 6) {
      if (game.canDrop()) { game.moveTo(rand() * C.board.width); game.drop(); }
      game.update(STEP);
      steps++;
      for (const b of game.pieces()) {
        if (!isFinite(b.position.x) || !isFinite(b.position.y) || b.position.y > C.board.height + 200) {
          throw new Error('オブジェクトが破綻しました');
        }
      }
    }
    Math.random = original;
    results.push(`${game.score}点/${(steps * STEP / 1000).toFixed(0)}秒`);
    if (game.state !== 'gameover') allOver = false;
  }
  check('ランダムに落とし続けると必ずゲームオーバーで終わる', allOver, results.join(' '));
  check('プレイ中に座標破綻・床抜けが起きない', true, results.join(' '));
}

{
  const game = new window.Game();
  game.state = 'gameover';
  game.reset();
  check('リセットで盤面が空になる', game.pieces().length === 0);
  check('リセットでスコアが 0 に戻る', game.score === 0);
  check('リセットで操作可能に戻る', game.state === 'playing' && game.canDrop());
}

// ---------------------------------------------------------------- 撮影モード

console.log('\n[撮影モード（役職の固定）]');
{
  let ok = true;
  const detail = [];
  for (let st = 1; st <= C.maxStage; st++) {
    const game = new window.Game();
    game.setForcedStage(st);
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(game.randomStage());
    game.drop();
    const bodies = game.pieces();
    if (seen.size !== 1 || !seen.has(st) || bodies.length !== 1 || bodies[0].plugin.shusse.stage !== st) {
      ok = false;
      detail.push(`${st}:[${[...seen]}]`);
    }
  }
  check('001〜011 のいずれを指定してもそれだけが落ちてくる', ok, detail.join(' '));
}

{
  const game = new window.Game();
  game.setForcedStage(7);
  game.setForcedStage(0);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(game.randomStage());
  check('0 を指定すると通常の抽選（001〜004）に戻る',
    seen.size === 4 && [...seen].sort().join(',') === '1,2,3,4', `[${[...seen].sort()}]`);

  const g2 = new window.Game();
  g2.setForcedStage(99);
  check('範囲外の指定は無視して通常抽選のまま', g2.forcedStage === 0, String(g2.forcedStage));
}

{
  const game = new window.Game();
  game.setForcedStage(11);
  game.start();   // ゲーム開始で解除されないこと
  check('ゲーム開始・リセットしても固定が維持される',
    game.forcedStage === 11 && game.current === 11 && game.next === 11,
    `forced=${game.forcedStage} current=${game.current} next=${game.next}`);
}

{
  // 大きい役職を固定しても待機中に上端からはみ出さない
  const game = new window.Game();
  let over = '';
  let moved = '';
  for (let st = 1; st <= C.maxStage; st++) {
    const def = game.stages[st - 1];
    const top = game.holdYFor(st) + def.minY;
    if (top < 0) over += `${C.titles[st - 1]}(y=${top.toFixed(0)}) `;
    if (st <= 4 && game.holdYFor(st) !== C.holdY) moved += `${C.titles[st - 1]} `;
  }
  check('どの役職を固定しても待機位置が画面上端を超えない', over === '', over);
  check('通常の落下対象（001〜004）の待機位置は変わらない', moved === '', moved);
}

{
  // 固定したまま左右いっぱいに動かしても壁からはみ出さない
  const game = new window.Game();
  let bad = '';
  for (let st = 1; st <= C.maxStage; st++) {
    game.setForcedStage(st);
    const def = game.stages[st - 1];
    game.moveTo(-9999);
    if (game.holdX + def.minX < -0.01) bad += `${C.titles[st - 1]}(左) `;
    game.moveTo(9999);
    if (game.holdX + def.maxX > C.board.width + 0.01) bad += `${C.titles[st - 1]}(右) `;
  }
  check('固定した役職も左右の壁からはみ出さない', bad === '', bad);
}

// ---------------------------------------------------------------- 抽選

console.log('\n[落下オブジェクトの抽選]');
{
  const game = new window.Game();
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const s = game.randomStage();
    counts[s] = (counts[s] || 0) + 1;
  }
  const keys = Object.keys(counts).map(Number).sort();
  check('001〜004 のみが出現する', keys.length === 4 && keys[0] === 1 && keys[3] === 4, `出現: [${keys}]`);
  const ratios = keys.map((k) => `${String(k).padStart(3, '0')}:${(counts[k] / 200).toFixed(1)}%`);
  const expected = C.spawnWeights.map((w) => w / C.spawnWeights.reduce((a, b) => a + b, 0));
  const within = keys.every((k, i) => Math.abs(counts[k] / 20000 - expected[i]) < 0.02);
  check('出現比率が設定どおり', within, ratios.join(' '));
}

console.log(failures === 0 ? '\nすべて成功\n' : `\n${failures} 件失敗\n`);
process.exit(failures === 0 ? 0 : 1);
