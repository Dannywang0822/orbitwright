// Part catalog. Masses match the v1 table.
// Isp_g and a few thrusts are TUNABLE: the draft Isp (2800 / 3600 / 1600) cannot
// lift this mass ratio to a 7.9 km/s orbit. Comments keep the draft numbers.
// eng_vac thrust is lowered from 160 so a light lander can hover on the slider.
OW.PARTS = {
  cmd_mk1: {
    id: "cmd_mk1",
    name: "指令舱 Mk1",
    kind: "command",
    cat: "pod",
    m: 1.2,
    mDry: 1.2,
    fuel: 0,
    T: 0,
    isp: 0,
    h: 2.4,
    w: 2.2,
    color: "#e6c27a",
    accent: "#a8833d",
  },
  tank_s: {
    id: "tank_s",
    name: "燃料箱 S",
    kind: "tank",
    cat: "fuel",
    m: 2.0,
    mDry: 0.4,
    fuel: 1.6,
    T: 0,
    isp: 0,
    h: 2.2,
    w: 2.2,
    color: "#d5dee8",
    accent: "#8ea0b3",
  },
  tank_m: {
    id: "tank_m",
    name: "燃料箱 M",
    kind: "tank",
    cat: "fuel",
    m: 5.0,
    mDry: 0.9,
    fuel: 4.1,
    T: 0,
    isp: 0,
    h: 4.0,
    w: 2.3,
    color: "#c3d0de",
    accent: "#7e93a8",
  },
  tank_l: {
    id: "tank_l",
    name: "燃料箱 L",
    kind: "tank",
    cat: "fuel",
    m: 10.0,
    mDry: 1.6,
    fuel: 8.4,
    T: 0,
    isp: 0,
    h: 6.4,
    w: 2.5,
    color: "#8eabc4",
    accent: "#5d7c96",
    unlock: "moon",
  },
  eng_main: {
    id: "eng_main",
    name: "主发动机",
    kind: "engine",
    cat: "engine",
    m: 1.5,
    mDry: 1.5,
    fuel: 0,
    T: 220, // kN, draft
    isp: 15000, // TUNABLE m/s (draft 2800). Scaled so a steep-then-flat ascent can circularize and still land.
    sl: 0.92, // sea-level thrust & Isp factor
    h: 2.0,
    w: 1.8,
    color: "#e0703a",
    accent: "#8d3d16",
  },
  eng_vac: {
    id: "eng_vac",
    name: "真空发动机",
    kind: "engine",
    cat: "engine",
    m: 1.2,
    mDry: 1.2,
    fuel: 0,
    T: 80, // TUNABLE kN (draft 160) — hover-friendly on the Moon
    isp: 19000, // TUNABLE m/s (draft 3600)
    sl: 0.25,
    wasteAtmo: true, // full fuel flow for a fraction of the thrust in air
    h: 2.6,
    w: 1.35,
    color: "#6eb6d8",
    accent: "#2e6e8c",
    unlock: "orbit",
  },
  boost_srb: {
    id: "boost_srb",
    name: "固体助推",
    kind: "booster",
    cat: "boost",
    m: 3.5,
    mDry: 1.0,
    fuel: 2.5,
    T: 180, // kN, draft
    isp: 8600, // TUNABLE m/s (draft 1600)
    sl: 0.95,
    h: 4.8,
    w: 1.25,
    color: "#f2efe8",
    accent: "#c4553a",
  },
  leg_basic: {
    id: "leg_basic",
    name: "着陆架",
    kind: "legs",
    cat: "legs",
    m: 0.4,
    mDry: 0.4,
    fuel: 0,
    T: 0,
    isp: 0,
    h: 1.5,
    w: 3.6,
    color: "#9aa3ad",
    accent: "#5c656e",
  },
};

OW.PART_ORDER = [
  "cmd_mk1",
  "tank_s",
  "tank_m",
  "tank_l",
  "eng_main",
  "eng_vac",
  "boost_srb",
  "leg_basic",
];

OW.CATS = [
  { id: "pod", name: "舱体" },
  { id: "fuel", name: "燃料" },
  { id: "engine", name: "引擎" },
  { id: "boost", name: "助推" },
  { id: "legs", name: "着陆" },
];

OW.STACK_LIMIT = 10;
OW.BOOSTER_LIMIT = 8;

OW.partUnlocked = function (id, save) {
  var p = OW.PARTS[id];
  if (!p || !p.unlock) return true;
  if (p.unlock === "orbit") return !!(save && (save.orbitReached || (save.unlocks && save.unlocks.engVac)));
  if (p.unlock === "moon") return !!(save && save.moonCleared);
  return false;
};

OW.unlockHint = function (id) {
  var p = OW.PARTS[id];
  if (!p || !p.unlock) return "";
  if (p.unlock === "orbit") return "首次入轨后解锁";
  if (p.unlock === "moon") return "登月通关后解锁";
  return "未解锁";
};

// s = 1 at sea level, 0 in vacuum. Returns thrust kN at full throttle and mdot t/s.
OW.partPerf = function (def, s) {
  if (!def || !def.T) return { thrust: 0, mdot: 0, isp: 0 };
  var sl = def.sl == null ? 1 : def.sl;
  var thrustScale = 1 + (sl - 1) * s;
  var thrust = def.T * thrustScale;
  var isp;
  var mdot;
  if (def.wasteAtmo) {
    isp = def.isp;
    mdot = def.T / def.isp;
    thrust = def.T * thrustScale;
  } else {
    isp = def.isp * (1 + (sl - 1) * s);
    mdot = isp > 0 ? thrust / isp : 0;
  }
  return { thrust: thrust, mdot: mdot, isp: isp };
};
