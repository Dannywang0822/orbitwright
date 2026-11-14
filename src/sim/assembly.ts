import { G0, PLANET } from "./math.ts";
import { PARTS, type Dir, type PartKind, type Placed } from "./parts.ts";

const OPP: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

export interface GridPart {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
}

export type Blockage = "clear" | "separator" | "solid";

function cells(p: GridPart): { x: number; y: number }[] {
  const d = PARTS[p.kind];
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) out.push({ x: p.x + x, y: p.y + y });
  }
  return out;
}

function dirBetween(ax: number, ay: number, bx: number, by: number): Dir | null {
  if (ax === bx && by === ay + 1) return "down";
  if (ax === bx && by === ay - 1) return "up";
  if (ay === by && bx === ax + 1) return "right";
  if (ay === by && bx === ax - 1) return "left";
  return null;
}

export function partsTouch(a: GridPart, b: GridPart): boolean {
  const da = PARTS[a.kind];
  const db = PARTS[b.kind];
  for (const ca of cells(a)) {
    for (const cb of cells(b)) {
      const dir = dirBetween(ca.x, ca.y, cb.x, cb.y);
      if (!dir) continue;
      if (da.connects.includes(dir) && db.connects.includes(OPP[dir])) return true;
    }
  }
  return false;
}

export function overlaps(a: GridPart, b: GridPart): boolean {
  const da = PARTS[a.kind];
  const db = PARTS[b.kind];
  return a.x < b.x + db.w && a.x + da.w > b.x && a.y < b.y + db.h && a.y + da.h > b.y;
}

function neighbors(parts: GridPart[], p: GridPart): GridPart[] {
  return parts.filter((o) => o.id !== p.id && partsTouch(p, o));
}

function reachable(parts: GridPart[], origin: GridPart, block?: (p: GridPart) => boolean): Set<string> {
  const seen = new Set<string>([origin.id]);
  const q = [origin];
  while (q.length) {
    const cur = q.pop()!;
    for (const n of neighbors(parts, cur)) {
      if (seen.has(n.id)) continue;
      if (block?.(n)) continue;
      seen.add(n.id);
      q.push(n);
    }
  }
  return seen;
}

export function partAt(parts: GridPart[], x: number, y: number): GridPart | null {
  for (const p of parts) {
    const d = PARTS[p.kind];
    if (x >= p.x && x < p.x + d.w && y >= p.y && y < p.y + d.h) return p;
  }
  return null;
}

export function nozzleBlock(parts: GridPart[], engine: GridPart): Blockage {
  const d = PARTS[engine.kind];
  let sep = false;
  let solid = false;
  const y = engine.y + d.h;
  for (let x = engine.x; x < engine.x + d.w; x++) {
    const p = partAt(parts, x, y);
    if (!p || p.id === engine.id) continue;
    if (PARTS[p.kind].separator) sep = true;
    else solid = true;
  }
  if (solid) return "solid";
  if (sep) return "separator";
  return "clear";
}

export function fuelTanks(parts: GridPart[], engine: GridPart): GridPart[] {
  if (PARTS[engine.kind].booster) return [engine];
  const seen = reachable(parts, engine, (n) => PARTS[n.kind].separator || PARTS[n.kind].booster);
  const tanks = parts.filter((p) => seen.has(p.id) && (PARTS[p.kind].tank || (p.id === engine.id && PARTS[p.kind].fuel > 0)));
  const ecx = engine.x + PARTS[engine.kind].w / 2;
  const ecy = engine.y + PARTS[engine.kind].h / 2;
  tanks.sort((a, b) => {
    const da = (a.x - ecx) ** 2 + (a.y - ecy) ** 2;
    const db = (b.x - ecx) ** 2 + (b.y - ecy) ** 2;
    return da - db;
  });
  return tanks;
}

export function mirrorX(kind: PartKind, x: number): number {
  return GRID_MIRROR * 2 - x - PARTS[kind].w;
}

const GRID_MIRROR = 6;

export function splitLowestStage<T extends GridPart>(parts: T[]): { kept: T[]; dropped: T[] } | null {
  const boosters = parts.filter((p) => PARTS[p.kind].booster);
  if (boosters.length) {
    const core = parts.filter((p) => !PARTS[p.kind].booster);
    const pod = core.find((p) => PARTS[p.kind].pod);
    if (pod) {
      const keptIds = reachable(core, pod);
      const dropped = parts.filter((p) => !keptIds.has(p.id));
      if (dropped.some((p) => PARTS[p.kind].booster) && dropped.every((p) => !keptIds.has(p.id))) {
        return { kept: parts.filter((p) => keptIds.has(p.id)), dropped };
      }
    }
  }
  const seps = parts
    .filter((p) => PARTS[p.kind].separator)
    .slice()
    .sort((a, b) => b.y - a.y || b.x - a.x);
  for (const sep of seps) {
    const without = parts.filter((p) => p.id !== sep.id);
    const pod = without.find((p) => PARTS[p.kind].pod);
    if (!pod) continue;
    const keptIds = reachable(without, pod);
    const dropped = parts.filter((p) => !keptIds.has(p.id));
    if (dropped.some((p) => p.id !== sep.id)) {
      return { kept: parts.filter((p) => keptIds.has(p.id)), dropped };
    }
  }
  return null;
}

export function stageGroups<T extends GridPart>(parts: T[]): T[][] {
  const groups: T[][] = [];
  let rest = parts.slice();
  for (let guard = 0; guard < 8 && rest.length; guard++) {
    const split = splitLowestStage(rest);
    if (!split) {
      groups.push(rest);
      break;
    }
    groups.push(split.dropped);
    rest = split.kept;
  }
  return groups;
}

