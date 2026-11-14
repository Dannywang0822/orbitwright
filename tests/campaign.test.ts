import { describe, expect, it } from "vitest";
import { createFlight, debugPlace, stepFlight, tryChute, tryStage } from "../src/sim/flight.ts";
import { boosterMassTonnes, TUT1_SIZE, TUT3_SIZE } from "../src/sim/confirmed.ts";
import { PARTS, orbiterRocket, starterRocket } from "../src/sim/parts.ts";
import { SLOW_TURN_RATE, navCue } from "../src/sim/nav.ts";
import { MOON, moonAt, predictApproach } from "../src/sim/world.ts";
import { clearSave, loadSave, writeSave } from "../src/save.ts";
import {
  RESET_CONFIRM_TITLE,
  commandThrottle,
  descentChuteVisible,
  flightUiScale,
  menuGroups,
} from "../src/game.ts";

function shown(text: string): number {
  if (text.includes("一半")) return 0.5;
  if (text.includes("白线") && text.includes("回到")) return 0.1;
  if (text.includes("白线")) return 0.06;
  if (text.includes("推满") || text.includes("推油门") || text.includes("补油")) return 1;
  return 0;
}

describe("parachute gates match the measured prefab", () => {
  it("uses 2500 m and 250 m/s for both difficulties, in two presses", () => {
    for (const easy of [true, false]) {
      const high = createFlight(starterRocket(), easy);
      debugPlace(high, 2_600, { x: 40, y: 0 });
      expect(tryChute(high).ok, easy ? "easy high" : "normal high").toBe(false);
      const fast = createFlight(starterRocket(), easy);
      debugPlace(fast, 800, { x: 0, y: 260 });
      expect(tryChute(fast).ok).toBe(false);
      const ok = createFlight(starterRocket(), easy);
      debugPlace(ok, 1_800, { x: 30, y: -40 });
      expect(ok.speed).toBeLessThanOrEqual(250);
      expect(tryChute(ok).reason).toContain("拉出来");
      expect(ok.chuteStage).toBe(1);
      expect(tryChute(ok).reason).toContain("打开");
      expect(ok.chuteStage).toBe(2);
    }
  });
});

describe("engine ratios and the global switch", () => {
  it("maps Frontier and Titan thrust over mass, and leaves the solid booster alone", () => {
    expect(PARTS.engine_s.thrust / PARTS.engine_s.dry).toBeCloseTo((100 / 6) * 6, 5);
    expect(PARTS.engine_s.isp).toBe(290);
    expect(PARTS.engine_l.thrust / PARTS.engine_l.dry).toBeCloseTo((400 / 12) * 6, 5);
    expect(PARTS.engine_l.isp).toBe(240);
    expect(PARTS.booster.thrust).toBe(11_500);
    expect(PARTS.booster.isp).toBe(240);
    expect(PARTS.booster.dry).toBe(110);
    expect(PARTS.booster.fuel).toBe(400);
    expect(boosterMassTonnes(TUT3_SIZE.width, TUT3_SIZE.height)).toEqual({ wet: 20, dry: 4, fuel: 16 });
    expect(boosterMassTonnes(TUT1_SIZE.width, TUT1_SIZE.height)).toEqual({ wet: 10, dry: 2, fuel: 8 });
    expect(commandThrottle(0.4, false)).toBe(0);
    expect(commandThrottle(0.4, true)).toBe(0.4);
  });

  it("stages the booster pair and then the lower core", () => {
    const state = createFlight(orbiterRocket(), true);
    debugPlace(state, 1_000, { x: 20, y: 10 });
    expect(tryStage(state).ok).toBe(true);
    expect(state.vessel.parts.some((p) => p.kind === "booster")).toBe(false);
    expect(state.vessel.parts.some((p) => p.kind === "separator")).toBe(true);
    expect(tryStage(state).ok).toBe(true);
    expect(state.vessel.parts.some((p) => p.kind === "engine_l")).toBe(false);
    expect(state.vessel.parts.some((p) => p.kind === "engine_s")).toBe(true);
  });
});

describe("save round trip", () => {
  it("writes and reads the same blueprint key", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    clearSave();
    writeSave({
      v: 1,
      easy: true,
      sound: false,
      sas: true,
      tutorial: true,
      missions: { sky: true, home: false, orbit: false },
      parts: [{ id: "pod-1", kind: "pod", x: 5, y: 0 }],
    });
    const loaded = loadSave();
    expect(loaded.parts).toEqual([{ id: "pod-1", kind: "pod", x: 5, y: 0 }]);
    expect(loaded.missions.sky).toBe(true);
    expect(loaded.tutorial).toBe(true);
    clearSave();
    expect(loadSave().parts).toEqual([]);
  });
});

