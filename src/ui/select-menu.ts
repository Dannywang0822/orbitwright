/** UI-31. Original labels: Revert 30s, Revert To Build, Resume Game. */
export const FAILURE_MENU = [
  { id: "revert-30", label: "回到 30 秒前" },
  { id: "revert-build", label: "回到组装" },
  { id: "resume", label: "继续" },
] as const;

export type SelectTarget = "moon" | "planet" | "ship";

/** UI-27. Each row is 250×60 in the 800×1400 reference, then scaled. */
export const SELECT_ROWS = [
  { id: "navigate", label: "飞向它", w: 250, h: 60 },
  { id: "focus", label: "聚焦", w: 250, h: 60 },
  { id: "switch", label: "切换", w: 250, h: 60 },
  { id: "rename", label: "改名", w: 250, h: 60 },
  { id: "recover", label: "回收", w: 250, h: 60 },
] as const;

export const TIMEWARP_TO = { id: "timewarp-to", label: "加速到这里", w: 300, h: 60 };

export function nextTarget(current: SelectTarget): SelectTarget {
  if (current === "moon") return "planet";
  if (current === "planet") return "ship";
  return "moon";
}

/** UI-32. The original part menu is 300×408. */
export const PART_MENU = { w: 300, h: 408 };

export type PartMenuCard =
  | { mode: "engine"; id: string; name: string; on: boolean }
  | { mode: "chute"; id: string; name: string }
  | { mode: "info"; id: string; name: string; mass: number };

export function partMenuCard(input: {
  id: string;
  name: string;
  mass: number;
  engine: boolean;
  chute: boolean;
  engineOn: boolean;
}): PartMenuCard {
  if (input.engine) return { mode: "engine", id: input.id, name: input.name, on: input.engineOn };
  if (input.chute) return { mode: "chute", id: input.id, name: input.name };
  return { mode: "info", id: input.id, name: input.name, mass: input.mass };
}

export function targetTitle(target: SelectTarget, aliases: Partial<Record<SelectTarget, string>>): string {
  return aliases[target] || (target === "moon" ? "月芽" : target === "planet" ? "青芽星" : "火箭");
}
