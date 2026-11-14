import { describe, expect, it } from "vitest";
import { mirrorX } from "../src/sim/assembly.ts";
import { BlueprintLog, flipParts } from "../src/sim/edits.ts";
import { createFlight, debugPlace, stepFlight } from "../src/sim/flight.ts";
import { hopperRocket, orbiterRocket } from "../src/sim/parts.ts";
import { MOON, moonAt } from "../src/sim/world.ts";
import { MAP_SKY, PREDICTION_DASH, orbitDash } from "../src/render/draw.ts";
import { HAMBURGER_LINE, LEFT_MENUS_W, PARTS_BAR } from "../src/ui/measured.ts";
import {
  CHROME,
  LEFT_TEXT,
  STAGE_ZONE_W,
  SYSTEM_BACK_NOTE,
  heightReadings,
  openingMenuPauses,
  stageList,
  stageListMarkup,
} from "../src/ui/p1.ts";

describe("height readings", () => {
  it("shows clearance and sea-level altitude as two numbers", () => {
    expect(LEFT_TEXT).toEqual({ left: 15, top: 95, height: 275, widthTrim: 45 });
    const state = createFlight(hopperRocket(), true);
    debugPlace(state, 1_000, { x: 40, y: 10 });
    const read = heightReadings(state);
    expect(read.agl).toBeCloseTo(state.altitude, 5);
    expect(read.asl).toBeGreaterThan(read.agl);
    expect(Number.isFinite(read.asl)).toBe(true);
  });

  it("uses the moon radius when the ship is on 月芽", () => {
    const state = createFlight(hopperRocket(), true);
    const moon = moonAt(state.time);
    state.phase = "flight";
    state.vessel.pos = { x: moon.pos.x, y: moon.pos.y + MOON.radius + 800 };
    state.vessel.vel = { x: moon.vel.x, y: moon.vel.y };
    stepFlight(state, { throttle: 0, steer: 0, stage: false, chute: false }, 1 / 60);
    expect(state.body).toBe("moon");
    const read = heightReadings(state);
    expect(read.agl).toBeGreaterThan(0);
    expect(read.asl).toBeGreaterThan(read.agl);
  });
});

describe("stage list", () => {
  it("lists every stage and arms only the next separation", () => {
    expect(STAGE_ZONE_W).toBe(90);
    const rows = stageList(orbiterRocket());
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((row) => row.armed)).toHaveLength(1);
    expect(rows.at(-1)?.armed).toBe(true);
    expect(rows.at(-1)?.title).toBe("分离");
    const html = stageListMarkup(orbiterRocket());
    expect(html.match(/data-act="stage"/g)).toHaveLength(1);
    expect(html).toContain("sfs-stage-row wait");
    expect(html).toContain("助推器");
  });
});

describe("events, map, and orbit lines", () => {
  it("keeps the guide bubble at the bottom and events in the center", () => {
    expect(CHROME).toEqual({ hint: "bottom", event: "center" });
  });

  it("paints the map with the existing dark space color", () => {
    expect(MAP_SKY).toBe("#070b16");
  });

  it("draws a closed orbit solid and the prediction dashed", () => {
    expect(orbitDash("ellipse")).toEqual([]);
    expect(orbitDash("hyperbola")).toEqual([6, 6]);
    expect(orbitDash("radial")).toEqual([6, 6]);
    expect(PREDICTION_DASH).toEqual([6, 6]);
  });
});

describe("redo, flip, menu pause, and the gaps", () => {
  it("undoes and redoes a build edit", () => {
    const log = new BlueprintLog();
    const first = [{ id: "a", kind: "pod" as const, x: 5, y: 0 }];
    log.note(first);
    const second = [...first, { id: "b", kind: "tank_s" as const, x: 5, y: 2 }];
    const back = log.undo(second);
    expect(back).toEqual(first);
    expect(log.canRedo).toBe(true);
    expect(log.redo(back!)).toEqual(second);
    expect(log.undo(second)).toEqual(first);
    expect(log.undo(first)).toBeNull();
  });

  it("flips a part across the build center and flips back", () => {
    const part = { id: "a", kind: "pod" as const, x: 4, y: 0 };
    const once = flipParts([part]);
    expect(once?.[0]?.x).toBe(mirrorX("pod", 4));
    expect(once?.[0]?.x).not.toBe(4);
    expect(flipParts(once!)?.[0]?.x).toBe(4);
    expect(flipParts([{ id: "bad", kind: "tank_l", x: 11, y: 0 }])).toBeNull();
  });

  it("pauses only when the flight menu opens", () => {
    expect(openingMenuPauses("flight")).toBe(true);
    expect(openingMenuPauses("build")).toBe(false);
    expect(openingMenuPauses("home")).toBe(false);
  });

  it("uses the measured parts column and leaves the system back order alone", () => {
    expect(PARTS_BAR.width).toBe(100);
    expect(HAMBURGER_LINE).toEqual({ w: 46, h: 6 });
    expect(LEFT_MENUS_W).toBe(90);
    expect(LEFT_MENUS_W).not.toBe(PARTS_BAR.width);
    expect(SYSTEM_BACK_NOTE).toBe("未还原，未套用");
  });
});
