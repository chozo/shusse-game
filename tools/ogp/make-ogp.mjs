// SNS共有用の OGP 画像（1200×630）を public/ogp.png に作る。
//   npm run ogp
// 1. ゲームを縦長の画面で開き、時計と乱数を固定して1コマずつ進める。確認用のフック（window.__gameForTest）で
//    ランダムな位置に DROPS 個落とし、そのあと盤面に MIN_PIECES 人以上いる状態で課長以上への出世が起きた直後
//    （「+点」の表示が出ている間）を撮る。
//    時計と乱数を固定しているので毎回同じ盤面になる
// 2. 1200×630 の台紙に、撮った画面・タイトル・出世の順番・遊び方・URL・社長とインターンの絵を並べて撮る
// ファイルはサーバーを立てずに、ブラウザの通信を横取りしてこのフォルダから返す（public/ はルートのパスで返す）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outFile = path.join(root, 'public/ogp.png');
const URL_TEXT = 'game.chozo.net/shusse-game';
const ORIGIN = 'http://shusse-game.local';
const SEED = 20261018;
const DROPS = 40; // 撮る前に落とす個数
const MIN_STAGE = 4; // この役職（4 = 課長）以上への出世が起きたら撮る
const MIN_PIECES = 16; // 盤面にこの人数以上いるときだけ撮る（にぎやかな盤面にする）
const AFTER_MS = 250; // 出世してから撮るまで
const FRAME_MS = 1000 / 60;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.route(`${ORIGIN}/**`, (route) => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname).replace(/\/$/, '/index.html');
  const file = [path.join(root, p), path.join(root, 'public', p)].find((f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile());
  return file ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
});
await page.addInitScript((seed) => {
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { localStorage.clear(); } catch (e) { /* 使えなくても続行 */ }
}, SEED);
await page.clock.install({ time: 0 });
await page.clock.pauseAt(1000); // install だけだと実時間で進むので止める。以後は runFor の分だけ進む
await page.goto(`${ORIGIN}/`);
await page.waitForFunction(() => !document.querySelector('#title').hidden);
await page.click('#start');
await page.evaluate(() => {
  const g = window.__gameForTest;
  window.__evolved = [];
  g.on('evolve', (e) => window.__evolved.push(e.stage));
});

// 落とせるようになるたびに、ランダムな位置へ動かして落とす
const tick = (dropping) =>
  page.evaluate((dropping) => {
    const g = window.__gameForTest;
    let dropped = false;
    if (dropping && g.canDrop()) {
      g.moveTo(40 + Math.random() * (g.width - 80));
      dropped = g.drop();
    }
    return { dropped, state: g.state, pieces: g.pieces().length, evolved: window.__evolved.splice(0) };
  }, dropping);
let dropped = 0;
let caught = 0;
for (let frame = 0; frame < 60 * 120 && !caught; frame++) {
  const st = await tick(dropped < DROPS || frame % 40 === 0);
  if (st.state !== 'playing') throw new Error('撮影前にゲームオーバーになりました');
  if (st.dropped) dropped++;
  if (dropped >= DROPS && st.pieces >= MIN_PIECES) caught = st.evolved.find((s) => s >= MIN_STAGE) || 0;
  await page.clock.runFor(FRAME_MS);
}
if (!caught) throw new Error('出世の場面が見つかりませんでした');
await page.clock.runFor(AFTER_MS);
const info = await page.evaluate(() => ({ score: window.__gameForTest.score, pieces: window.__gameForTest.pieces().length }));
console.log(`撮った場面: ${dropped} 個落とし、${caught} 段目への出世の直後 / スコア ${info.score} / 盤面 ${info.pieces} 個`);
const shot = await page.locator('#app').screenshot({ type: 'png' });

// 2. 台紙に並べて撮る
const titles = ['インターン', '平社員', '係長', '課長', '次長', '部長', '事業部長', '執行役員', '取締役', '副社長', '社長'];
const asData = (f) => `data:image/png;base64,${fs.readFileSync(path.join(root, f)).toString('base64')}`;
const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await card.setContent(`<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; }
  #ogp { position: relative; width: 1200px; height: 630px; overflow: hidden; color: #22303f;
    font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif; font-weight: 800;
    background: radial-gradient(circle at 28% 40%, #fff 0, transparent 55%), linear-gradient(160deg, #dbe7f3, #f4f1e8); }
  .shot { position: absolute; left: 850px; top: 24px; width: 310px; border-radius: 22px;
    transform: rotate(4deg); transform-origin: 50% 0;
    box-shadow: 0 0 0 6px #fff, 0 0 0 10px #2b4a72, 0 22px 44px rgba(34, 48, 63, .35); }
  .text { position: absolute; left: 70px; top: 0; bottom: 0; width: 640px;
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
  .logo { font-size: 128px; font-weight: 900; line-height: 1.05; letter-spacing: .02em; color: #2b4a72;
    text-shadow: 6px 6px 0 #fff, 9px 9px 0 #c9992e; white-space: nowrap; }
  .lead { margin-top: 26px; font-size: 34px; line-height: 1.45; }
  .lead em { font-style: normal; color: #b07d12; }
  .ladder { margin-top: 18px; font-size: 21px; color: #5d6f81; line-height: 1.5; }
  .ladder b { color: #2b4a72; }
  .url { margin-top: 26px; padding: 12px 30px; border-radius: 999px; color: #fff; font-size: 30px;
    background: #2b4a72; box-shadow: 0 6px 0 #1a3150, 0 12px 22px rgba(34, 48, 63, .3); }
  .boss { position: absolute; left: 644px; top: 402px; width: 176px; filter: drop-shadow(0 12px 18px rgba(34, 48, 63, .35)); }
</style>
<div id="ogp">
  <img class="shot" src="data:image/png;base64,${shot.toString('base64')}">
  <img class="boss" src="${asData('img/optimized/011.png')}">
  <div class="text">
    <div class="logo">出世ゲーム</div>
    <div class="lead">同じ役職どうしをぶつけて、<br><em>インターンを社長まで</em>出世させよう！</div>
    <div class="ladder">${titles.slice(0, 6).map((t, i) => (i === 0 ? `<b>${t}</b>` : t)).join(' → ')} →<br>${titles.slice(6).map((t, i) => (i === 4 ? `<b>${t}</b>` : t)).join(' → ')}</div>
    <div class="url">${URL_TEXT}</div>
  </div>
</div>`);
await card.waitForFunction(() => [...document.images].every((i) => i.complete));
await card.evaluate(() => document.fonts.ready);
await card.screenshot({ path: outFile, clip: { x: 0, y: 0, width: 1200, height: 630 } });

await browser.close();
console.log('OGP画像:', outFile);
