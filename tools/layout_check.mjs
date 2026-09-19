// css/style.css の縦方向のレイアウトを再現して、端末ごとに
// 盤面がどれだけ確保できるか・はみ出さないかを確認する。
//   node tools/layout_check.mjs
//
// 実機で目視できない代わりの検算なので、CSS を変えたら想定値も合わせること。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(ROOT, "css/style.css"), "utf8");

const BOARD_RATIO = 400 / 720;   // js/config.js の board と一致

// 端末: [名前, 幅, 表示高（アドレスバー等を除いた実効値）, 下部セーフエリア, タッチ端末か]
const DEVICES = [
  ["iPhone SE",        375, 553,  0, true],
  ["iPhone 13 mini",   375, 629, 34, true],
  ["iPhone 14",        390, 664, 34, true],
  ["iPhone 14 Pro Max",430, 745, 34, true],
  ["Pixel 7",          412, 733, 24, true],
  ["iPad mini 縦",     744, 954, 20, true],
  ["iPhone 14 横",     844, 320, 21, true],
  ["ノートPC",        1280, 700,  0, false],
  ["デスクトップ",     1920, 980,  0, false],
];

function layout(w, h, safeBottom, touch) {
  const narrow = w <= 700 || h <= 760;      // ミニ進化表を隠す条件
  const gap = narrow ? 6 : 8;
  const padTop = Math.max(8, 0);
  const padBottom = Math.max(10, safeBottom);
  const padX = 12;

  // 狭い画面では HUD を詰めている（.hud-value 20px / NEXT 32px など）
  const header = narrow ? 44 : 46;           // SCORE/タイトル/NEXT
  const footer = narrow ? (touch ? 34 : 38) : 46;
  const chart = narrow ? 0 : 66;             // 画面下のミニ進化表

  const children = 2 + (chart ? 2 : 1);      // header, stage-wrap, footer(, chart)
  const gaps = gap * (children - 1);

  const appW = Math.min(w, 460) - padX * 2;
  const stageH = h - padTop - padBottom - gaps - header - footer - chart;

  // 盤面は高さ基準。幅が足りなければ幅に合わせる
  let boardH = stageH;
  let boardW = boardH * BOARD_RATIO;
  if (boardW > appW) { boardW = appW; boardH = boardW / BOARD_RATIO; }

  // トップ画面のカードの高さ（css/style.css の .title-* に対応）
  const short = h <= 760;
  const veryShort = h <= 640;
  const chartImg = Math.min(84, Math.max(46, Math.min(w * 0.175, h * 0.09)));
  const chartGap = Math.min(38, Math.max(14, Math.min(w * 0.08, h * 0.042)));
  const capFont = Math.min(11, Math.max(9, w * 0.025));
  const cardPad = short ? 24 : 40;
  const cardH =
    (veryShort ? 34 : short ? 40 : 46) +              // ロゴ
    (veryShort ? 0 : 30) +                            // リード文
    3 * (chartImg + capFont * 1.3) + 2 * (short ? 8 : 12) + (short ? 14 : 18) +   // 進化図
    (veryShort ? 50 : short ? 58 : 66) +              // ルール3行
    (short ? 42 : 48) +                               // 開始ボタン
    (veryShort ? 24 : 28) +                           // ベスト
    cardPad;

  return { stageH, boardW, boardH, appW, cardH, chartImg, chartGap, overflow: stageH < 0 };
}

console.log("端末                 画面        盤面          画面占有   トップ画面      判定");
let bad = 0;
for (const [name, w, h, safe, touch] of DEVICES) {
  const r = layout(w, h, safe, touch);
  const fill = (100 * (r.boardW * r.boardH) / (w * h)).toFixed(0);
  // 横向きスマホは案内を出すので判定から外す
  const landscapePhone = touch && w > h && h <= 500;
  const cardFits = r.cardH <= r.stageH;
  const ok = landscapePhone || (!r.overflow && r.boardH > 180 && cardFits);
  if (!ok) bad++;
  console.log(
    name.padEnd(20),
    `${w}x${h}`.padEnd(11),
    `${r.boardW.toFixed(0)}x${r.boardH.toFixed(0)}`.padEnd(13),
    (fill + "%").padStart(5),
    `   ${r.cardH.toFixed(0)}/${r.stageH.toFixed(0)}`.padEnd(15),
    landscapePhone ? "縦向き案内" : ok ? "OK" : (cardFits ? "★収まらない" : "★トップ画面が溢れる")
  );
}

console.log("");
const checks = [
  ["body の高さが動的ビューポート", /body\s*\{[^}]*height:\s*100dvh/s.test(css)],
  ["body でページのスクロールを止める", /body\s*\{[^}]*overflow:\s*hidden/s.test(css)],
  ["app の高さをビューポートに固定", /\.app\s*\{[^}]*height:\s*100%/s.test(css) && !/\.app\s*\{[^}]*min-height:\s*100%/s.test(css)],
  ["セーフエリアを避ける", /env\(safe-area-inset-bottom/.test(css)],
  ["狭い画面でミニ進化表を隠す", /\(max-width:\s*700px\)[^{]*\{\s*\.chart-wrap\s*\{\s*display:\s*none/s.test(css) || /max-height:\s*760px\),\s*\(max-width:\s*700px\)/.test(css)],
  ["タッチ端末で操作説明を1行にする", /@media\s*\(pointer:\s*coarse\)/.test(css)],
  ["進化図の高さも動的ビューポート基準", /dvh\)/.test(css)],
  ["横向きのスマホに縦向きの案内を出す", /@media \(orientation: landscape\)[^{]*\(pointer: coarse\)/.test(css)],
];

// ファビコンはサブパス配信なので相対パスで明示する必要がある
const html = readFileSync(join(ROOT, "index.html"), "utf8");
checks.push(
  ['ファビコンを相対パスで明示', /<link rel="icon"[^>]*href="favicon\.png"/.test(html)],
  ['iOS のホーム画面アイコンを指定', /<link rel="apple-touch-icon"[^>]*href="apple-touch-icon\.png"/.test(html)],
  ['ファビコンを配信対象に含める',
    /"favicon\.png"/.test(readFileSync(join(ROOT, "tools/build_dist.mjs"), "utf8")) &&
    /"apple-touch-icon\.png"/.test(readFileSync(join(ROOT, "tools/build_dist.mjs"), "utf8"))],
);
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? "OK  " : "NG  "}${name}`);
}

console.log(bad === 0 ? "\nすべて成功\n" : `\n${bad} 件失敗\n`);
process.exit(bad === 0 ? 0 : 1);
