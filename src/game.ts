import { AudioBus } from "./audio.ts";
import { loadArt } from "./render/art.ts";
import {
  cellFromPoint,
  drawGrid,
  drawOrbit,
  drawParticles,
  drawPlanet,
  drawPrediction,
  drawMoon,
  drawDirectionMark,
  drawMapSky,
  drawProgradeMark,
  drawVelocityArrows,
  drawSky,
  drawStars,
  drawVessel,
  drawWorkshop,
  gridGeom,
  mapCamera,
  worldToScreen,
  type Camera,
  type Particle,
} from "./render/draw.ts";
import { analyze, mirrorX, partAt, placementIssue } from "./sim/assembly.ts";
import {
  createFlight,
  flightHint,
  partWorld,
  retryFlight,
  stepFlight,
  warpAllowed,
  type FlightState,
} from "./sim/flight.ts";
import { clamp, PLANET } from "./sim/math.ts";
import { isEncounter, moonAt, MOON, PREDICT_DT, predictApproach, type Approach } from "./sim/world.ts";
import { consumeWake } from "./sim/clock.ts";
import { navAimAngle, navCue, turnCapFor } from "./sim/nav.ts";
import { PART_ORDER, PARTS, PRESETS, type PartKind, type Placed } from "./sim/parts.ts";
import { clearSave, exportDesigns, findDesign, forgetDesign, importDesigns, loadSave, rememberDesign, renameDesign, writeSave, LOAD_MENU_BUTTON_H, LOAD_MENU_BUTTONS, type NamedDesign, type Progress, type SaveData } from "./save.ts";
import { FlightHistory } from "./sim/history.ts";
import { FAILURE_MENU, PART_MENU, SELECT_ROWS, TIMEWARP_TO, nextTarget, partMenuCard, targetTitle, type SelectTarget } from "./ui/select-menu.ts";
import { temperatureMarkup } from "./sim/heat.ts";
import { appliedWarp, stepWarp, warpBlock, warpCenterText, warpRefuseText, warpStepBudget } from "./sim/warp.ts";
import { BlueprintLog, flipParts } from "./sim/edits.ts";
import { formatHudAlt, formatHudSpeed, formatNum } from "./ui/format.ts";
import { CHROME, LEFT_TEXT, STAGE_ZONE_W, heightReadings, openingMenuPauses, stageListMarkup } from "./ui/p1.ts";
import {
  HOME_BLOCKS,
  RECOVER_BUTTON,
  RIGHT_TEXT,
  SETTINGS_ITEMS,
  attitudeText,
  missionMarks,
  overPartsRail,
  recoverVisible,
} from "./ui/p2.ts";
import { END_MISSION_BUTTON_H, END_MISSION_ROW, PARTS_BAR, THROTTLE_BAR, THROTTLE_HOLDER, THROTTLE_PERCENT, THROTTLE_SLIDER, THROTTLE_TOGGLE_H } from "./ui/measured.ts";

/** Unity CanvasScaler log-lerp, reference 800×1400, matchWidthOrHeight 0.5. Measured from World_Mobile. */
export function flightUiScale(width: number, height: number): number {
  const lw = Math.log(Math.max(1, width) / 800);
  const lh = Math.log(Math.max(1, height) / 1400);
  return Math.exp(lw + (lh - lw) * 0.5);
}

/** The global engine switch forces the command to zero. The pad position is left alone. */
export function commandThrottle(raw: number, engineOn: boolean): number {
  return engineOn ? raw : 0;
}

export const RESET_CONFIRM_TITLE = "确定清除全部图纸和进度？";

/** Descent chute button. Part-menu chute is the original method and is not this button. */
export function descentChuteVisible(flight: {
  phase: string;
  body: string;
  altitude: number;
  verticalSpeed: number;
  chuteStage: number;
}): boolean {
  return flight.phase === "flight" && flight.body !== "moon" && flight.altitude <= 4_000 && flight.verticalSpeed < 0 && flight.chuteStage < 2;
}

export function menuGroups(screen: "home" | "build" | "flight"): { label: string; items: string[] }[] {
  const flightItems = screen === "flight" ? ["暂停", "重试", "返回组装", "首页", "图纸", "取消"] : ["首页", "图纸", "取消"];
  return [
    { label: "飞行", items: flightItems },
    { label: "设置", items: ["设置"] },
    { label: "危险", items: ["清除存档"] },
  ];
}

interface Drag {
  id: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  moved: boolean;
}

