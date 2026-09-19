// README.md の記載が実装と食い違っていないか検証する。
//   node tools/readme_check.mjs
//
// README は次に触るときの唯一の入口になるので、数値や手順が古いまま残ると
// そのまま誤解につながる。設定値を変えたらここも通らなくなるようにしてある。
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const md = readFileSync(join(ROOT, "README.md"), "utf8");
const pkg = JSON.parse(read("package.json"));
const py = read("tools/build_assets.py");
const main = read("js/main.js");
const wrangler = read("wrangler.jsonc");

globalThis.window = globalThis;
eval(read("js/config.js"));
eval(read("js/stages.js"));
const C = globalThis.CONFIG;

let ng = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  OK  ${name}`);
  else { ng++; console.log(`  NG  ${name}${detail ? "  → " + detail : ""}`); }
};

// ---------------------------------------------------------------- 設定値

console.log("\n[ゲームの数値]");
check("出現比率", C.spawnWeights.join(" / ") === "40 / 30 / 20 / 10" && md.includes("40 / 30 / 20 / 10"));
check("社長どうしのボーナス", C.topMergeBonus === 100 && md.includes("+100 点"));
check("連鎖の条件", C.chain.windowMs === 900 && C.chain.max === 3 && md.includes("0.9 秒") && md.includes("3.0 倍"));
check("ゲームオーバー判定", C.gameOver.overMs === 1000 && md.includes("1 秒間"));
check("判定の猶予", C.gameOver.graceMs === 1200 && C.mergeGraceMs === 400 && md.includes("1.2 秒") && md.includes("0.4 秒"));
check("盤面サイズ", C.board.width === 400 && C.board.height === 720 && md.includes("400 × 720") && md.includes("400:720"));
check("地面の高さ", C.floorHeight === 10 && md.includes("`floorHeight` = 10px"));
check("役職名11件", C.titles.length === 11 && C.titles.every((t) => md.includes(t)));
check("進化図の段組み", /ROW_SIZES = \[4, 4, 3\]/.test(main) && md.includes("4 + 4 + 3"));

console.log("\n[当たり判定の生成]");
check("アルファしきい値", /ALPHA_THRESHOLD = 128/.test(py) && md.includes("α ≧ 128"));
check("頂点数の上限", /MAX_VERTS = 20/.test(py) && md.includes("20 個"));
check("半径の式", /BASE_RADIUS = 26\.0/.test(py) && /GROWTH = 1\.16/.test(py) && md.includes("26 × 1.16^(n-1)"));
check("最大半径", Math.round(globalThis.STAGES_DATA.stages[10].radius) === 115 && md.includes("26 → 115 px"));

console.log("\n[サウンド]");
check("BGM のテンポ", /60 \/ 104 \/ 2/.test(read("js/sound.js")) && md.includes("104 BPM"));
check("iOS の音声セッション", /audioSession/.test(read("js/sound.js")) && md.includes("audioSession.type = 'playback'"));

console.log("\n[配信]");
const distDir = join(ROOT, "dist", "shusse-game");
if (existsSync(distDir)) {
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = walk(distDir);
  const mb = files.reduce((a, f) => a + statSync(f).size, 0) / 1024 / 1024;
  check("配信ファイル数", md.includes(`${files.length}ファイル`), `実際 ${files.length} ファイル`);
  check("配信サイズ", md.includes(`${mb.toFixed(2)}MB`), `実際 ${mb.toFixed(2)}MB`);
} else {
  console.log("  --  dist が無いので配信サイズは未検証（npm run build 後に再実行）");
}
check("Worker 名", /"name":\s*"shusse-game"/.test(wrangler) && md.includes("Worker 名は `shusse-game`"));
check("ルート設定", (wrangler.match(/pattern/g) || []).length === 2 && md.includes("game.chozo.net/shusse-game/*"));
check("公開URL", md.includes("https://game.chozo.net/shusse-game/"));
check("GitHub", md.includes("https://github.com/chozo/shusse-game"));

// ---------------------------------------------------------------- 網羅性

console.log("\n[記載漏れ]");
const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
const ignorable = /^(img\/(optimized\/)?\d{3}\.png|package-lock\.json|\.gitignore|README\.md)$/;
const undocumented = tracked.filter((f) => !ignorable.test(f) && !md.includes(f) && !md.includes(f.split("/").pop()));
check("全ファイルが README に登場する", undocumented.length === 0, undocumented.join(" "));

const scripts = Object.keys(pkg.scripts).filter((k) => !md.includes(`npm run ${k}`) && !md.includes(`npm ${k}`));
check("npm スクリプトが README に登場する", scripts.length === 0, scripts.join(" "));

const tools = readdirSync(join(ROOT, "tools")).filter((f) => /\.(js|mjs|py)$/.test(f) && !md.includes(f));
check("tools の全スクリプトが README に登場する", tools.length === 0, tools.join(" "));

console.log(ng === 0 ? "\nREADME は実装と一致\n" : `\n${ng} 件の食い違い\n`);
process.exit(ng === 0 ? 0 : 1);
