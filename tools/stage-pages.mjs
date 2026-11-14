import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const built = existsSync("dist/index.html") ? "dist/index.html" : "dist/index.source.html";
if (!existsSync(built)) {
  console.error("缺少构建出的 HTML。先完成 vite build。");
  process.exit(1);
}
if (built !== "dist/index.html") await copyFile(built, "dist/index.html");
await copyFile("dist/index.html", "index.html");
if (existsSync("dist/favicon.svg")) await copyFile("dist/favicon.svg", "favicon.svg");
console.log("GitHub Pages 入口已写成 index.html（单文件，base ./ ，缓存 ?v=4）");
