import { mirrorX, overlaps } from "./assembly.ts";
import { inBounds, type Placed } from "./parts.ts";

/** Undo and redo for the build grid. Cap matches the previous 40-step stack. */
export class BlueprintLog {
  private past: string[] = [];
  private future: string[] = [];

  note(parts: Placed[]): void {
    this.past.push(JSON.stringify(parts));
    if (this.past.length > 40) this.past.shift();
    this.future = [];
  }

  undo(parts: Placed[]): Placed[] | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(JSON.stringify(parts));
    return JSON.parse(prev) as Placed[];
  }

  redo(parts: Placed[]): Placed[] | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(JSON.stringify(parts));
    return JSON.parse(next) as Placed[];
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

/** Mirror every part across the build center. Rejects a flip that leaves the grid or overlaps. */
export function flipParts(parts: Placed[]): Placed[] | null {
  const next = parts.map((part) => ({ ...part, x: mirrorX(part.kind, part.x) }));
  if (next.some((part) => !inBounds(part.kind, part.x, part.y))) return null;
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      if (overlaps(next[i]!, next[j]!)) return null;
    }
  }
  return next;
}
