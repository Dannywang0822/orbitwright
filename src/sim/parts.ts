import { FLYING_SOLID_BOOSTER } from "./estimates.ts";
import { CELL_H, CELL_W, GRID_COLS, GRID_ROWS } from "./math.ts";

export type PartKind =
  | "pod"
  | "chute"
  | "tank_s"
  | "tank_m"
  | "tank_l"
  | "engine_s"
  | "engine_l"
  | "separator"
  | "legs"
  | "booster"
  | "shield";

export type Dir = "up" | "down" | "left" | "right";

export interface PartDef {
  kind: PartKind;
  name: string;
  blurb: string;
  w: number;
  h: number;
  dry: number;
  fuel: number;
  thrust: number;
  isp: number;
  connects: Dir[];
  pod: boolean;
  engine: boolean;
  separator: boolean;
  chute: boolean;
  legs: boolean;
  booster: boolean;
  tank: boolean;
  drag: number;
  sprite: string | null;
  color: string;
  accent: string;
}

const ALL: Dir[] = ["up", "down", "left", "right"];

export const PARTS: Record<PartKind, PartDef> = {
  pod: {
    kind: "pod",
    name: "指挥舱",
    blurb: "乘员舱，只比筒稍宽。不是卫星整流罩。",
    w: 2,
    h: 2,
    dry: 420,
    fuel: 0,
    thrust: 0,
    isp: 0,
    connects: ALL,
    pod: true,
    engine: false,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: "pod",
    color: "#fff6ea",
    accent: "#ff8b73",
  },
  chute: {
    kind: "chute",
    name: "降落伞",
    blurb: "降到 2500 米、慢于 250 米每秒再开。点一次半开，再点一次全开。",
    w: 2,
    h: 1,
    dry: 28,
    fuel: 0,
    thrust: 0,
    isp: 0,
    connects: ["up", "down"],
    pod: false,
    engine: false,
    separator: false,
    chute: true,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: null,
    color: "#ff8a5b",
    accent: "#fff1dc",
  },
  tank_s: {
    kind: "tank_s",
    name: "小油箱",
    blurb: "轻一点，适合上面一级。",
    w: 2,
    h: 2,
    dry: 48,
    fuel: 260,
    thrust: 0,
    isp: 0,
    connects: ALL,
    pod: false,
    engine: false,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: true,
    drag: 0,
    sprite: "tank_s",
    color: "#7ec8c3",
    accent: "#f4efe2",
  },
  tank_m: {
    kind: "tank_m",
    name: "中油箱",
    blurb: "示例火箭底下用它。",
    w: 2,
    h: 3,
    dry: 78,
    fuel: 340,
    thrust: 0,
    isp: 0,
    connects: ALL,
    pod: false,
    engine: false,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: true,
    drag: 0,
    sprite: "tank_m",
    color: "#5eb8b0",
    accent: "#ffe1a8",
  },
  tank_l: {
    kind: "tank_l",
    name: "大油箱",
    blurb: "很重。引擎不够就飞不起来。",
    w: 2,
    h: 4,
    dry: 130,
    fuel: 820,
    thrust: 0,
    isp: 0,
    connects: ALL,
    pod: false,
    engine: false,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: true,
    drag: 0,
    sprite: "tank_l",
    color: "#3e9d98",
    accent: "#e7f2ef",
  },
  engine_s: {
    kind: "engine_s",
    name: "小引擎",
    blurb: "对应原版 Frontier 的推力/质量比 100/6、比冲 290。干质量仍用我们的零件。",
    w: 2,
    h: 2,
    dry: 110,
    fuel: 0,
    thrust: 11_000,
    isp: 290,
    connects: ALL,
    pod: false,
    engine: true,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: "engine_s",
    color: "#f0d3a0",
    accent: "#e07a3d",
  },
  engine_l: {
    kind: "engine_l",
    name: "大引擎",
    blurb: "对应原版 Titan 的推力/质量比 400/12、比冲 240。干质量仍用我们的零件。",
    w: 2,
    h: 2,
    dry: 190,
    fuel: 0,
    thrust: 38_000,
    isp: 240,
    connects: ALL,
    pod: false,
    engine: true,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: "engine_l",
    color: "#d7dde6",
    accent: "#d4652f",
  },
  separator: {
    kind: "separator",
    name: "分离环",
    blurb: "级间。按下分离，下面一级离开。燃料不会穿过它。",
    w: 2,
    h: 1,
    dry: 24,
    fuel: 0,
    thrust: 0,
    isp: 0,
    connects: ["up", "down"],
    pod: false,
    engine: false,
    separator: true,
    chute: false,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: null,
    color: "#f2c14e",
    accent: "#8a5a12",
  },
  legs: {
    kind: "legs",
    name: "着陆腿",
    blurb: "装在两侧，落地多一点缓冲。",
    w: 1,
    h: 2,
    dry: 32,
    fuel: 0,
    thrust: 0,
    isp: 0,
    connects: ["left", "right"],
    pod: false,
    engine: false,
    separator: false,
    chute: false,
    legs: true,
    booster: false,
    tank: false,
    drag: 0,
    sprite: "legs",
    color: "#d5dbe3",
    accent: "#6d7c8a",
  },
  booster: {
    kind: "booster",
    name: "助推器",
    blurb: "挂在旁边，自带燃料。预制体公式是湿重=高×宽×2 吨、干重占 0.2、比冲 60。那一组换到这颗星上抬不起来，也会错过已经对准的返航窗口，所以飞行仍用原来的质量和比冲。推力没有按向量另换。",
    w: 1,
    h: 5,
    dry: FLYING_SOLID_BOOSTER.dryKg,
    fuel: FLYING_SOLID_BOOSTER.fuelKg,
    thrust: FLYING_SOLID_BOOSTER.thrustN,
    isp: FLYING_SOLID_BOOSTER.isp,
    connects: ["left", "right"],
    pod: false,
    engine: true,
    separator: false,
    chute: false,
    legs: false,
    booster: true,
    tank: false,
    drag: 0,
    sprite: "booster",
    color: "#f4efe6",
    accent: "#e15b3a",
  },
  shield: {
    kind: "shield",
    name: "隔热罩",
    blurb: "质量按宽×0.25 吨。耐热 2，普通零件是 1。",
    w: 2,
    h: 1,
    // Measured: mass = width × 0.25 tonnes. Stored in kilograms.
    dry: 2 * 0.25 * 1000,
    fuel: 0,
    thrust: 0,
    isp: 0,
    connects: ["up", "down"],
    pod: false,
    engine: false,
    separator: false,
    chute: false,
    legs: false,
    booster: false,
    tank: false,
    drag: 0,
    sprite: null,
    color: "#c4552a",
    accent: "#f2c14e",
  },
};