function iconSvg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${body}</svg>`;
}
function iconClear(): string { return iconSvg(`<path d="M5 8h14M9 8V6h6v2M7 8l1 12h8l1-12" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconRemove(): string { return iconSvg(`<rect x="7" y="4" width="10" height="16" rx="1" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M5 12h14" stroke="#fff" stroke-width="1.8"/>`); }
function iconUndo(): string { return iconSvg(`<path d="M8 8H5v3M5.5 10a7 7 0 1 1-1 4" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconRedo(): string { return iconSvg(`<path d="M16 8h3v3M18.5 10a7 7 0 1 0 1 4" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconFlip(): string { return iconSvg(`<path d="M12 4v16M8 7l-4 5 4 5M16 7l4 5-4 5" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconUp(): string { return iconSvg(`<path d="M6 14l6-6 6 6" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconDown(): string { return iconSvg(`<path d="M6 10l6 6 6-6" fill="none" stroke="#fff" stroke-width="1.8"/>`); }
function iconMirror(): string { return iconSvg(`<path d="M12 4v16M7 8l-3 4 3 4M17 8l3 4-3 4" fill="none" stroke="#fff" stroke-width="1.8"/>`); }

function partGlyph(kind: PartKind): string {
  const svg = (body: string) =>
    `<svg viewBox="0 0 24 32" width="36" height="34" aria-hidden="true">${body}</svg>`;
  const stroke = `fill="none" stroke="#5c6570" stroke-width="1.2"`;
  if (kind === "pod") {
    return svg(`<path d="M12 2 L17 28 H7 Z" fill="#eef1f4" stroke="#5c6570" stroke-width="1.2"/><rect x="9.5" y="14" width="5" height="4" fill="#2a3140"/>`);
  }
  if (kind === "chute") {
    return svg(`<rect x="6" y="10" width="12" height="12" rx="1" fill="#e07a3d" stroke="#8a4a28" stroke-width="1"/>`);
  }
  if (kind === "tank_s" || kind === "tank_m" || kind === "tank_l") {
    return svg(`<rect x="7" y="3" width="10" height="26" fill="#eef1f4" stroke="#5c6570" stroke-width="1.2"/><path d="M7 12 H17 M7 20 H17" ${stroke}/>`);
  }
  if (kind === "engine_s" || kind === "engine_l") {
    return svg(`<rect x="7" y="1" width="10" height="14" fill="#e7ebf0" stroke="#5c6570" stroke-width="1.1"/><path d="M7 14 L5 29 H19 L17 14 Z" fill="#2a3138" stroke="#14181c" stroke-width="1"/><path d="M6 19 H18 M6 23 H18" stroke="#b7bcc2" stroke-width="0.8"/>`);
  }
  if (kind === "separator") {
    return svg(`<rect x="6" y="13" width="12" height="6" fill="#d7a441" stroke="#8a6a22" stroke-width="1"/><circle cx="9" cy="16" r="1" fill="#3a3324"/><circle cx="15" cy="16" r="1" fill="#3a3324"/>`);
  }
  if (kind === "shield") {
    return svg(`<path d="M4 10 Q12 26 20 10" fill="#c4552a" stroke="#f2c14e" stroke-width="1.4"/>`);
  }
  if (kind === "legs") {
    return svg(`<path d="M8 6 L4 28 M16 6 L20 28 M8 6 H16" ${stroke} stroke-width="1.4"/>`);
  }
  return svg(`<path d="M12 1 L15 6 H9 Z" fill="#eef1f4" stroke="#5c6570"/><rect x="9" y="6" width="6" height="18" fill="#eef1f4" stroke="#5c6570"/><path d="M9 24 L7 31 H17 L15 24 Z" fill="#2a3138"/><rect x="15" y="14" width="5" height="2" fill="#8d949c"/>`);
}

export async function startGame(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  const ui = document.querySelector<HTMLElement>("#ui");
  const live = document.querySelector<HTMLElement>("#live");
  if (!canvas || !ui || !live) throw new Error("页面缺少画布");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布打不开");

  const art = await loadArt();
  const audio = new AudioBus();
  const save0 = loadSave();
  let screen: "home" | "build" | "flight" = "home";
  let easy = save0.easy;
  let sound = save0.sound;
  let sas = save0.sas;
  let tutorial = save0.tutorial;
  let missions: Progress = { ...save0.missions };
  let parts: Placed[] = save0.parts.map((p) => ({ ...p }));
  let designs: NamedDesign[] = (save0.designs ?? []).map((d) => ({ ...d, parts: d.parts.map((p) => ({ ...p })) }));
  let pickedDesign: string | null = null;
  let renameDraft = "";
  const log = new BlueprintLog();
  let selectedKind: PartKind | null = null;
  let selectedId: string | null = null;
  let buildMsg = parts.length ? "" : "点零件，再点格子。或者直接装示例火箭。";
  let flight: FlightState | null = null;
  let paused = false;
  let mapMode = false;
  let mapFollow = true;
  let mapCenter = { x: 0, y: 0 };
  let mapDrag: { id: number; x: number; y: number; moved: boolean } | null = null;
  let navMoon = false;
  let approach: Approach | null = null;
  let approachAt = 0;
  let warpWant = 1;
  let burnAcc = 0;
  let throttle = 0;
  let engineOn = true;
  let symmetry = false;
  let buildView = 1;
  let menuOpen = false;
  let steerHold = 0;
  let steerPulse = 0;
  let steerPulseUntil = 0;
  let padDrag = false;
  let queueStage = false;
  let queueChute = false;
  let modal: "pause" | "help" | "reset" | "load" | "fail" | "settings" | "missions" | null = tutorial ? null : "help";
  let history = new FlightHistory();
  let warpUntil: number | null = null;
  let selectOpen = false;
  let selectTarget: SelectTarget = "moon";
  let partMenuId: string | null = null;
  let endDismissed = false;
  const aliases: Partial<Record<SelectTarget, string>> = {};
  let toast = "";
  let toastUntil = 0;
  let orbitFx = false;
  let seq = 1;
  for (const p of parts) {
    const n = Number(p.id.replace(/\D/g, ""));
    if (n >= seq) seq = n + 1;
  }
  let drag: Drag | null = null;
  let dragAt: { x: number; y: number } | null = null;
  let ghost: { kind: PartKind; x: number; y: number; ok: boolean } | null = null;
  const particles: Particle[] = [];
  const keys = new Set<string>();
  let cam: Camera = { x: 0, y: PLANET.radius + 20, zoom: 12 };
  let zoom = 12;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  audio.setEnabled(sound);

  const persist = (): void => {
    const data: SaveData = { v: 1, easy, sound, sas, tutorial, missions, parts, designs };
    writeSave(data);
  };

  const say = (text: string): void => {
    toast = text;
    toastUntil = performance.now() + 2600;
    live.textContent = text;
  };

  const burst = (x: number, y: number, kind: "stage" | "orbit" | "retry" | "land"): void => {
    const count = reduce ? 6 : kind === "orbit" ? 18 : 12;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 8 + (i % 4) * 6;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.8,
        max: 0.8,
        size: kind === "orbit" ? 72 : 48,
        sprite: kind === "orbit" ? 3 : i % 3,
        additive: kind !== "land",
      });
    }
  };

  const note = (): void => {
    log.note(parts);
  };

  const render = (): void => {
    ui.dataset.screen = screen;
    if (screen === "home") ui.innerHTML = homeHtml();
    else if (screen === "build") ui.innerHTML = buildHtml();
    else ui.innerHTML = flightHtml();
    const th = document.querySelector<HTMLInputElement>("#th-range");
    if (th) th.value = String(Math.round(throttle * 100));
  };

  const homeHtml = (): string => {
    const blocks = HOME_BLOCKS.map((block) => {
      const act = block.id === "continue" ? "continue" : block.id === "build" ? "build" : block.id === "missions" ? "missions" : "help";
      return `<button data-act="${act}" data-home="${block.id}">${block.label}</button>`;
    }).join("");
    const marks = missionMarks(missions).map((item) => `<span class="${item.on ? "on" : ""}">${item.label}</span>`).join("");
    return `<div class="home"><div class="card">
      <h1>太空工坊</h1>
      <p class="eyebrow">Orbitwright</p>
      <p>先组装，再点右上角「发射」。零件在左边。</p>
      <div class="home-blocks">${blocks}</div>
      <div class="missions" id="home-missions">${marks}</div>
      <div class="row">
        <button data-act="preset" data-id="starter">示例箭</button>
        <button data-act="preset" data-id="hopper">回家小箭</button>
        <button data-act="preset" data-id="orbiter">绕圈火箭</button>
        <button data-act="preset" data-id="cluster">三芯箭</button>
      </div>
    </div></div>${modalHtml()}`;
  };

  const buildHtml = (): string => {
    const report = analyze(parts, easy);
    const status = report.ok ? "" : (report.errors[0] ?? "还不能发射");
    return `<div class="sfs-topright">
      <button class="sfs-menu" data-act="menu" aria-label="菜单">☰</button>
      <button class="sfs-launch" data-act="launch" ${report.ok ? "" : "disabled"}>发射</button>
    </div>
    <div class="sfs-rail sfs-left" style="left:calc(${PARTS_BAR.left}px * var(--sfs, 1));top:calc(${Math.abs(PARTS_BAR.anchoredY)}px * var(--sfs, 1));width:calc(${PARTS_BAR.width}px * var(--sfs, 1));height:calc(100% + ${PARTS_BAR.sizeDeltaY}px * var(--sfs, 1))">
      <div class="sfs-parts">${PART_ORDER.map((k) => {
        return `<button class="part" data-act="kind" data-kind="${k}" aria-pressed="${selectedKind === k}" aria-label="${PARTS[k].name}">${partGlyph(k)}</button>`;
      }).join("")}</div>
      <div class="sfs-lefttools">
        <button data-act="symmetry" aria-label="${symmetry ? "对称已开" : "对称"}" aria-pressed="${symmetry}">${iconMirror()}<em>${symmetry ? "开" : "对称"}</em></button>
        <button data-act="zoom-in" aria-label="放大视图">＋<em>放大</em></button>
        <button data-act="zoom-out" aria-label="缩小视图">－<em>缩小</em></button>
      </div>
    </div>
    <div class="sfs-rail sfs-right">
      <button data-act="clear" aria-label="清空" title="清空"><span class="ico">${iconClear()}</span><em>清空</em></button>
      <button data-act="delete" aria-label="拆下" title="拆下" ${selectedId ? "" : "disabled"}><span class="ico">${iconRemove()}</span><em>拆下</em></button>
      <button data-act="undo" aria-label="撤销" title="撤销" ${log.canUndo ? "" : "disabled"}><span class="ico">${iconUndo()}</span><em>撤销</em></button>
      <button data-act="redo" aria-label="重做" title="重做" ${log.canRedo ? "" : "disabled"}><span class="ico">${iconRedo()}</span><em>重做</em></button>
      <button data-act="flip" aria-label="翻转" title="翻转"><span class="ico">${iconFlip()}</span><em>翻转</em></button>
      <button data-act="nudge-up" aria-label="上移" title="上移"><span class="ico">${iconUp()}</span><em>上移</em></button>
      <button data-act="nudge-down" aria-label="下移" title="下移"><span class="ico">${iconDown()}</span><em>下移</em></button>
    </div>
    <div class="sfs-readout">
      <div>质量: ${(report.mass / 1000).toFixed(2)}t</div>
      <div>推力: ${Math.round(report.thrust / 1000)}kN</div>
      <div>推重比: ${formatNum(report.twr, 2)}</div>
      ${buildMsg ? `<div class="note">${buildMsg}</div>` : ""}
      ${report.ok ? "" : `<div class="bad">${status}</div>`}
    </div>
    ${menuHtml()}
    ${modalHtml()}`;
  };

  const flightHtml = (): string => {
    if (partMenuId && flight && !flight.vessel.parts.some((p) => p.id === partMenuId)) partMenuId = null;
    return `<button class="sfs-menu sfs-flight" data-act="menu" aria-label="菜单">☰</button>
    <button class="sfs-map" data-act="map" aria-pressed="${mapMode}">地图</button>
    ${mapMode ? `<button class="sfs-follow" data-act="follow" aria-pressed="${mapFollow}">${mapFollow ? "跟随中" : "跟随"}</button>` : ""}
    ${mapMode ? `<button class="sfs-nav" data-act="nav" aria-pressed="${navMoon}">${navMoon ? "导航中" : "飞向月芽"}</button>` : ""}
    ${mapMode ? `<div class="sfs-pick">
      <button data-act="pick" data-target="moon">月芽</button>
      <button data-act="pick" data-target="planet">青芽星</button>
      <button data-act="pick" data-target="ship">火箭</button>
    </div>` : ""}
    ${mapMode && selectOpen ? selectHtml() : ""}
    <div class="sfs-warp">
      <button data-act="warp-down" aria-label="减慢">◀◀</button>
      <strong id="t-warp">1×</strong>
      <button data-act="warp-up" aria-label="加快">▶▶</button>
    </div>
    <div class="sfs-warp-center" id="warp-center" hidden></div>
    <div class="sfs-heights" id="heights" style="left:calc(${LEFT_TEXT.left}px * var(--sfs, 1));top:calc(${LEFT_TEXT.top}px * var(--sfs, 1));height:calc(${LEFT_TEXT.height}px * var(--sfs, 1));width:calc(50% - ${LEFT_TEXT.widthTrim}px * var(--sfs, 1))">
      <div>离地</div><strong id="t-agl">0m</strong>
      <div>海拔</div><strong id="t-asl">0m</strong>
    </div>
    <div class="sfs-telem" style="top:calc(${RIGHT_TEXT.top}px * var(--sfs, 1));right:calc(${RIGHT_TEXT.right}px * var(--sfs, 1))">
      <div>时间:</div><strong id="t-clock">0:00</strong>
      <div>速度:</div><strong id="t-vs">0m/s</strong>
      <div>姿态:</div><strong id="t-att">0°</strong>
      <div>距月芽:</div><strong id="t-moon">—</strong>
      <div>相对:</div><strong id="t-rel">—</strong>
      <div>预计:</div><strong id="t-pass">—</strong>
      <div class="sfs-missions" id="t-missions"></div>
    </div>
    <div class="sfs-throttle" style="width:calc(${THROTTLE_HOLDER.w}px * var(--sfs, 1));height:calc(${THROTTLE_HOLDER.h}px * var(--sfs, 1))">
      <button data-act="engine-toggle" class="sfs-throttle-toggle" aria-pressed="${engineOn}" style="height:calc(${THROTTLE_TOGGLE_H}px * var(--sfs, 1))">${engineOn ? "开" : "关"}</button>
      <div id="t-fuel" class="sfs-throttle-pct" style="width:calc(${THROTTLE_PERCENT.w}px * var(--sfs, 1));height:calc(${THROTTLE_PERCENT.h}px * var(--sfs, 1));bottom:calc(${THROTTLE_PERCENT.y}px * var(--sfs, 1))">100%</div>
      <div class="sfs-throttle-bar" style="width:calc(${THROTTLE_BAR.w}px * var(--sfs, 1));height:calc(${THROTTLE_BAR.h}px * var(--sfs, 1));bottom:calc(${THROTTLE_BAR.y}px * var(--sfs, 1))">
        <div class="vpad" id="vpad" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="油门" tabindex="0" style="width:calc(${THROTTLE_SLIDER.w}px * var(--sfs, 1));height:calc(${THROTTLE_SLIDER.h}px * var(--sfs, 1));bottom:calc(${THROTTLE_SLIDER.y}px * var(--sfs, 1))"><i id="vpad-fill"></i><em id="vpad-mark" hidden></em></div>
      </div>
      <button data-act="th-up" class="sfs-step" aria-label="加油"></button>
      <button data-act="th-down" class="sfs-step" aria-label="收油"></button>
    </div>
    <div class="sfs-temp" id="temps"></div>
    <div class="sfs-fuel"><div>液体燃料</div><div id="caps"></div></div>
    <div class="sfs-rotate">
      <button data-hold="left" aria-label="左转">◀</button>
      <button data-hold="right" aria-label="右转">▶</button>
    </div>
    <div class="sfs-stages" id="stage-list" style="width:calc(${STAGE_ZONE_W}px * var(--sfs, 1))"></div>
    ${flight && recoverVisible(flight.phase) ? `<button class="sfs-recover" data-act="recover" style="width:calc(${RECOVER_BUTTON.w}px * var(--sfs, 1));height:calc(${RECOVER_BUTTON.h}px * var(--sfs, 1));top:calc(${RECOVER_BUTTON.top}px * var(--sfs, 1))">回收</button>` : ""}
    ${flight && flight.phase === "landed" && !endDismissed ? `<div class="sfs-endbar" style="height:calc(${END_MISSION_ROW.h}px * var(--sfs, 1));bottom:calc(${END_MISSION_ROW.bottom}px * var(--sfs, 1));left:calc(${END_MISSION_ROW.insetX}px * var(--sfs, 1));right:calc(${END_MISSION_ROW.insetX}px * var(--sfs, 1));gap:calc(${END_MISSION_ROW.spacing}px * var(--sfs, 1))"><button data-act="to-build" style="height:calc(${END_MISSION_BUTTON_H}px * var(--sfs, 1))">返回</button><button data-act="end-next" style="height:calc(${END_MISSION_BUTTON_H}px * var(--sfs, 1))">继续</button></div>` : ""}
    ${flight && descentChuteVisible(flight) ? `<button class="sfs-chute" data-act="chute">开伞</button>` : ""}
    ${flight && partMenuId ? partMenuHtml(flight, partMenuId) : ""}
    <div class="hint" id="hint" data-anchor="${CHROME.hint}"></div>
    <div class="burnmeter" id="burnmeter" hidden><span id="burnlabel">点火</span><b><i id="burnfill"></i></b></div>
    <div class="toast sfs-event" id="toast" data-anchor="${CHROME.event}"></div>
    ${menuHtml()}
    ${modal === "pause" ? pauseHtml() : ""}
    ${modal === "fail" && flight ? failHtml(flight) : ""}`;
  };

  const currentSave = (): SaveData => ({ v: 1, easy, sound, sas, tutorial, missions, parts, designs });

  const loadHtml = (): string => {
    const rows = designs
      .map((d) => `<button class="sfs-load-row" data-act="pick-design" data-id="${d.id}" aria-pressed="${pickedDesign === d.id}">${escapeText(d.name)}</button>`)
      .join("");
    const actions = LOAD_MENU_BUTTONS.map((label) => {
      const act = label === "返回" ? "load-close"
        : label === "删除" ? "design-delete"
        : label === "改名" ? "design-rename"
        : label === "导入" ? "design-import"
        : label === "打开" ? "design-open"
        : label === "导出" ? "design-export"
        : "design-save";
      return `<button data-act="${act}" style="min-height:calc(${LOAD_MENU_BUTTON_H}px * var(--sfs, 1))">${label}</button>`;
    }).join("");
    return `<div class="sfs-load" data-menu="load">
      <h2>已保存的设计</h2>
      <div class="sfs-load-list">${rows || `<p>还没有保存的设计。</p>`}</div>
      <input id="design-name" value="${escapeText(renameDraft)}" placeholder="名字" maxlength="24" />
      <input id="design-file" type="file" accept="application/json,.json" hidden />
      <div class="sfs-load-actions">${actions}</div>
    </div>`;
  };

  const failHtml = (sim: FlightState): string => {
    const reason = `速度 ${sim.speed.toFixed(0)} m/s，高度 ${Math.round(sim.altitude)} m`;
    const buttons = FAILURE_MENU.map((item) => `<button data-act="${item.id}">${item.label}</button>`).join("");
    return `<div class="sfs-fail" data-menu="fail">
      <p>${reason}</p>
      ${buttons}
    </div>`;
  };

  const partMenuHtml = (sim: FlightState, id: string): string => {
    const part = sim.vessel.parts.find((p) => p.id === id);
    if (!part) return "";
    const def = PARTS[part.kind];
    const card = partMenuCard({
      id: part.id,
      name: def.name,
      mass: def.dry + part.fuel,
      engine: def.engine,
      chute: def.chute,
      engineOn: part.engineEnabled !== false,
    });
    const body = card.mode === "engine"
      ? `<button data-act="part-engine" data-id="${card.id}">${card.on ? "开" : "关"}</button>`
      : card.mode === "chute"
        ? `<button data-act="part-chute" data-id="${card.id}">开伞</button>`
        : `<p>${card.name}</p><p>质量 ${Math.round(card.mass)} kg</p>`;
    return `<div class="sfs-partmenu" style="width:calc(${PART_MENU.w}px * var(--sfs, 1));height:calc(${PART_MENU.h}px * var(--sfs, 1))">
      <span class="sfs-partmenu-arrow"></span>
      <strong>${def.name}</strong>
      ${body}
      <button data-act="part-close">关闭</button>
    </div>`;
  };

  const selectHtml = (): string => {
    const title = targetTitle(selectTarget, aliases);
    const rows = SELECT_ROWS.map((row) => `<button data-act="select-${row.id}" style="width:calc(${row.w}px * var(--sfs, 1));height:calc(${row.h}px * var(--sfs, 1))">${row.label}</button>`).join("");
    return `<div class="sfs-select" data-menu="select">
      <h2>${title}</h2>
      ${rows}
      <button data-act="select-timewarp" style="width:calc(${TIMEWARP_TO.w}px * var(--sfs, 1));height:calc(${TIMEWARP_TO.h}px * var(--sfs, 1))">${TIMEWARP_TO.label}</button>
      <input id="alias-name" placeholder="新名字" maxlength="16" />
    </div>`;
  };

  const menuHtml = (): string => {
    if (!menuOpen) return "";
    const groups = menuGroups(screen);
    const buttonFor = (label: string): string => {
      if (label === "取消") return `<button data-act="menu">取消</button>`;
      if (label === "暂停") return `<button data-act="pause">暂停</button>`;
      if (label === "重试") return `<button data-act="retry">重试</button>`;
      if (label === "返回组装") return `<button data-act="to-build">返回组装</button>`;
      if (label === "首页") return `<button data-act="home">首页</button>`;
      if (label === "朝向") return `<button data-act="sas" aria-pressed="${sas}">${sas ? "保持朝向" : "松开朝向"}</button>`;
      if (label === "简单") return `<button data-act="easy" aria-pressed="${easy}">${easy ? "简单：开" : "简单：关"}</button>`;
      if (label === "声音") return `<button data-act="sound" aria-pressed="${sound}">${sound ? "声音：开" : "声音：关"}</button>`;
      if (label === "说明") return `<button data-act="help">说明</button>`;
      if (label === "清除存档") return `<button data-act="reset">清除存档</button>`;
      if (label === "图纸") return `<button data-act="load-menu">图纸</button>`;
      if (label === "设置") return `<button data-act="settings">设置</button>`;
      return "";
    };
    const pauseLead = screen === "flight" ? `<div class="sfs-menu-label">暂停</div><button data-act="resume">继续飞</button>` : "";
    return `<div class="sfs-sheet" data-menu="grouped" data-pauses="${openingMenuPauses(screen)}">${pauseLead}${groups
      .map((group) => `<div class="sfs-menu-label">${group.label}</div>${group.items.map(buttonFor).join("")}`)
      .join("")}</div>`;
  };

  const pauseHtml = (): string => `<div class="modal"><div class="card">
    <h2>暂停</h2>
    <div class="row">
      <button class="primary" data-act="resume">继续飞</button>
      <button data-act="retry">重试</button>
      <button data-act="to-build">返回组装</button>
    </div>
  </div></div>`;

  const modalHtml = (): string => {
    if (modal === "settings") {
      const rows = SETTINGS_ITEMS.map((label) => {
        if (label === "朝向") return `<button data-act="sas" aria-pressed="${sas}">${sas ? "保持朝向" : "松开朝向"}</button>`;
        if (label === "简单") return `<button data-act="easy" aria-pressed="${easy}">${easy ? "简单：开" : "简单：关"}</button>`;
        if (label === "声音") return `<button data-act="sound" aria-pressed="${sound}">${sound ? "声音：开" : "声音：关"}</button>`;
        return `<button data-act="help">说明</button>`;
      }).join("");
      return `<div class="modal" data-page="settings"><div class="card">
        <h2>设置</h2>
        <div class="row">${rows}</div>
        <button data-act="close-settings">关闭</button>
      </div></div>`;
    }
    if (modal === "missions") {
      const rows = missionMarks(missions).map((item) => `<p class="${item.on ? "on" : ""}">${item.label}${item.on ? "：完成" : "：还没有"}</p>`).join("");
      return `<div class="modal" data-page="missions"><div class="card"><h2>任务</h2>${rows}<button data-act="close-settings">关闭</button></div></div>`;
    }
    if (modal === "help") {
      return `<div class="modal"><div class="card">
        <h2>三步就会飞</h2>
        <p>1. 点零件，再点格子，挨着拼。</p>
        <p>2. 可以发射时，点右上角「发射」。示例箭一定能飞。</p>
        <p>3. 右边推油门，底下左右转，右下角分离。回家时在空气里开伞。</p>
        <button class="primary" data-act="close-help">知道了</button>
      </div></div>`;
    }
    if (modal === "reset") {
      return `<div class="modal"><div class="card">
        <h2>${RESET_CONFIRM_TITLE}</h2>
        <p>火箭图纸和任务星星会丢掉。没有名字或其他个人信息。</p>
        <div class="row">
          <button class="primary" data-act="reset-yes">清除</button>
          <button data-act="close-help">留下</button>
        </div>
      </div></div>`;
    }
    if (modal === "load") return loadHtml();
    return "";
  };

  const go = (next: "home" | "build" | "flight"): void => {
    screen = next;
    ghost = null;
    drag = null;
    modal = null;
    menuOpen = false;
    if (next !== "flight") {
      paused = false;
      mapMode = false;
      throttle = 0;
    }
    render();
    persist();
  };

  const loadPreset = (id: string): void => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    note();
    if (screen === "home") screen = "build";
    parts = preset.build();
    selectedId = null;
    selectedKind = null;
    buildMsg = "";
    render();
    persist();
  };

  const launch = (blueprint: Placed[]): void => {
    const report = analyze(blueprint, easy);
    if (!report.ok) {
      buildMsg = report.errors[0] ?? "还不能发射";
      say(buildMsg);
      if (screen === "build") render();
      return;
    }
    parts = blueprint.map((p) => ({ ...p }));
    flight = createFlight(parts, easy, sas);
    throttle = 0;
    engineOn = true;
    paused = false;
    mapMode = false;
    mapFollow = true;
    mapCenter = { x: flight.vessel.pos.x, y: flight.vessel.pos.y };
    warpWant = 1;
    endDismissed = false;
    warpUntil = null;
    history = new FlightHistory();
    selectOpen = false;
    orbitFx = false;
    particles.length = 0;
    const viewH = canvas.clientHeight || 700;
    zoom = clamp((viewH * 0.40) / 20, 9, 22);
    cam = { x: 0, y: PLANET.radius + 30, zoom };
    screen = "flight";
    modal = null;
    menuOpen = false;
    render();
    persist();
    audio.click();
  };

  let clickStamp = 0;
  let pressedAct: { id: number; el: HTMLElement; at: number } | null = null;
  const activate = (el: HTMLElement): void => {
    clickStamp = performance.now();
    const holdBtn = el.closest<HTMLElement>("[data-hold]");
    if (holdBtn) {
      steerPulse = holdBtn.dataset.hold === "left" ? -1 : 1;
      steerPulseUntil = performance.now() + 650;
    }
    const act = el.dataset.act;
    if (act === "build") go("build");
    else if (act === "continue") {
      if (!parts.length) say("还没有火箭，先造一艘");
      else go("build");
    }
    else if (act === "missions") { modal = "missions"; menuOpen = false; render(); }
    else if (act === "settings") {
      menuOpen = false;
      modal = "settings";
      if (screen === "flight") paused = true;
      render();
    }
    else if (act === "close-settings") { modal = null; render(); }
    else if (act === "end-next") { endDismissed = true; render(); }
    else if (act === "recover") {
      if (flight && flight.phase === "landed") {
        say("回收了");
        go("build");
      } else say("落地之后才能回收");
    }
    else if (act === "home") go("home");
    else if (act === "to-build") go("build");
    else if (act === "fly-starter") launch(PRESETS[0]!.build());
    else if (act === "help") { modal = "help"; render(); }
    else if (act === "close-help") { modal = null; tutorial = true; render(); persist(); }
    else if (act === "reset") { modal = "reset"; render(); }
    else if (act === "reset-yes") {
      clearSave();
      const fresh = loadSave();
      easy = fresh.easy;
      sound = false;
      sas = true;
      tutorial = false;
      missions = { ...fresh.missions };
      parts = [];
      designs = [];
      pickedDesign = null;
      log.clear();
      audio.setEnabled(false);
      modal = "help";
      screen = "home";
      flight = null;
      render();
    } else if (act === "easy") {
      easy = !easy;
      if (flight) flight.easy = easy;
      render();
      persist();
    } else if (act === "sound") {
      sound = !sound;
      audio.setEnabled(sound);
      if (sound) audio.click();
      render();
      persist();
    } else if (act === "kind") {
      const kind = el.dataset.kind as PartKind;
      selectedKind = selectedKind === kind ? null : kind;
      selectedId = null;
      buildMsg = selectedKind ? `点格子，放下${PARTS[selectedKind].name}。${PARTS[selectedKind].blurb}` : "";
      render();
    }     else if (act === "undo") undo();
    else if (act === "redo") redo();
    else if (act === "flip") flip();
    else if (act === "delete") removeSelected();
    else if (act === "clear") { note(); parts = []; selectedId = null; buildMsg = "工作台空了"; render(); persist(); }
    else if (act === "preset") loadPreset(el.dataset.id || "");
    else if (act === "launch") launch(parts);
    else if (act === "stage") queueStage = true;
    else if (act === "chute") queueChute = true;
    else if (act === "sas") {
      sas = !sas;
      if (flight) flight.sas = sas;
      render();
      persist();
    } else if (act === "map") {
      mapMode = !mapMode;
      if (mapMode && flight) {
        mapFollow = true;
        mapCenter = { x: flight.vessel.pos.x, y: flight.vessel.pos.y };
      }
      render();
    } else if (act === "follow") {
      mapFollow = !mapFollow;
      if (mapFollow && flight) mapCenter = { x: flight.vessel.pos.x, y: flight.vessel.pos.y };
      render();
    } else if (act === "nav") {
      navMoon = !navMoon;
      approachAt = 0;
      render();
    }
    else if (act === "warp" || act === "warp-up") {
      warpWant = stepWarp(warpWant, 1);
      if (flight && warpWant > 1) {
        const block = warpBlock(flight, warpWant);
        if (block) say(warpRefuseText(block, flight));
      }
      render();
    } else if (act === "warp-down") {
      warpWant = stepWarp(warpWant, -1);
      render();
    } else if (act === "engine-toggle") {
      engineOn = !engineOn;
      render();
    } else if (act === "part-close") {
      partMenuId = null;
      render();
    } else if (act === "part-engine") {
      const id = el.dataset.id;
      const part = flight?.vessel.parts.find((p) => p.id === id);
      if (part) part.engineEnabled = part.engineEnabled === false;
      render();
    } else if (act === "part-chute") {
      queueChute = true;
    } else if (act === "design-import") {
      document.querySelector<HTMLInputElement>("#design-file")?.click();
    } else if (act === "design-export") {
      const blob = new Blob([exportDesigns(currentSave())], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gongfang-designs.json";
      a.click();
      URL.revokeObjectURL(url);
    } else if (act === "menu") {
      menuOpen = !menuOpen;
      if (openingMenuPauses(screen) && modal !== "fail") paused = menuOpen;
      render();
    } else if (act === "load-menu") {
      menuOpen = false;
      modal = "load";
      render();
    } else if (act === "load-close") {
      modal = null;
      if (screen === "flight" && paused) menuOpen = true;
      render();
    } else if (act === "pick-design") {
      pickedDesign = el.dataset.id || null;
      const found = pickedDesign ? findDesign(currentSave(), pickedDesign) : null;
      if (found) renameDraft = found.name;
      render();
    } else if (act === "design-save") {
      const named = (document.querySelector<HTMLInputElement>("#design-name")?.value || "").trim();
      const next = rememberDesign(currentSave(), named, parts);
      designs = next.designs ?? [];
      pickedDesign = designs.at(-1)?.id ?? null;
      persist();
      render();
    } else if (act === "design-delete") {
      if (!pickedDesign) say("先点一个设计");
      else {
        designs = forgetDesign(currentSave(), pickedDesign).designs ?? [];
        pickedDesign = null;
        persist();
        render();
      }
    } else if (act === "design-rename") {
      if (!pickedDesign) say("先点一个设计");
      else {
        const named = (document.querySelector<HTMLInputElement>("#design-name")?.value || "").trim();
        designs = renameDesign(currentSave(), pickedDesign, named).designs ?? [];
        persist();
        render();
      }
    } else if (act === "design-open") {
      const found = pickedDesign ? findDesign(currentSave(), pickedDesign) : null;
      if (!found) say("先点一个设计");
      else {
        parts = found.parts.map((p) => ({ ...p }));
        modal = null;
        screen = "build";
        menuOpen = false;
        persist();
        render();
      }
    } else if (act === "revert-30") {
      if (!flight) return;
      const restored = history.revert(flight.time, 30);
      if (!restored) say("还没有 30 秒前的记录");
      else {
        flight = restored;
        modal = null;
        paused = false;
        throttle = 0;
        render();
      }
    } else if (act === "revert-build") {
      modal = null;
      paused = false;
      go("build");
    } else if (act === "resume") {
      modal = null;
      paused = false;
      menuOpen = false;
      render();
    } else if (act === "pick") {
      const target = el.dataset.target;
      if (target === "moon" || target === "planet" || target === "ship") {
        selectTarget = target;
        selectOpen = true;
        render();
      }
    } else if (act === "select-navigate") {
      navMoon = selectTarget === "moon";
      approachAt = 0;
      say(selectTarget === "moon" ? "飞向月芽" : selectTarget === "planet" ? "飞向青芽星" : "看着火箭");
      render();
    } else if (act === "select-focus") {
      mapFollow = selectTarget === "ship";
      if (flight) {
        if (selectTarget === "ship") mapCenter = { x: flight.vessel.pos.x, y: flight.vessel.pos.y };
        else if (selectTarget === "planet") mapCenter = { x: 0, y: 0 };
        else {
          const moon = moonAt(flight.time);
          mapCenter = { x: moon.pos.x, y: moon.pos.y };
        }
      }
      render();
    } else if (act === "select-switch") {
      selectTarget = nextTarget(selectTarget);
      render();
    } else if (act === "select-rename") {
      const named = (document.querySelector<HTMLInputElement>("#alias-name")?.value || "").trim();
      if (named) aliases[selectTarget] = named.slice(0, 16);
      render();
    } else if (act === "select-recover") {
      if (flight && flight.phase === "landed") {
        selectOpen = false;
        go("build");
        say("回收了");
      } else say("落地之后才能回收");
    } else if (act === "select-timewarp") {
      if (!flight || !approach || selectTarget !== "moon") say("先飞向月芽，等交会出现");
      else {
        const block = warpBlock(flight, 5);
        if (block) say(warpRefuseText(block, flight));
        else {
          warpUntil = approach.at;
          warpWant = 5;
          say("加速到交会");
        }
      }
      render();
    } else if (act === "nudge-up") nudge(-1);
    else if (act === "nudge-down") nudge(1);
    else if (act === "symmetry") { symmetry = !symmetry; render(); }
    else if (act === "pause") { paused = true; modal = "pause"; menuOpen = false; render(); }
    else if (act === "resume") { paused = false; modal = null; render(); }
    else if (act === "retry") {
      if (!flight) return;
      flight = retryFlight(flight);
      burnAcc = 0;
      throttle = 0;
      engineOn = true;
      paused = false;
      modal = null;
      orbitFx = false;
      mapFollow = true;
      mapCenter = { x: flight.vessel.pos.x, y: flight.vessel.pos.y };
      say("回到发射架了");
      render();
    }     else if (act === "zoom-in") {
      if (screen === "build") buildView = clamp(buildView * 1.12, 0.82, 1.28);
      else zoom = clamp(zoom * 1.2, 4, 42);
    } else if (act === "zoom-out") {
      if (screen === "build") buildView = clamp(buildView / 1.12, 0.82, 1.28);
      else zoom = clamp(zoom / 1.2, 4, 42);
    }
    else if (act === "th-up") throttle = clamp(throttle + 0.1, 0, 1);
    else if (act === "th-down") throttle = clamp(throttle - 0.1, 0, 1);
    if (sound && act !== "sound") audio.click();
  };
  ui.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el || (el as HTMLButtonElement).disabled) return;
    activate(el);
  });

  ui.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.id === "th-range") throttle = Number(t.value) / 100;
  });

  const steerPointers = new Map<number, number>();
  const syncSteer = (): void => {
    const values = [...steerPointers.values()];
    steerHold = values.length ? values[values.length - 1] : 0;
  };
  const takeHold = (ev: PointerEvent): void => {
    const hold = (ev.target as HTMLElement).closest<HTMLElement>("[data-hold]");
    if (!hold) return;
    steerPointers.set(ev.pointerId, hold.dataset.hold === "left" ? -1 : 1);
    syncSteer();
    try { hold.setPointerCapture(ev.pointerId); } catch { /* older WebView */ }
    ev.preventDefault();
  };
  const dropHold = (ev: PointerEvent): void => {
    const cap = ev.target as HTMLElement;
    if (cap && typeof cap.releasePointerCapture === "function") {
      try { if (cap.hasPointerCapture?.(ev.pointerId)) cap.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    }
    if (!steerPointers.has(ev.pointerId)) return;
    steerPointers.delete(ev.pointerId);
    syncSteer();
  };
  const rememberPress = (ev: PointerEvent): void => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el || (el as HTMLButtonElement).disabled || el.closest("[data-hold]")) {
      pressedAct = null;
      return;
    }
    pressedAct = { id: ev.pointerId, el, at: clickStamp };
  };
  const fallbackPress = (ev: PointerEvent): void => {
    const pressed = pressedAct;
    if (!pressed || pressed.id !== ev.pointerId) return;
    pressedAct = null;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const el = under?.closest<HTMLElement>("[data-act]");
    if (!el || el !== pressed.el || (el as HTMLButtonElement).disabled) return;
    const seen = pressed.at;
    window.setTimeout(() => {
      if (clickStamp !== seen || !el.isConnected) return;
      el.click();
    }, 320);
  };
  ui.addEventListener("change", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.id !== "design-file" || !input.files?.[0]) return;
    const file = input.files[0];
    input.value = "";
    void file.text().then((text) => {
      const before = currentSave();
      const result = importDesigns(before, text);
      if (!result.ok) {
        say(result.reason);
        return;
      }
      designs = result.data.designs ?? [];
      persist();
      say(result.added > 0 ? `导入了 ${result.added} 份图纸` : "文件里没有新图纸");
      render();
    });
  });
  ui.addEventListener("pointerdown", (ev) => {
    rememberPress(ev);
    takeHold(ev);
    const pad = (ev.target as HTMLElement).closest("#vpad");
    if (pad) {
      padDrag = true;
      try { (pad as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* older WebView */ }
      setPad(ev.clientY);
      ev.preventDefault();
    }
  });
  ui.addEventListener("pointermove", (ev) => {
    if (padDrag) setPad(ev.clientY);
    if (!steerPointers.has(ev.pointerId)) return;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!under || !under.closest("[data-hold]")) {
      steerPointers.delete(ev.pointerId);
      syncSteer();
    }
  });
  ui.addEventListener("pointerup", (ev) => {
    dropHold(ev);
    fallbackPress(ev);
  });
  ui.addEventListener("pointercancel", (ev) => {
    dropHold(ev);
    if (pressedAct?.id === ev.pointerId) pressedAct = null;
  });
  window.addEventListener("pointermove", (ev) => {
    if (drag && screen === "build") dragAt = { x: ev.clientX, y: ev.clientY };
    if (!steerPointers.has(ev.pointerId)) return;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!under || !under.closest("[data-hold]")) {
      steerPointers.delete(ev.pointerId);
      syncSteer();
    }
  });
  window.addEventListener("pointerup", (ev) => {
    dropHold(ev);
    fallbackPress(ev);
    padDrag = false;
    if (drag && screen === "build") finishDrag();
  });
  window.addEventListener("pointercancel", (ev) => {
    dropHold(ev);
    if (pressedAct?.id === ev.pointerId) pressedAct = null;
    padDrag = false;
  });
  ui.addEventListener("contextmenu", (ev) => ev.preventDefault());
  document.addEventListener("selectstart", (ev) => ev.preventDefault());
  const releaseHeld = (): void => {
    steerPointers.clear();
    steerHold = 0;
    padDrag = false;
    keys.clear();
    pressedAct = null;
    mapDrag = null;
  };

  const setPad = (clientY: number): void => {
    const pad = document.getElementById("vpad");
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const raw = clamp(1 - (clientY - r.top) / r.height, 0, 1);
    // The bottom edge of the pad was recording about 0.15% and the engines
    // kept burning. The fuel percent stayed on the same integer. That residual
    // walked the coast. The bottom of the pad is off.
    throttle = raw < 0.02 ? 0 : raw;
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (screen === "flight" && mapMode && flight) {
      if (mapDrag) return;
      mapDrag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* older WebView */ }
      return;
    }
    if (screen === "flight" && flight && !mapMode) {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      let best: { id: string; d: number } | null = null;
      for (const p of flight.vessel.parts) {
        const at = worldToScreen(partWorld(flight.vessel, p), cam, w, h);
        const d = Math.hypot(at.x - sx, at.y - sy);
        const reach = Math.max(24, Math.hypot(p.halfW, p.halfH) * cam.zoom + 16);
        if (d <= reach && (!best || d < best.d)) best = { id: p.id, d };
      }
      if (best) {
        partMenuId = best.id;
        render();
      }
      return;
    }
    if (screen !== "build") return;
    const rect = canvas.getBoundingClientRect();
    const geom = gridGeom(canvas.clientWidth, canvas.clientHeight, insets(), buildView);
    const cell = cellFromPoint(ev.clientX - rect.left, ev.clientY - rect.top, geom);
    if (!cell) return;
    const hit = partAt(parts, cell.x, cell.y);
    if (hit) {
      selectedId = hit.id;
      selectedKind = null;
      drag = { id: hit.id, dx: cell.x - hit.x, dy: cell.y - hit.y, x: hit.x, y: hit.y, moved: false };
      render();
      return;
    }
    if (selectedKind) placeAt(selectedKind, cell.x, cell.y);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (mapDrag && ev.pointerId === mapDrag.id && mapMode) {
      const dx = ev.clientX - mapDrag.x;
      const dy = ev.clientY - mapDrag.y;
      if (dx * dx + dy * dy < 16) return;
      const z = Math.max(cam.zoom, 1e-6);
      mapCenter = { x: mapCenter.x - dx / z, y: mapCenter.y + dy / z };
      mapDrag = { id: mapDrag.id, x: ev.clientX, y: ev.clientY, moved: true };
      if (mapFollow) {
        mapFollow = false;
        render();
      }
      return;
    }
    if (!drag || screen !== "build") return;
    const rect = canvas.getBoundingClientRect();
    const geom = gridGeom(canvas.clientWidth, canvas.clientHeight, insets(), buildView);
    const cell = cellFromPoint(ev.clientX - rect.left, ev.clientY - rect.top, geom);
    if (!cell) return;
    const part = parts.find((p) => p.id === drag!.id);
    if (!part) return;
    const nx = cell.x - drag.dx;
    const ny = cell.y - drag.dy;
    if (nx !== drag.x || ny !== drag.y) drag.moved = true;
    drag.x = nx;
    drag.y = ny;
    const issue = placementIssue(parts, part.kind, nx, ny, part.id, "move");
    ghost = { kind: part.kind, x: nx, y: ny, ok: !issue };
  });
  const endMapDrag = (ev: PointerEvent): void => {
    if (!mapDrag || mapDrag.id !== ev.pointerId) return;
    const moved = mapDrag.moved;
    mapDrag = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    if (moved || !flight || !mapMode) return;
    const rect = canvas.getBoundingClientRect();
    const moon = moonAt(flight.time);
    const spot = worldToScreen(moon.pos, cam, canvas.clientWidth, canvas.clientHeight);
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const reach = Math.max(28, MOON.radius * cam.zoom + 12);
    if (Math.hypot(px - spot.x, py - spot.y) <= reach) {
      navMoon = !navMoon;
      approachAt = 0;
      render();
    }
  };
  canvas.addEventListener("pointerup", endMapDrag);
  canvas.addEventListener("pointercancel", endMapDrag);

  const finishDrag = (): void => {
    if (!drag) return;
    const rail = document.querySelector(".sfs-parts")?.getBoundingClientRect();
    if (drag.moved && dragAt && rail && overPartsRail(dragAt.x, dragAt.y, rail)) {
      note();
      const id = drag.id;
      parts = parts.filter((p) => p.id !== id);
      if (selectedId === id) selectedId = null;
      buildMsg = "拖回零件栏，拆掉了";
      drag = null;
      dragAt = null;
      ghost = null;
      render();
      persist();
      return;
    }
    const part = parts.find((p) => p.id === drag!.id);
    if (part && drag.moved) {
      const issue = placementIssue(parts, part.kind, drag.x, drag.y, part.id, "move");
      const twin = symmetry ? mirrorPartner(part) : null;
      const mx = mirrorX(part.kind, drag.x);
      const twinIssue = twin ? placementIssue(parts, twin.kind, mx, drag.y, twin.id, "move") : null;
      if (!issue && !twinIssue) {
        note();
        part.x = drag.x;
        part.y = drag.y;
        if (twin && mx !== drag.x) {
          twin.x = mx;
          twin.y = drag.y;
        }
        buildMsg = "";
        persist();
      } else buildMsg = issue || twinIssue || "";
    }
    drag = null;
    dragAt = null;
    ghost = null;
    render();
  };

  const placeAt = (kind: PartKind, cx: number, cy: number): void => {
    const d = PARTS[kind];
    const x = cx - Math.floor(d.w / 2);
    const y = cy - Math.floor(d.h / 2);
    const issue = placementIssue(parts, kind, x, y, undefined, "new");
    if (issue) {
      buildMsg = issue;
      say(issue);
      render();
      return;
    }
    const mx = mirrorX(kind, x);
    const mirrored = symmetry && mx !== x;
    if (mirrored) {
      const mirrorIssue = placementIssue([...parts, { id: "tmp", kind, x, y }], kind, mx, y, undefined, "new");
      if (mirrorIssue) {
        buildMsg = `对称放不下：${mirrorIssue}`;
        say(buildMsg);
        render();
        return;
      }
    }
    note();
    parts.push({ id: `p${seq++}`, kind, x, y });
    if (mirrored) parts.push({ id: `p${seq++}`, kind, x: mx, y });
    buildMsg = PARTS[kind].blurb;
    render();
    persist();
  };

  const undo = (): void => {
    const prev = log.undo(parts);
    if (!prev) return;
    parts = prev;
    selectedId = null;
    render();
    persist();
  };
  const redo = (): void => {
    const next = log.redo(parts);
    if (!next) return;
    parts = next;
    selectedId = null;
    render();
    persist();
  };
  const flip = (): void => {
    const next = flipParts(parts);
    if (!next) {
      say("这样翻转放不下");
      return;
    }
    note();
    parts = next;
    selectedId = null;
    buildMsg = "";
    render();
    persist();
  };
  const mirrorPartner = (part: Placed): Placed | null => {
    const mx = mirrorX(part.kind, part.x);
    if (mx === part.x) return null;
    return parts.find((p) => p.id !== part.id && p.kind === part.kind && p.x === mx && p.y === part.y) ?? null;
  };
  const nudge = (dy: number): void => {
    if (!selectedId) return;
    const part = parts.find((p) => p.id === selectedId);
    if (!part) return;
    const twin = symmetry ? mirrorPartner(part) : null;
    const issue = placementIssue(parts, part.kind, part.x, part.y + dy, part.id, "move");
    const twinIssue = twin ? placementIssue(parts, twin.kind, twin.x, twin.y + dy, twin.id, "move") : null;
    if (issue || twinIssue) {
      buildMsg = issue || twinIssue || "";
      render();
      return;
    }
    note();
    part.y += dy;
    if (twin) twin.y += dy;
    buildMsg = "";
    render();
    persist();
  };
  const removeSelected = (): void => {
    if (!selectedId) return;
    const part = parts.find((p) => p.id === selectedId);
    const twin = part && symmetry ? mirrorPartner(part) : null;
    note();
    const drop = new Set([selectedId, twin?.id].filter((id): id is string => !!id));
    parts = parts.filter((p) => !drop.has(p.id));
    selectedId = null;
    buildMsg = twin ? "对称的两件都拆了" : "拆掉了";
    render();
    persist();
  };

  window.addEventListener("keydown", (ev) => {
    if (ev.key === " " || ev.key === "Escape") ev.preventDefault();
    keys.add(ev.key.toLowerCase());
    const k = ev.key.toLowerCase();
    if (screen === "build" && (k === "backspace" || k === "delete")) removeSelected();
    if (screen === "build" && (ev.ctrlKey || ev.metaKey) && k === "z") {
      if (ev.shiftKey) redo();
      else undo();
    }
    if (screen === "flight" && ev.key === " ") queueStage = true;
    if (screen === "flight" && k === "g") queueChute = true;
    if (screen === "flight" && k === "m") { mapMode = !mapMode; render(); }
    if (ev.key === "Escape") {
      if (modal) { modal = null; render(); return; }
      if (screen === "flight" && !paused) { paused = true; modal = "pause"; render(); }
      else if (screen === "flight" && paused) { paused = false; modal = null; render(); }
      else if (screen === "build") go("home");
    }
  });
  window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));

  window.__tgBack = () => {
    if (screen === "flight" && (paused || modal === "pause")) {
      go("build");
      return true;
    }
    if (modal) { modal = null; render(); return true; }
    if (screen === "flight") {
      paused = true;
      modal = "pause";
      render();
      return true;
    }
    if (screen === "build") { go("home"); return true; }
    return false;
  };

  window.__tg = {
    screen: () => screen,
    launchStarter: () => launch(PRESETS[0]!.build()),
    snapshot: () => flight && ({
      screen,
      phase: flight.phase,
      alt: flight.altitude,
      vs: flight.verticalSpeed,
      fuel: flight.fuelMass,
      throttle: flight.vessel.throttle,
      angle: flight.vessel.angle,
      angVel: flight.vessel.angVel,
      steer: steerHold,
      sim: flight.time,
      speed: flight.speed,
      vx: flight.vessel.vel.x,
      vy: flight.vessel.vel.y,
      predClosest: approach?.closest ?? null,
      predAt: approach?.at ?? null,
      predRel: approach?.relSpeed ?? null,
      warp: warpWant,
      chute: flight.chuteOpen,
      parts: flight.vessel.parts.map((p) => p.id),
      orbitHold: flight.orbitHold,
      paused,
      map: mapMode,
      follow: mapFollow,
      nav: navMoon,
      encounter: approach ? isEncounter(approach) : false,
      camX: cam.x,
      camY: cam.y,
      camZoom: cam.zoom,
      x: flight.vessel.pos.x,
      y: flight.vessel.pos.y,
      orbit: flight.orbit.kind,
    }),
    /** Diagnostic only. Nothing here steers or throttles the ship. */
    diag: () => {
      if (!flight) return null;
      const fresh = predictApproach(flight.vessel.pos, flight.vessel.vel, flight.time, 1400, PREDICT_DT);
      const moon = moonAt(flight.time);
      return {
        sim: flight.time,
        phase: flight.phase,
        easy: flight.easy,
        sas: flight.sas,
        chute: flight.chuteOpen,
        body: flight.body,
        landedOn: flight.landedOn,
        padY: flight.padY,
        x: flight.vessel.pos.x,
        y: flight.vessel.pos.y,
        vx: flight.vessel.vel.x,
        vy: flight.vessel.vel.y,
        angle: flight.vessel.angle,
        angVel: flight.vessel.angVel,
        mass: flight.vessel.mass,
        inertia: flight.vessel.inertia,
        hasCom: flight.vessel.hasCom,
        comX: flight.vessel.com.x,
        comY: flight.vessel.com.y,
        vesselThrottle: flight.vessel.throttle,
        commandThrottle: throttle,
        engineOn,
        steerHold,
        warp: warpWant,
        fuel: flight.fuelMass,
        fuelCap: flight.fuelCap,
        parts: flight.vessel.parts.map((p) => ({
          id: p.id,
          kind: p.kind,
          x: p.x,
          y: p.y,
          fuel: p.fuel,
          localX: p.localX,
          localY: p.localY,
          halfW: p.halfW,
          halfH: p.halfH,
        })),
        moonX: moon.pos.x,
        moonY: moon.pos.y,
        moonVx: moon.vel.x,
        moonVy: moon.vel.y,
        predictDt: PREDICT_DT,
        freshClosest: fresh.closest,
        freshAt: fresh.at,
        freshRel: fresh.relSpeed,
        shownClosest: approach?.closest ?? null,
        shownAt: approach?.at ?? null,
        shownRel: approach?.relSpeed ?? null,
        shownAgeMs: approach ? performance.now() - approachAt : null,
      };
    },
  };

  const insets = () => ({ top: 34, bottom: 58, left: PARTS_BAR.left + PARTS_BAR.width + 8, right: 46 });

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ui.style.setProperty("--sfs", flightUiScale(w, h).toFixed(4));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener("resize", resize);
  resize();

  let acc = 0;
  let last = performance.now();
  const dropBacklog = (): void => {
    last = performance.now();
    acc = 0;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseHeld();
    dropBacklog();
  });
  window.addEventListener("pagehide", () => {
    releaseHeld();
    dropBacklog();
  });
  const loop = (now: number): void => {
    if (document.hidden || paused || modal === "pause" || modal === "fail") {
      last = performance.now();
      acc = 0;
      if (!document.hidden && screen === "flight" && flight) updateHud();
      requestAnimationFrame(loop);
      return;
    }
    // rAF does not run on a headless emulator: there is no vsync. Timers still
    // fire, so the step uses the real clock either way. Pause drops the gap
    // instead of fast-forwarding when the player comes back.
    const wallNow = performance.now();
    const gap = Math.max(0, (wallNow - last) / 1000);
    last = wallNow;
    const real = Math.min(0.25, gap);
    resize();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (keys.has("w") || keys.has("arrowup")) throttle = clamp(throttle + real * 0.5, 0, 1);
    if (keys.has("s") || keys.has("arrowdown")) throttle = clamp(throttle - real * 0.5, 0, 1);
    const flightWarp = flight && warpAllowed(flight) ? warpWant : 1;
    const cueNow = flight && navMoon ? navCue(flight, flightWarp) : null;
    let steer = steerHold;
    if (keys.has("a") || keys.has("arrowleft")) steer -= 1;
    if (keys.has("d") || keys.has("arrowright")) steer += 1;
    if (performance.now() < steerPulseUntil) steer += steerPulse;
    steer = clamp(steer, -1, 1);

    if (screen === "flight" && flight) {
      let warp = appliedWarp(flight, warpWant);
      if (warpUntil !== null && flight.time >= warpUntil) warpUntil = null;
      if (warpUntil !== null) warp = Math.max(warp, appliedWarp(flight, 5));
      const beforeT = flight.time;
      const wake = consumeWake(acc, gap, warp, false);
      acc = wake.acc;
      const steps = Math.min(Math.round(wake.sim * 60), warpStepBudget(warp, flight.altitude, flight.speed));
      for (let i = 0; i < steps; i++) {
        stepFlight(
          flight,
          {
            throttle: commandThrottle(throttle, engineOn),
            steer,
            stage: queueStage,
            chute: queueChute,
            turnCap: cueNow ? turnCapFor(cueNow) : undefined,
          },
          1 / 60,
        );
        queueStage = false;
        queueChute = false;
      }
      if (navMoon && engineOn && throttle > 0.05) burnAcc += Math.max(0, flight.time - beforeT);
      else if (!navMoon) burnAcc = 0;
      for (const ev of flight.fx) {
        if (ev === "stage") { burst(flight.vessel.pos.x, flight.vessel.pos.y, "stage"); audio.stage(); say("分离成功"); }
        else if (ev === "chute") { audio.chute(); say("降落伞打开了"); }
        else if (ev === "land") { burst(flight.vessel.pos.x, flight.vessel.pos.y, "land"); audio.good(); say("轻轻落地了"); render(); }
        else if (ev === "crash") {
          audio.soft();
          say("火箭散开了，再试一次");
          modal = "fail";
          paused = true;
          render();
        }
        else if (ev === "retry") burst(flight.vessel.pos.x, flight.vessel.pos.y, "retry");
        else if (ev.startsWith("msg:")) say(ev.slice(4));
      }
      flight.fx.length = 0;
      if (flight.phase === "flight" || flight.phase === "rail") history.note(flight);
      if (flight.altitude < 40 && flight.vessel.throttle > 0.35 && particles.length < 24) {
        particles.push({
          x: flight.vessel.pos.x + (Math.random() - 0.5) * 1.4,
          y: flight.vessel.pos.y - 5,
          vx: (Math.random() - 0.5) * 3,
          vy: -2,
          life: 0.4,
          max: 0.4,
          size: 28,
          sprite: 9,
          additive: false,
        });
      }
      const before = { ...missions };
      if (flight.maxAlt >= 400) missions.sky = true;
      if (flight.phase === "landed" && flight.reachedHigh) missions.home = true;
      if (flight.orbitHold >= 3) {
        missions.orbit = true;
        if (!orbitFx) {
          orbitFx = true;
          burst(flight.vessel.pos.x, flight.vessel.pos.y, "orbit");
          audio.good();
          say("绕上青芽星了");
        }
      }
      if (before.sky !== missions.sky) say("飞上天空了");
      if (before.home !== missions.home && flight.phase === "landed") say("平安回家了");
      if (before.sky !== missions.sky || before.home !== missions.home || before.orbit !== missions.orbit) persist();
    } else acc = 0;

    for (const p of particles) {
      p.life -= real;
      p.x += p.vx * real;
      p.y += p.vy * real;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i]!.life <= 0) particles.splice(i, 1);

    if (flight && (mapMode || navMoon) && now - approachAt > 400) {
      approach = predictApproach(flight.vessel.pos, flight.vessel.vel, flight.time, 1400, PREDICT_DT);
      approachAt = now;
    }
    if (screen === "home") paintHome(ctx, w, h, now / 1000);
    else if (screen === "build") paintBuild(ctx, w, h);
    else if (flight) paintFlight(ctx, w, h, flight, now / 1000, real);
    updateHud();
    audio.rumble(screen === "flight" && flight && !paused ? flight.vessel.throttle : 0);
    requestAnimationFrame(loop);
  };

  const updateHud = (): void => {
    if (screen !== "flight" || !flight) return;
    const agl = document.getElementById("t-agl");
    const asl = document.getElementById("t-asl");
    const vs = document.getElementById("t-vs");
    const att = document.getElementById("t-att");
    const missionEl = document.getElementById("t-missions");
    const fuel = document.getElementById("t-fuel");
    const fill = document.getElementById("fuel-fill");
    const twr = document.getElementById("t-twr");
    const hint = document.getElementById("hint");
    const clock = document.getElementById("t-clock");
    const warpEl = document.getElementById("t-warp");
    const moonEl = document.getElementById("t-moon");
    const relEl = document.getElementById("t-rel");
    const passEl = document.getElementById("t-pass");
    const mark = document.getElementById("vpad-mark");
    const meter = document.getElementById("burnmeter");
    const burnFill = document.getElementById("burnfill");
    const burnLabel = document.getElementById("burnlabel");
    const toastEl = document.getElementById("toast");
    const caps = document.getElementById("caps");
    const temps = document.getElementById("temps");
    if (temps) temps.innerHTML = temperatureMarkup(flight.vessel.parts);
    const vfill = document.getElementById("vpad-fill");
    const range = document.querySelector<HTMLInputElement>("#th-range");
    const pad = document.getElementById("vpad");
    const heights = heightReadings(flight);
    if (agl) agl.textContent = formatHudAlt(heights.agl);
    if (asl) asl.textContent = formatHudAlt(heights.asl);
    if (vs) vs.textContent = formatHudSpeed(flight.speed);
    if (att) att.textContent = attitudeText(flight.vessel.angle);
    if (missionEl) {
      missionEl.innerHTML = missionMarks(missions).map((item) => `<span class="${item.on ? "on" : ""}">${item.label}</span>`).join("");
    }
    const pct = flight.fuelCap > 0 ? Math.round((flight.fuelMass / flight.fuelCap) * 100) : 0;
    if (fuel) fuel.textContent = `${pct}%`;
    if (fill) fill.style.width = `${pct}%`;
    if (twr) twr.textContent = formatNum(flight.twr, 2);
    const bars = fuelBars(flight);
    const stageList = document.getElementById("stage-list");
    if (stageList) stageList.innerHTML = stageListMarkup(flight.vessel.parts);
    const cue = flight && navMoon ? navCue(flight, warpAllowed(flight) ? warpWant : 1) : null;
    if (hint) hint.textContent = cue ? cue.text : flight ? flightHint(flight) : "";
    if (clock) {
      const sec = Math.max(0, Math.floor(flight.time));
      clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }
    const liveRate = paused || modal === "pause" || document.hidden ? 1 : appliedWarp(flight, warpWant);
    if (warpEl) warpEl.textContent = paused || modal === "pause" || document.hidden ? "暂停" : `${liveRate}×`;
    const warpCenter = document.getElementById("warp-center");
    if (warpCenter) {
      const mark = warpCenterText(liveRate);
      warpCenter.hidden = mark === null;
      warpCenter.textContent = mark ?? "";
    }
    if (moonEl) {
      if (navMoon) {
        const moon = moonAt(flight.time);
        const dist = Math.hypot(flight.vessel.pos.x - moon.pos.x, flight.vessel.pos.y - moon.pos.y);
        const rel = Math.hypot(flight.vessel.vel.x - moon.vel.x, flight.vessel.vel.y - moon.vel.y);
        moonEl.textContent = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;
        if (relEl) relEl.textContent = `${Math.round(rel)}m/s`;
        if (passEl) {
          const closest = approach?.closest;
          const arrival = approach?.relSpeed;
          const distText = closest != null && Number.isFinite(closest)
            ? (closest >= 1000 ? `${(closest / 1000).toFixed(1)}km` : `${Math.round(closest)}m`)
            : "";
          const at = approach?.at;
          const atText = at != null && Number.isFinite(at)
            ? `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, "0")}`
            : "";
          passEl.textContent = distText
            ? `${distText}，到时 ${Math.round(arrival ?? 0)}m/s，时刻 ${atText}`
            : "—";
        }
      } else {
        moonEl.textContent = "—";
        if (relEl) relEl.textContent = "—";
        if (passEl) passEl.textContent = "—";
      }
    }
    if (mark) {
      mark.hidden = !cue?.mark;
      if (cue?.mark != null) mark.style.bottom = `${Math.round(cue.mark * 100)}%`;
    }
    if (meter && burnFill && burnLabel) {
      const show = Boolean(cue && (cue.mark || cue.green));
      meter.hidden = !show;
      meter.classList.toggle("green", Boolean(cue?.green));
      burnFill.style.width = `${Math.max(4, Math.min(100, (burnAcc / 8) * 100))}%`;
      burnLabel.textContent = cue?.green ? "松手" : `已推 ${burnAcc.toFixed(1)}s`;
    }
    if (toastEl) toastEl.textContent = performance.now() < toastUntil ? toast : "";
    if (vfill) vfill.style.height = `${Math.round(throttle * 84)}%`;
    if (pad) pad.setAttribute("aria-valuenow", String(Math.round(throttle * 100)));
    if (range && document.activeElement !== range) range.value = String(Math.round(throttle * 100));
    if (caps) {
      caps.innerHTML = bars.map((b) => `<span><em>${b.label}</em><b><i style="width:${b.pct}%"></i></b></span>`).join("");
    }
  };

  const paintHome = (context: CanvasRenderingContext2D, w: number, h: number, time: number): void => {
    drawSky(context, w, h, 200);
    drawStars(context, w, h, { x: time * 8, y: 0, zoom: 1 }, time);
    drawPlanet(context, { x: 0, y: PLANET.radius - h * 0.15, zoom: Math.min(w, h) / (PLANET.radius * 1.8) }, w, h);
  };

  const paintBuild = (context: CanvasRenderingContext2D, w: number, h: number): void => {
    drawWorkshop(context, w, h);
    const geom = gridGeom(w, h, insets(), buildView);
    const report = analyze(parts, easy);
    const bad = new Set([...report.disconnected, ...report.solidBlocked]);
    drawGrid(context, geom, parts, art, selectedId, bad, ghost, w, h);
  };

  const paintFlight = (context: CanvasRenderingContext2D, w: number, h: number, sim: FlightState, time: number, wall: number): void => {
    const follow = mapMode
      ? mapCamera(w, h, zoom, mapFollow
        ? { x: sim.vessel.pos.x, y: sim.vessel.pos.y }
        : mapCenter)
      : { x: sim.vessel.pos.x, y: sim.vessel.pos.y, zoom };
    if (mapMode && mapFollow) mapCenter = { x: sim.vessel.pos.x, y: sim.vessel.pos.y };
    const gap = Math.hypot(follow.x - cam.x, follow.y - cam.y) * (mapMode ? follow.zoom : zoom);
    if (mapMode || reduce || gap > Math.min(w, h) * 0.28) cam = follow;
    else {
      const k = 1 - Math.exp(-6 * Math.max(wall, 1 / 60));
      cam = { x: cam.x + (follow.x - cam.x) * k, y: cam.y + (follow.y - cam.y) * k, zoom };
    }
    if (mapMode) {
      drawMapSky(context, w, h);
      drawStars(context, w, h, cam, time);
    } else {
      drawSky(context, w, h, sim.altitude);
      if (sim.altitude > 2_500) drawStars(context, w, h, cam, time);
    }
    drawPlanet(context, cam, w, h);
    if (flight) drawMoon(context, cam, w, h, sim.time);
    if (mapMode && approach) drawPrediction(context, approach, cam, w, h);
    else if (mapMode) drawOrbit(context, sim, cam, w, h);
    for (const d of sim.debris) drawVessel(context, d.vessel, false, cam, w, h, art, time, 0.85);
    drawVessel(context, sim.vessel, sim.chuteOpen, cam, w, h, art, time, sim.phase === "crashed" ? 0.55 : 1, sim.chuteStage);
    if (!mapMode && flight && navMoon) {
      const aim = navCue(flight, warpAllowed(flight) ? warpWant : 1);
      if (aim.aim === "moon" || aim.aim === "retro-moon" || aim.aim === "tangent") {
        drawDirectionMark(context, sim.vessel.pos, navAimAngle(flight, aim), cam, w, h);
      } else drawProgradeMark(context, sim.vessel.pos, sim.vessel.vel, cam, w, h);
    } else if (!mapMode) drawProgradeMark(context, sim.vessel.pos, sim.vessel.vel, cam, w, h);
    if (!mapMode) drawVelocityArrows(context, sim.vessel.pos, sim.vessel.vel, cam, w, h);
    drawParticles(context, particles, cam, w, h, art);
    if (mapMode) {
      const rocket = worldToScreen(sim.vessel.pos, cam, w, h);
      context.fillStyle = "#ff7a62";
      context.beginPath();
      context.arc(rocket.x, rocket.y, 6, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff6ea";
      context.font = "16px ui-sans-serif, sans-serif";
      const cue = flight && navMoon ? navCue(flight, warpAllowed(flight) ? warpWant : 1).text : "";
      const note = sim.orbit.kind === "radial" ? "" : "预测线没算空气";
      const meet = navMoon && approach && isEncounter(approach) ? "交会要来了" : "";
      context.fillText(cue || meet || note, 16, h - 148);
    }
  };

  render();
  requestAnimationFrame(loop);
  window.setInterval(() => {
    if (document.hidden) return;
    if (performance.now() - last > 80) loop(performance.now());
  }, 40);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function fuelBars(flight: FlightState): { label: string; pct: number }[] {
  const parts = flight.vessel.parts;
  const bars: { label: string; pct: number }[] = [];
  const boosters = parts
    .filter((p) => PARTS[p.kind].booster && PARTS[p.kind].fuel > 0)
    .slice()
    .sort((a, b) => a.x - b.x);
  for (const b of boosters) {
    const cap = PARTS[b.kind].fuel;
    bars.push({ label: b.x < 6 ? "左助推" : "右助推", pct: cap > 0 ? Math.round((b.fuel / cap) * 100) : 0 });
  }
  const tanks = parts.filter((p) => PARTS[p.kind].tank);
  const sep = parts.filter((p) => PARTS[p.kind].separator).sort((a, b) => b.y - a.y)[0];
  const lower = sep ? tanks.filter((t) => t.y > sep.y) : tanks;
  const upper = sep ? tanks.filter((t) => t.y < sep.y) : [];
  const hasLower = parts.some((p) => p.kind === "engine_l");
  const hasUpper = parts.some((p) => p.kind === "engine_s");
  const pack = (list: typeof tanks, label: string): void => {
    const cap = list.reduce((sum, p) => sum + PARTS[p.kind].fuel, 0);
    const fuel = list.reduce((sum, p) => sum + p.fuel, 0);
    if (cap > 0) bars.push({ label, pct: Math.round((fuel / cap) * 100) });
  };
  if (hasLower) pack(lower, "芯级");
  if (hasUpper) pack(hasLower ? upper : (sep ? upper : lower), "上面级");
  if (!hasLower && !hasUpper) pack(tanks, "燃料");
  return bars;
}
