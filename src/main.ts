import "./style.css";
import { startGame } from "./game.ts";

startGame().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : "未知问题";
  document.body.innerHTML = `<main style="font-family:sans-serif;padding:24px;color:#241c18">游戏没有打开：${msg}</main>`;
});
