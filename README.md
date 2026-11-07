# 星匠 Orbitwright

HTML5 Canvas 2D 原型：在组装舱拼火箭，从地球发射，入轨，再奔月软着陆。通关后解锁同一套物理的沙盒。

没有构建步骤。静态文件可以直接打开。

## 本地打开

双击 `index.html`，或在仓库根目录起一个静态服务器：

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080/`。

触控和键盘都能飞：

- 油门：右侧滑条，或 `W` / `S`（`Shift` / `Ctrl` 同样）
- 倾转：左侧摇杆，或 `A` / `D`（方向键同样）
- 分级：大按钮或空格
- 点火：按钮或回车
- 轨道图：按钮或 `C`
- 时间加速：按钮或 `Tab`（1× / 5× / 25× / 深空巡航）
- 暂停：按钮或 `P` / `Esc`

## GitHub Pages

仓库根目录就是站点。打开 Pages 时选主分支、`/` 根目录即可。已放空的 `.nojekyll`，避免 Pages 把下划线开头的文件吃掉。脚本和样式链接带 `?v=3`，方便换版本时刷新缓存。零件图在 `assets/parts/`，加载失败时仍用色块。

这一步留给协调人，本仓库不会自己打开 Pages。

## 存档

- `localStorage` 键 `orbitwright-v1`：是否登月、是否入轨、最佳船、静音
- `localStorage` 键 `orbitwright-hangar-draft`：组装舱草稿

## 可调数值

写在 `js/tune.js` 和 `js/parts.js` 里，注释标了 TUNABLE：

- 地月距离 `EARTH_MOON_DIST`（v1 压缩为 280000 km）
- 动压解体 `QMAX`、软着陆 `VSAFE`
- 零件推力 / `Isp_g`（草案表的 Isp 推不起这套质量，已按可飞调整并保留草案数字）

`node tools/flightcheck.mjs` 会做一次无界面飞行检查：新手船入轨、奔月船抵达月面、脚本化软着陆。