describe("flight menu and chute button", () => {
  it("groups the menu and keeps the save off the lower-left tools", () => {
    const flight = menuGroups("flight");
    expect(flight.map((group) => group.label)).toEqual(["飞行", "设置", "危险"]);
    expect(flight[0]?.items.at(-1)).toBe("取消");
    expect(flight[2]?.items).toEqual(["清除存档"]);
    const flat = flight.flatMap((group) => group.items);
    expect(flat).not.toContain("降落伞");
    expect(flat).not.toContain("放大");
    expect(RESET_CONFIRM_TITLE).toBe("确定清除全部图纸和进度？");
    expect(flightUiScale(800, 1400)).toBeCloseTo(1, 5);
    expect(flightUiScale(1600, 2800)).toBeCloseTo(2, 5);
  });

  it("shows the descent chute button only while coming down", () => {
    expect(descentChuteVisible({ phase: "flight", body: "planet", altitude: 3000, verticalSpeed: -4, chuteStage: 0 })).toBe(true);
    expect(descentChuteVisible({ phase: "flight", body: "planet", altitude: 3000, verticalSpeed: 4, chuteStage: 0 })).toBe(false);
    expect(descentChuteVisible({ phase: "flight", body: "moon", altitude: 800, verticalSpeed: -4, chuteStage: 0 })).toBe(false);
    expect(descentChuteVisible({ phase: "flight", body: "planet", altitude: 3000, verticalSpeed: -4, chuteStage: 2 })).toBe(false);
  });
});

function turnOf(text: string): number {
  return text.includes("按住向右") ? 1 : text.includes("按住向左") ? -1 : 0;
}

describe("visible ascent", () => {
  it("reaches an orbit when the finger is 0.7s late", () => {
    const state = createFlight(orbiterRocket(), true);
    const dt = 1 / 60;
    const late = 0.7;
    let next = 0;
    let hint = "";
    let thr = 0;
    let steer = 0;
    let wantT = -1;
    let wantS = 99;
    let tLeft = 0;
    let sLeft = 0;
    let nextT = 0;
    let nextS = 0;
    let stageLeft = -1;
    let orbit = false;
    while (state.time < 700 && state.phase !== "crashed") {
      if (state.time >= next) {
        hint = navCue(state, 1).text;
        const sw = turnOf(hint);
        const tw = shown(hint);
        if (tw !== wantT) {
          wantT = tw;
          nextT = tw;
          tLeft = late;
        }
        if (sw !== wantS) {
          wantS = sw;
          nextS = sw;
          sLeft = late;
        }
        if (hint.includes("分离")) {
          if (stageLeft < 0) stageLeft = late;
        } else stageLeft = -1;
        next = state.time + 0.2;
      }
      if (tLeft > 0) tLeft -= dt;
      else thr = nextT;
      if (sLeft > 0) sLeft -= dt;
      else steer = nextS;
      let stage = false;
      if (stageLeft >= 0) {
        stageLeft -= dt;
        if (stageLeft < 0) {
          stage = true;
          stageLeft = -1;
        }
      }
      stepFlight(state, {
        throttle: hint.includes("分离") ? 0 : thr,
        steer,
        stage,
        chute: false,
        turnCap: hint.includes("慢慢") ? SLOW_TURN_RATE : undefined,
      }, dt);
      const peri = state.orbit.periapsisAlt ?? -1;
      const apo = state.orbit.apoapsisAlt ?? -1;
      if (peri > 8_000 && apo > 8_000) {
        orbit = true;
        break;
      }
    }
    expect(orbit, `t ${state.time.toFixed(0)} phase ${state.phase} fuel ${state.fuelMass.toFixed(0)}`).toBe(true);
    expect(state.fuelMass).toBeGreaterThan(40);
  }, 60_000);
});

