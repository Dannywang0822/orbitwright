import { stageGroups } from "../sim/assembly.ts";
import type { FlightState } from "../sim/flight.ts";
import { PLANET } from "../sim/math.ts";
import { PARTS, type PartKind } from "../sim/parts.ts";
import { MOON, moonAt } from "../sim/world.ts";

/**
 * Left Text from World_Mobile, reference pixels.
 * Anchor (0,1)–(0.5,1), pos (15,-95), sizeDelta (-45, 275).
 */
export const LEFT_TEXT = { left: 15, top: 95, height: 275, widthTrim: 45 };

/** Throttle/staging column width from the measured sizeDelta. */
export const STAGE_ZONE_W = 90;

/** Parts column width is PARTS_BAR in measured.ts. 46×6 is only the hamburger stroke. */

/** Original system-back screen order was not in the extract. The existing hook is unchanged. */
export const SYSTEM_BACK_NOTE = "未还原，未套用";

export interface HeightReadings {
  agl: number;
  asl: number;
}

/** 离地 is the lowest-point clearance. 海拔 is the vessel origin above that body's radius. */
export function heightReadings(state: FlightState): HeightReadings {
  const agl = state.altitude;
  if (state.body === "moon") {
    const moon = moonAt(state.time);
    const asl = Math.hypot(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y) - MOON.radius;
    return { agl, asl };
  }
  const asl = Math.hypot(state.vessel.pos.x, state.vessel.pos.y) - PLANET.radius;
  return { agl, asl };
}

export interface StageRow {
  index: number;
  title: string;
  detail: string;
  armed: boolean;
}

function detailOf(group: { kind: PartKind }[]): string {
  const names: string[] = [];
  for (const part of group) {
    const name = PARTS[part.kind].name;
    if (!names.includes(name)) names.push(name);
  }
  return names.join("·");
}

/** Lowest stage is armed and drawn last, so the separation control sits at the bottom of the list. */
export function stageList(parts: { id: string; kind: PartKind; x: number; y: number }[]): StageRow[] {
  const groups = stageGroups(parts);
  const rows = groups.map((group, index) => ({
    index: index + 1,
    title: index === 0 ? "分离" : `${index + 1} 级`,
    detail: detailOf(group),
    armed: index === 0,
  }));
  return rows.reverse();
}

export function stageListMarkup(parts: { id: string; kind: PartKind; x: number; y: number }[]): string {
  return stageList(parts)
    .map((row) => {
      const body = `<b>${row.title}</b><small>${row.detail}</small>`;
      if (row.armed) return `<button class="sfs-stage-row" data-act="stage" data-stage="${row.index}">${body}</button>`;
      return `<div class="sfs-stage-row wait">${body}</div>`;
    })
    .join("");
}

/** Opening the flight menu pauses. Build and home menus do not. */
export function openingMenuPauses(screen: "home" | "build" | "flight"): boolean {
  return screen === "flight";
}

/** Bottom guide stays the hint bubble. Events use the center toast. */
export const CHROME = { hint: "bottom", event: "center" } as const;