/** Measured heatTolerance: 2 on the heat shield, 1 on every other part. */
export function heatToleranceOf(kind: PartKind): number {
  return kind === "shield" ? 2 : 1;
}

/** Measured Heat Shield mass in kilograms: width × 0.25 tonnes. */
export function heatShieldMassKg(width: number): number {
  return width * 0.25 * 1000;
}

export const PART_ORDER: PartKind[] = [
  "pod",
  "chute",
  "tank_s",
  "tank_m",
  "tank_l",
  "engine_s",
  "engine_l",
  "separator",
  "shield",
  "booster",
  "legs",
];

export interface Placed {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
}

export function partSize(kind: PartKind): { w: number; h: number } {
  const d = PARTS[kind];
  return { w: d.w * CELL_W, h: d.h * CELL_H };
}

export function inBounds(kind: PartKind, x: number, y: number): boolean {
  const d = PARTS[kind];
  return x >= 0 && y >= 0 && x + d.w <= GRID_COLS && y + d.h <= GRID_ROWS;
}

function piece(id: string, kind: PartKind, x: number, y: number): Placed {
  return { id, kind, x, y };
}

/** Known-good rocket: upper stage, separator, lower engine. Always launchable. */
export function starterRocket(): Placed[] {
  return [
    piece("st-pod", "pod", 5, 0),
    piece("st-chute", "chute", 5, 2),
    piece("st-tank-s", "tank_s", 5, 3),
    piece("st-eng-s", "engine_s", 5, 5),
    piece("st-sep", "separator", 5, 7),
    piece("st-tank-m", "tank_m", 5, 8),
    piece("st-eng-l", "engine_l", 5, 11),
  ];
}

/** Short hop home. Parachute and legs, no staging required. */
export function hopperRocket(): Placed[] {
  return [
    piece("hp-pod", "pod", 5, 0),
    piece("hp-chute", "chute", 5, 2),
    piece("hp-tank", "tank_m", 5, 3),
    piece("hp-leg-l", "legs", 4, 4),
    piece("hp-leg-r", "legs", 7, 4),
    piece("hp-eng", "engine_l", 5, 6),
  ];
}

/** More fuel for a gravity turn. Orbit is optional and must be flown. */
/** Core stack plus two side boosters as long as the lower tank and engine. They leave together on the first stage. */
export function clusterRocket(): Placed[] {
  return [
    piece("cl-pod", "pod", 5, 0),
    piece("cl-chute", "chute", 5, 2),
    piece("cl-tank-s", "tank_s", 5, 3),
    piece("cl-eng-s", "engine_s", 5, 5),
    piece("cl-sep", "separator", 5, 7),
    piece("cl-tank-m", "tank_m", 5, 8),
    piece("cl-boost-l", "booster", 4, 8),
    piece("cl-boost-r", "booster", 7, 8),
    piece("cl-eng-l", "engine_l", 5, 11),
  ];
}

export function orbiterRocket(): Placed[] {
  return [
    piece("ob-pod", "pod", 5, 0),
    piece("ob-chute", "chute", 5, 2),
    piece("ob-tank-s", "tank_s", 5, 3),
    piece("ob-eng-s", "engine_s", 5, 5),
    piece("ob-sep", "separator", 5, 7),
    piece("ob-tank-l", "tank_l", 5, 8),
    piece("ob-boost-l", "booster", 4, 9),
    piece("ob-boost-r", "booster", 7, 9),
    piece("ob-eng-l", "engine_l", 5, 12),
  ];
}

export interface RocketPreset {
  id: string;
  name: string;
  blurb: string;
  build: () => Placed[];
}

export const PRESETS: RocketPreset[] = [
  { id: "starter", name: "示例火箭", blurb: "能飞、能分离、能开伞", build: starterRocket },
  { id: "hopper", name: "回家小箭", blurb: "飞高一点再开伞", build: hopperRocket },
  { id: "orbiter", name: "绕圈火箭", blurb: "油多一些，适合慢慢转向", build: orbiterRocket },
  { id: "cluster", name: "三芯箭", blurb: "两侧助推先分离，芯级后分离", build: clusterRocket },
];