export interface StageSummary {
  index: number;
  fuel: number;
  capacity: number;
  mass: number;
  thrust: number;
  partIds: string[];
}

export interface AssemblyReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
  disconnected: string[];
  solidBlocked: string[];
  mass: number;
  fuel: number;
  capacity: number;
  thrust: number;
  twr: number;
  deltaV: number;
  stages: StageSummary[];
}

function easyFactor(easy: boolean): number {
  return easy ? 1.12 : 1;
}

export function analyze(parts: Placed[], easy: boolean): AssemblyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const disconnected: string[] = [];
  const solidBlocked: string[] = [];

  const pods = parts.filter((p) => PARTS[p.kind].pod);
  if (pods.length === 0) errors.push("先放一个指挥舱");
  if (pods.length > 1) errors.push("指挥舱只能有一个");

  const seen = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (overlaps(parts[i]!, parts[j]!)) seen.add(`${parts[i]!.id}:${parts[j]!.id}`);
    }
  }
  if (seen.size) errors.push("有零件叠在一起");

  let outside = false;
  for (const p of parts) {
    const d = PARTS[p.kind];
    if (p.x < 0 || p.y < 0 || p.x + d.w > 12 || p.y + d.h > 22) outside = true;
  }
  if (outside) errors.push("有零件出了工作台");

  if (pods.length === 1) {
    const ids = reachable(parts, pods[0]!);
    for (const p of parts) if (!ids.has(p.id)) disconnected.push(p.id);
    if (disconnected.length) errors.push("有零件还没连上指挥舱");
  }

  const engines = parts.filter((p) => PARTS[p.kind].engine);
  const clear = engines.filter((e) => nozzleBlock(parts, e) === "clear");
  for (const e of engines) {
    if (nozzleBlock(parts, e) === "solid") solidBlocked.push(e.id);
  }
  if (solidBlocked.length) errors.push("有引擎喷口被挡住了");
  if (clear.length === 0) errors.push("最底下需要一个喷口露出来的引擎");

  const factor = easyFactor(easy);
  let mass = 0;
  let fuel = 0;
  let capacity = 0;
  for (const p of parts) {
    const d = PARTS[p.kind];
    mass += d.dry + d.fuel;
    if (d.fuel > 0) {
      fuel += d.fuel;
      capacity += d.fuel;
    }
  }

  const tankIds = new Set<string>();
  let thrust = 0;
  let flow = 0;
  for (const e of clear) {
    const d = PARTS[e.kind];
    const t = d.thrust * factor;
    thrust += t;
    if (d.isp > 0) flow += t / (d.isp * G0);
    for (const tank of fuelTanks(parts, e)) tankIds.add(tank.id);
  }
  let burnable = 0;
  for (const id of tankIds) {
    const p = parts.find((x) => x.id === id);
    if (p) burnable += PARTS[p.kind].fuel;
  }
  if (clear.length && burnable <= 0) errors.push("底下的引擎没有燃料。油箱要和它装在同一级");

  const twr = mass > 0 ? thrust / (mass * PLANET.g) : 0;
  if (clear.length && burnable > 0 && twr < 1) errors.push("太重了，飞不起来。少装点油，或换大引擎");

  const mDry = mass - burnable;
  const deltaV = flow > 0 && mDry > 1 && burnable > 0 ? (thrust / flow) * Math.log(mass / mDry) : 0;

  if (!parts.some((p) => PARTS[p.kind].chute)) warnings.push("还没有降落伞");
  const boosts = parts.filter((p) => PARTS[p.kind].booster);
  if (boosts.length === 1) warnings.push("只装了一边助推器，飞行时要反向转一转");
  if (engines.some((e) => nozzleBlock(parts, e) === "separator")) {
    notes.push("分离环上面的引擎，要等分离后才点火");
  }

  const stages: StageSummary[] = stageGroups(parts).map((group, i) => {
    let sf = 0;
    let sc = 0;
    let sm = 0;
    let st = 0;
    for (const p of group) {
      const d = PARTS[p.kind];
      sm += d.dry + d.fuel;
      sc += d.fuel;
      sf += d.fuel;
      if (d.engine && nozzleBlock(parts, p) !== "solid") st += d.thrust * factor;
    }
    return { index: i + 1, fuel: sf, capacity: sc, mass: sm, thrust: st, partIds: group.map((p) => p.id) };
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notes,
    disconnected,
    solidBlocked,
    mass,
    fuel,
    capacity,
    thrust,
    twr,
    deltaV,
    stages,
  };
}

export function placementIssue(
  parts: Placed[],
  kind: PartKind,
  x: number,
  y: number,
  ignoreId: string | undefined,
  mode: "new" | "move",
): string | null {
  const d = PARTS[kind];
  if (x < 0 || y < 0 || x + d.w > 12 || y + d.h > 22) return "这里放不下";
  const ghost: Placed = { id: ignoreId ?? "__ghost__", kind, x, y };
  const others = parts.filter((p) => p.id !== ignoreId);
  if (others.some((p) => overlaps(p, ghost))) return "这里已经有零件了";
  if (kind === "pod" && others.some((p) => PARTS[p.kind].pod)) return "已经有指挥舱了";
  if (mode === "new") {
    if (others.length === 0 && kind !== "pod") return "先放指挥舱";
    if (others.length > 0 && !others.some((p) => partsTouch(p, ghost))) return "要挨着已经拼上的零件";
  }
  return null;
}
