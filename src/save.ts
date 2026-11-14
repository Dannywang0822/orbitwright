import { overlaps } from "./sim/assembly.ts";
import { inBounds, PARTS, type PartKind, type Placed } from "./sim/parts.ts";

export interface Progress {
  sky: boolean;
  home: boolean;
  orbit: boolean;
}

export interface NamedDesign {
  id: string;
  name: string;
  parts: Placed[];
}

export interface SaveData {
  v: 1;
  easy: boolean;
  sound: boolean;
  sas: boolean;
  tutorial: boolean;
  missions: Progress;
  parts: Placed[];
  /** Named blueprints. Older saves omit this; the key stays taikong-gongfang-v1. */
  designs?: NamedDesign[];
}

/** Load Menu row. Each button is 60 px tall in the reference layout. Import reads a local file only. */
export const LOAD_MENU_BUTTON_H = 60;
export const LOAD_MENU_BUTTONS = ["返回", "删除", "改名", "导入", "打开", "导出", "保存当前"] as const;

const KEY = "taikong-gongfang-v1";

export function defaultSave(): SaveData {
  return {
    v: 1,
    easy: true,
    sound: false,
    sas: true,
    tutorial: false,
    missions: { sky: false, home: false, orbit: false },
    parts: [],
    designs: [],
  };
}

let designSeq = 1;

function parseDesigns(raw: unknown): NamedDesign[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedDesign[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<NamedDesign>;
    if (typeof rec.id !== "string" || !rec.id || ids.has(rec.id)) continue;
    if (typeof rec.name !== "string") continue;
    const parts = sanitizeParts(rec.parts);
    if (!parts) continue;
    ids.add(rec.id);
    out.push({ id: rec.id, name: rec.name.trim().slice(0, 24) || "未命名", parts });
  }
  return out;
}

export function rememberDesign(data: SaveData, name: string, parts: Placed[]): SaveData {
  const clean = sanitizeParts(parts);
  if (!clean || clean.length === 0) return data;
  const id = `design-${designSeq++}`;
  const title = name.trim().slice(0, 24) || "未命名";
  const designs = [...(data.designs ?? []), { id, name: title, parts: clean }].slice(-12);
  return { ...data, designs };
}

export function forgetDesign(data: SaveData, id: string): SaveData {
  return { ...data, designs: (data.designs ?? []).filter((d) => d.id !== id) };
}

export function renameDesign(data: SaveData, id: string, name: string): SaveData {
  const title = name.trim().slice(0, 24);
  if (!title) return data;
  return {
    ...data,
    designs: (data.designs ?? []).map((d) => (d.id === id ? { ...d, name: title } : d)),
  };
}

export function findDesign(data: SaveData, id: string): NamedDesign | null {
  return (data.designs ?? []).find((d) => d.id === id) ?? null;
}

export interface DesignFile {
  v: 1;
  designs: NamedDesign[];
}

/** Local export. Same shape the importer accepts. No network. */
export function exportDesigns(data: SaveData): string {
  const file: DesignFile = { v: 1, designs: data.designs ?? [] };
  return JSON.stringify(file);
}

export type ImportResult = { ok: true; data: SaveData; added: number } | { ok: false; reason: string };

/**
 * Read a local design file into the existing save.
 * A bad file returns an error and does not change `data`.
 */
export function importDesigns(data: SaveData, text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "这不是一份设计文件" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "设计文件里没有图纸列表" };
  }
  const rec = raw as { v?: unknown; designs?: unknown };
  if (rec.v !== 1 || !Array.isArray(rec.designs)) {
    return { ok: false, reason: "设计文件格式不对" };
  }
  const incoming = parseDesigns(rec.designs);
  if (incoming.length !== rec.designs.length) {
    return { ok: false, reason: "图纸里的零件读不出来" };
  }
  const have = new Set((data.designs ?? []).map((d) => d.id));
  const merged = [...(data.designs ?? [])];
  let added = 0;
  for (const design of incoming) {
    let id = design.id;
    if (have.has(id)) id = `design-${designSeq++}`;
    have.add(id);
    merged.push({ ...design, id });
    added += 1;
  }
  return { ok: true, data: { ...data, designs: merged.slice(-12) }, added };
}

export function sanitizeParts(raw: unknown): Placed[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Placed[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Partial<Placed>;
    const kind = rec.kind as PartKind;
    if (!kind || !(kind in PARTS)) return null;
    if (typeof rec.id !== "string" || !rec.id || ids.has(rec.id)) return null;
    const x = rec.x;
    const y = rec.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (!inBounds(kind, x, y)) return null;
    ids.add(rec.id);
    out.push({ id: rec.id, kind, x, y });
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (overlaps(out[i]!, out[j]!)) return null;
    }
  }
  return out;
}

export function parseSave(text: string | null): SaveData {
  const base = defaultSave();
  if (!text) return base;
  try {
    const raw = JSON.parse(text) as Partial<SaveData>;
    if (raw.v !== 1) return base;
    const parts = sanitizeParts(raw.parts);
    return {
      v: 1,
      easy: raw.easy !== false,
      sound: raw.sound === true,
      sas: raw.sas !== false,
      tutorial: raw.tutorial === true,
      missions: {
        sky: raw.missions?.sky === true,
        home: raw.missions?.home === true,
        orbit: raw.missions?.orbit === true,
      },
      parts: parts ?? [],
      designs: parseDesigns((raw as { designs?: unknown }).designs),
    };
  } catch {
    return base;
  }
}

export function loadSave(): SaveData {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode or full storage: keep playing in memory */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