describe("moon window with the nose held on the marker", () => {
  it("enters the sphere on a prograde white-line burn", () => {
    const state = createFlight(orbiterRocket(), true);
    const dt = 1 / 60;
    const late = 0.7;
    let next = 0;
    let hint = "";
    let thr = 0;
    let steer = 0;
    let wantT = -1;
    let wantS = 99;
    let tLeft = 0;
    let sLeft = 0;
    let nextT = 0;
    let nextS = 0;
    let stageLeft = -1;
    while (state.time < 2_500 && state.phase !== "crashed") {
      if (state.time >= next) {
        hint = navCue(state, 1).text;
        if (hint.includes("白线")) break;
        const tw = shown(hint);
        const sw = turnOf(hint);
        if (tw !== wantT) {
          wantT = tw;
          nextT = tw;
          tLeft = late;
        }
        if (sw !== wantS) {
          wantS = sw;
          nextS = sw;
          sLeft = late;
        }
        if (hint.includes("分离")) {
          if (stageLeft < 0) stageLeft = late;
        } else stageLeft = -1;
        next = state.time + 0.2;
      }
      if (tLeft > 0) tLeft -= dt;
      else thr = nextT;
      if (sLeft > 0) sLeft -= dt;
      else steer = nextS;
      let stage = false;
      if (stageLeft >= 0) {
        stageLeft -= dt;
        if (stageLeft < 0) {
          stage = true;
          stageLeft = -1;
        }
      }
      stepFlight(state, {
        throttle: hint.includes("分离") ? 0 : thr,
        steer,
        stage,
        chute: false,
        turnCap: hint.includes("慢慢") ? SLOW_TURN_RATE : undefined,
      }, dt);
    }
    expect(hint).toContain("白线");
    let inside = false;
    let noted = "";
    for (let sec = 0; sec <= 140; sec += 2) {
      const pass = predictApproach(state.vessel.pos, state.vessel.vel, state.time, 4_000, 2);
      const alt = pass.closest - MOON.radius;
      if (alt > 8_000 && pass.closest < MOON.soi) {
        inside = true;
        noted = `t ${sec} alt ${alt.toFixed(0)} rel ${pass.relSpeed.toFixed(0)}`;
        break;
      }
      for (let i = 0; i < 120; i++) {
        state.vessel.angle = Math.atan2(state.vessel.vel.x, state.vessel.vel.y);
        state.vessel.angVel = 0;
        stepFlight(state, { throttle: 0.1, steer: 0, stage: false, chute: false }, dt);
      }
    }
    expect(inside, noted || "the marker burn never entered the sphere").toBe(true);
  }, 120_000);
});

describe("0.7s finger from launch to home", () => {
  it("orbits, captures the moon, lands, lifts off, opens the chute and lands at home", async () => {
    const state = createFlight(orbiterRocket(), true);
    const dt = 1 / 60;
    const late = 0.7;
    let next = 0;
    let hint = "";
    let thr = 0;
    let steer = 0;
    let wantT = -1;
    let wantS = 99;
    let tLeft = 0;
    let sLeft = 0;
    let nextT = 0;
    let nextS = 0;
    let stageLeft = -1;
    let orbit = false;
    let entered = false;
    let moonLand = false;
    let lifted = false;
    let home = false;
    let breathe = 0;
    while (state.time < 80_000 && state.phase !== "crashed") {
      if (state.time >= next) {
        hint = navCue(state, 1).text;
        const tw = shown(hint);
        const sw = turnOf(hint);
        if (tw !== wantT) {
          wantT = tw;
          nextT = tw;
          tLeft = late;
        }
        if (sw !== wantS) {
          wantS = sw;
          nextS = sw;
          sLeft = late;
        }
        if (hint.includes("分离")) {
          if (stageLeft < 0) stageLeft = late;
        } else stageLeft = -1;
        next = state.time + 0.2;
      }
      if (tLeft > 0) tLeft -= dt;
      else thr = nextT;
      if (sLeft > 0) sLeft -= dt;
      else steer = nextS;
      let stage = false;
      if (stageLeft >= 0) {
        stageLeft -= dt;
        if (stageLeft < 0) {
          stage = true;
          stageLeft = -1;
        }
      }
      const chute =
        state.phase === "flight" &&
        state.body !== "moon" &&
        state.altitude <= 2_500 &&
        state.speed <= 250 &&
        state.verticalSpeed < 0 &&
        state.chuteStage < 2 &&
        (hint.includes("开伞") || moonLand);
      stepFlight(state, {
        throttle: hint.includes("分离") ? 0 : thr,
        steer,
        stage,
        chute,
        turnCap: hint.includes("慢慢") ? SLOW_TURN_RATE : undefined,
      }, dt);
      const peri = state.orbit.periapsisAlt ?? -1;
      const apo = state.orbit.apoapsisAlt ?? -1;
      if (!orbit && peri > 8_000 && apo > 8_000) orbit = true;
      const moon = moonAt(state.time);
      const d = Math.hypot(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
      if (!entered && d < MOON.soi) entered = true;
      if (!moonLand && state.phase === "landed" && state.landedOn === "moon") moonLand = true;
      if (moonLand && state.phase === "flight") lifted = true;
      if (lifted && state.phase === "landed" && state.landedOn === "planet") {
        home = true;
        break;
      }
      breathe += 1;
      if (breathe % 8_000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(orbit, "orbit").toBe(true);
    expect(entered, "sphere").toBe(true);
    expect(moonLand, "moon landing").toBe(true);
    expect(lifted, "liftoff").toBe(true);
    expect(state.chuteStage, "chute").toBe(2);
    expect(home, `home phase ${state.phase} t ${state.time.toFixed(0)} fuel ${state.fuelMass.toFixed(0)}`).toBe(true);
    expect(MOON.radius).toBeCloseTo(11_534.43, 1);
    expect(MOON.semiMajorAxis).toBeCloseTo(1_493_475.57, 0);
    expect(MOON.soi).toBeCloseTo(331_096.3, 0);
  }, 240_000);
});
