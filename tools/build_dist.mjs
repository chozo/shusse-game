// 配信用の dist/shusse-game/ を組み立てる。
// 原本画像（img/*.png）と tools/ は配信しない。
//   node tools/build_dist.mjs
import { cp, mkdir, rm, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "dist", "shusse-game");

// 配信するファイル・ディレクトリ
const INCLUDE = [
  "index.html",
  "css",
  "js",
  "vendor",
  "img/optimized",
];

async function totalSize(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    bytes += entry.isDirectory() ? await totalSize(p) : (await stat(p)).size;
  }
  return bytes;
}

await rm(join(ROOT, "dist"), { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const rel of INCLUDE) {
  const src = join(ROOT, rel);
  const dst = join(OUT, rel);
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });
  console.log("  " + rel);
}

const bytes = await totalSize(OUT);
console.log(`\n=> dist/shusse-game/  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
