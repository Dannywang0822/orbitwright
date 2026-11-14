import { describe, expect, it } from "vitest";
import { applyHeat, heatSpeedGate, TEMP_BAR, temperatureBars, temperatureMarkup } from "../src/sim/heat.ts";
import { createFlight, debugPlace, stepFlight, tryChute, type FlightInput } from "../src/sim/flight.ts";
import { heatShieldMassKg, heatToleranceOf, hopperRocket, PARTS, starterRocket } from "../src/sim/parts.ts";
import { defaultSave, exportDesigns, importDesigns, LOAD_MENU_BUTTON_H, parseSave, rememberDesign } from "../src/save.ts";
import { PART_MENU, partMenuCard } from "../src/ui/select-menu.ts";

const full: FlightInput = { throttle: 1, steer: 0, stage: false, chute: false };

describe("design import", () => {
  it("round-trips a local file and leaves a bad file untouched", () => {
    expect(LOAD_MENU_BUTTON_H).toBe(60);
    const saved = rememberDesign(defaultSave(), "回家", starterRocket());
    const text = exportDesigns(saved);
    const empty = defaultSave();
    const back = importDesigns(empty, text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.added).toBe(1);
    expect(back.data.designs?.[0]?.name).toBe("回家");
    expect(back.data.designs?.[0]?.parts.some((p) => p.kind === "pod")).toBe(true);
    const before = saved.designs?.map((d) => d.id) ?? [];
    const bad = importDesigns(saved, "{not json");
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason.length).toBeGreaterThan(0);
    expect(saved.designs?.map((d) => d.id)).toEqual(before);
    const wrong = importDesigns(saved, JSON.stringify({ v: 1, designs: [{ id: "x", name: "坏", parts: [{ kind: "nope" }] }] }));
    expect(wrong.ok).toBe(false);
    expect(saved.designs?.map((d) => d.id)).toEqual(before);
  });

  it("reads an old save with no design list as empty", () => {
    const old = parseSave(JSON.stringify({ v: 1, parts: [] }));
    expect(old.designs).toEqual([]);
    const file = exportDesigns(old);
    const again = importDesigns(old, file);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.added).toBe(0);
    expect(again.data.designs).toEqual([]);
  });
});

describe("heat shield and temperature", () => {
  it("uses the measured shield mass and heat tolerance", () => {
    expect(heatShieldMassKg(PARTS.shield.w)).toBe(PARTS.shield.w * 0.25 * 1000);
    expect(PARTS.shield.dry).toBe(500);
    expect(PARTS.shield.name).toBe("隔热罩");
    expect(heatToleranceOf("shield")).toBe(2);
    expect(heatToleranceOf("pod")).toBe(1);
    expect(heatToleranceOf("engine_s")).toBe(1);
  });

  it("draws at most three named temperature bars", () => {
    expect(TEMP_BAR).toEqual({ w: 120, h: 20, max: 3 });
    const state = createFlight(starterRocket(), true);
    for (const [i, part] of state.vessel.parts.entries()) part.heat = i + 1;
    const bars = temperatureBars(state.vessel.parts);
    expect(bars).toHaveLength(3);
    expect(bars[0]!.heat).toBeGreaterThan(bars[1]!.heat);
    expect(bars[0]!.name.length).toBeGreaterThan(0);
    const html = temperatureMarkup(state.vessel.parts);
    expect(html.match(/sfs-temp-bar/g)).toHaveLength(3);
    expect(html).toContain("width:120px");
    expect(html).toContain("height:20px");
    expect(html).toContain(bars[0]!.name);
  });

  it("heats above the gate, destroys a normal part, and keeps the shield longer", () => {
    const state = createFlight(hopperRocket(), true);
    const pod = state.vessel.parts.find((p) => p.kind === "pod");
    expect(pod).toBeTruthy();
    state.vessel.parts.push({ ...pod!, id: "heat-shield", kind: "shield", heat: 0 });
    debugPlace(state, 200, { x: 1800, y: 0 });
    expect(state.speed).toBeGreaterThan(heatSpeedGate());
    applyHeat(state, 1.2);
    expect(state.vessel.parts.some((p) => p.kind === "pod")).toBe(false);
    const shield = state.vessel.parts.find((p) => p.kind === "shield");
    expect(shield).toBeTruthy();
    expect(shield!.heat ?? 0).toBeLessThanOrEqual(2);
    expect(state.phase).toBe("crashed");
  });

  it("does not heat below the gate, above the air, or on the moon", () => {
    const slow = createFlight(hopperRocket(), true);
    debugPlace(slow, 200, { x: 80, y: 0 });
    expect(slow.speed).toBeLessThan(heatSpeedGate());
    applyHeat(slow, 4);
    expect(slow.vessel.parts.every((p) => (p.heat ?? 0) === 0)).toBe(true);

    const high = createFlight(hopperRocket(), true);
    debugPlace(high, 9_000, { x: 2_000, y: 0 });
    applyHeat(high, 4);
    expect(high.vessel.parts.every((p) => (p.heat ?? 0) === 0)).toBe(true);

    const moon = createFlight(hopperRocket(), true);
    debugPlace(moon, 100, { x: 2_000, y: 0 });
    moon.body = "moon";
    applyHeat(moon, 4);
    expect(moon.vessel.parts.every((p) => (p.heat ?? 0) === 0)).toBe(true);
  });
});

describe("part menu", () => {
  it("is the original card size and only the engine and chute cards have actions", () => {
    expect(PART_MENU).toEqual({ w: 300, h: 408 });
    const engine = partMenuCard({ id: "e", name: "小引擎", mass: 110, engine: true, chute: false, engineOn: true });
    expect(engine).toEqual({ mode: "engine", id: "e", name: "小引擎", on: true });
    const chute = partMenuCard({ id: "c", name: "降落伞", mass: 40, engine: false, chute: true, engineOn: true });
    expect(chute.mode).toBe("chute");
    const tank = partMenuCard({ id: "t", name: "中油箱", mass: 200, engine: false, chute: false, engineOn: true });
    expect(tank).toEqual({ mode: "info", id: "t", name: "中油箱", mass: 200 });
  });

  it("switches one engine off without stopping the other", () => {
    const both = createFlight(starterRocket(), true);
    const one = createFlight(starterRocket(), true);
    const lower = one.vessel.parts.find((p) => p.kind === "engine_l");
    expect(lower).toBeTruthy();
    lower!.engineEnabled = false;
    for (let i = 0; i < 15; i++) {
      stepFlight(both, full, 0.1);
      stepFlight(one, full, 0.1);
    }
    expect(one.fuelMass).toBeGreaterThan(both.fuelMass);
    expect(one.vessel.parts.find((p) => p.kind === "engine_s")?.engineEnabled).not.toBe(false);
    expect(one.vessel.engineOut[lower!.id] ?? 0).toBe(0);
    expect(both.vessel.engineOut[lower!.id] ?? 0).toBeGreaterThan(0);
  });

  it("opens the chute from the card through the same height and speed gates", () => {
    const state = createFlight(hopperRocket(), true);
    debugPlace(state, 3_000, { x: 20, y: 0 });
    expect(tryChute(state).ok).toBe(false);
    expect(state.chuteOpen).toBe(false);
    debugPlace(state, 800, { x: 40, y: -10 });
    expect(state.speed).toBeLessThanOrEqual(250);
    expect(tryChute(state).ok).toBe(true);
    expect(state.chuteStage).toBe(1);
  });
});
