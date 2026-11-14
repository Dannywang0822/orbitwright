import type { Art } from "./art.ts";
import { nozzleBlock } from "../sim/assembly.ts";
import { nozzleWorld, partWorld, type FlightState, type SimPart, type Vessel } from "../sim/flight.ts";
import { CELL_H, CELL_W, GRID_COLS, GRID_ROWS, PLANET, type Vec } from "../sim/math.ts";
import { analyzeOrbit } from "../sim/orbit.ts";
import { MOON, isEncounter, moonAt, type Approach } from "../sim/world.ts";
import { PARTS, type PartKind, type Placed } from "../sim/parts.ts";
import { canopyScale } from "../ui/p2.ts";
import { VELOCITY_ARROW } from "../ui/measured.ts";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  sprite: number;
  additive: boolean;
}

export function worldToScreen(p: Vec, cam: Camera, w: number, h: number): Vec {
  return {
    x: (p.x - cam.x) * cam.zoom + w / 2,
    y: (cam.y - p.y) * cam.zoom + h / 2,
  };
}

/** High-altitude sky color already used above the air. Map mode fills with it. Not a sampled map swatch. */
export const MAP_SKY = "#070b16";

export function drawMapSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = MAP_SKY;
  ctx.fillRect(0, 0, w, h);
}

export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, alt: number): void {
  const t = Math.max(0, Math.min(1, alt / (PLANET.atmHeight * 1.3)));
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const top = mix("#3f86d0", "#070b16", t);
  const mid = mix("#b7def6", "#1a2744", t);
  const bot = mix("#e7f2f8", "#12182c", t);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function hex(s: string): [number, number, number] {
  const n = s.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera, time: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 80; i++) {
    const bx = ((i * 97) % 1000) / 1000;
    const by = ((i * 57) % 1000) / 1000;
    const parallax = 0.04 + (i % 5) * 0.01;
    const x = (bx * w * 1.4 - cam.x * parallax + time * (2 + (i % 3))) % (w + 20);
    const y = (by * h + ((cam.y * parallax) % h) + h) % h;
    const s = i % 7 === 0 ? 2.2 : 1.2;
    ctx.globalAlpha = 0.35 + (i % 5) * 0.1;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

export function drawPlanet(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const c = worldToScreen({ x: 0, y: 0 }, cam, w, h);
  const rPx = PLANET.radius * cam.zoom;
  if (rPx < Math.max(w, h) * 5 && rPx > 4) {
    const atm = (PLANET.radius + PLANET.atmHeight) * cam.zoom;
    ctx.beginPath();
    ctx.arc(c.x, c.y, atm, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(186, 236, 214, 0.28)";
    ctx.lineWidth = Math.max(6, PLANET.atmHeight * cam.zoom * 0.35);
    ctx.stroke();
    const g = ctx.createRadialGradient(c.x - rPx * 0.28, c.y - rPx * 0.32, rPx * 0.15, c.x, c.y, rPx);
    g.addColorStop(0, "#e7f6b8");
    g.addColorStop(0.42, "#7dcec4");
    g.addColorStop(1, "#2c6d68");
    ctx.beginPath();
    ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
    ctx.clip();
    blob(ctx, c.x - rPx * 0.2, c.y - rPx * 0.35, rPx * 0.28, "#d5ef8a");
    blob(ctx, c.x + rPx * 0.25, c.y + rPx * 0.1, rPx * 0.22, "#9ed56a");
    blob(ctx, c.x - rPx * 0.05, c.y + rPx * 0.28, rPx * 0.18, "#efd48a");
    ctx.restore();
    return;
  }
  ctx.beginPath();
  const steps = 56;
  for (let i = 0; i <= steps; i++) {
    const sx = (i / steps) * w;
    const wx = cam.x + (sx - w / 2) / cam.zoom;
    let sy = h + 20;
    if (Math.abs(wx) < PLANET.radius) {
      const wy = Math.sqrt(PLANET.radius * PLANET.radius - wx * wx);
      sy = (cam.y - wy) * cam.zoom + h / 2;
    }
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.lineTo(w, h + 40);
  ctx.lineTo(0, h + 40);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "#d5d8cc");
  g.addColorStop(0.28, "#9aa092");
  g.addColorStop(1, "#667064");
  ctx.fillStyle = g;
  ctx.fill();
  drawClouds(ctx, cam, w, h);
  drawPad(ctx, cam, w, h);
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.ellipse(x, y, r, r * 0.72, 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const clouds = [
    { a: -0.012, alt: 420, s: 70 },
    { a: 0.018, alt: 780, s: 54 },
    { a: 0.004, alt: 1300, s: 46 },
    { a: -0.03, alt: 210, s: 40 },
  ];
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  for (const cl of clouds) {
    const rr = PLANET.radius + cl.alt;
    const p = worldToScreen({ x: Math.sin(cl.a) * rr, y: Math.cos(cl.a) * rr }, cam, w, h);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, cl.s, cl.s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPad(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const base = worldToScreen({ x: 0, y: PLANET.radius }, cam, w, h);
  if (base.y < -40 || base.y > h + 40) return;
  ctx.fillStyle = "#8d948c";
  ctx.fillRect(base.x - 36, base.y - 3, 72, 6);
}

export function drawVessel(
  ctx: CanvasRenderingContext2D,
  vessel: Vessel,
  chuteOpen: boolean,
  cam: Camera,
  w: number,
  h: number,
  art: Art,
  time: number,
  alpha = 1,
  chuteStage = 0,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const p of vessel.parts) {
    if ((vessel.engineOut[p.id] ?? 0) > 0.02) drawFlame(ctx, vessel, p, cam, w, h, art, time);
  }
  const ordered = [...vessel.parts].sort((a, b) => drawOrder(a.kind) - drawOrder(b.kind));
  for (const p of ordered) drawSimPart(ctx, vessel, p, cam, w, h, art);
  const scale = canopyScale(chuteStage, chuteOpen);
  if (scale) drawCanopy(ctx, vessel, cam, w, h, scale);
  ctx.restore();
}

function drawSimPart(
  ctx: CanvasRenderingContext2D,
  vessel: Vessel,
  p: SimPart,
  cam: Camera,
  w: number,
  h: number,
  art: Art,
): void {
  const scr = worldToScreen(partWorld(vessel, p), cam, w, h);
  ctx.save();
  ctx.translate(scr.x, scr.y);
  ctx.rotate(vessel.angle);
  paintPart(ctx, p.kind, p.halfW * 2 * cam.zoom, p.halfH * 2 * cam.zoom, art, neighborLink(vessel.parts, p), nozzleBlock(vessel.parts, p) === "clear");
  ctx.restore();
}

function drawFlame(
  ctx: CanvasRenderingContext2D,
  vessel: Vessel,
  p: SimPart,
  cam: Camera,
  w: number,
  h: number,
  _art: Art,
  time: number,
): void {
  const power = vessel.engineOut[p.id] ?? 0;
  if (power < 0.02) return;
  const scr = worldToScreen(nozzleWorld(vessel, p), cam, w, h);
  const flicker = 0.86 + 0.14 * Math.sin(time * 36 + p.localY);
  const fh = (8 + 46 * power) * flicker * Math.max(0.65, cam.zoom / 12);
  const fw = Math.max(3, p.halfW * cam.zoom * (0.28 + 0.45 * power));
  ctx.save();
  ctx.translate(scr.x, scr.y);
  ctx.rotate(vessel.angle);
  const glow = ctx.createLinearGradient(0, 0, 0, fh);
  glow.addColorStop(0, "rgba(255,244,220,0.95)");
  glow.addColorStop(0.35, "rgba(255,150,60,0.85)");
  glow.addColorStop(1, "rgba(255,80,30,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.moveTo(-fw * 0.35, 0);
  ctx.lineTo(fw * 0.35, 0);
  ctx.lineTo(fw * 0.15, fh);
  ctx.lineTo(-fw * 0.15, fh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCanopy(ctx: CanvasRenderingContext2D, vessel: Vessel, cam: Camera, w: number, h: number, scale: number): void {
  const pod = vessel.parts.find((p) => PARTS[p.kind].pod);
  if (!pod) return;
  const scr = worldToScreen(partWorld(vessel, pod), cam, w, h);
  const nx = Math.sin(vessel.angle);
  const ny = -Math.cos(vessel.angle);
  const dist = pod.halfH * cam.zoom + 36 * scale;
  ctx.save();
  ctx.translate(scr.x + nx * dist, scr.y + ny * dist);
  ctx.rotate(vessel.angle);
  ctx.fillStyle = "#ff8a5b";
  ctx.beginPath();
  ctx.ellipse(0, -8 * scale, 34 * scale, 22 * scale, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,246,234,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-20 * scale, -6 * scale);
  ctx.lineTo(0, 28 * scale);
  ctx.lineTo(20 * scale, -6 * scale);
  ctx.stroke();
  ctx.restore();
}

function metalFill(ctx: CanvasRenderingContext2D, x0: number, x1: number, tone: "steel" | "heat" | "gold"): void {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const stops = tone === "heat"
    ? [[0, "#6a5348"], [0.2, "#f0d2bf"], [0.48, "#c48b72"], [0.78, "#e7c3ae"], [1, "#5a463e"]]
    : tone === "gold"
      ? [[0, "#8a6a28"], [0.22, "#f3dd9a"], [0.5, "#c9a04a"], [0.8, "#edd48a"], [1, "#6e5420"]]
      : [[0, "#7d8792"], [0.14, "#f4f7fa"], [0.4, "#c5ced6"], [0.62, "#e6ebf0"], [0.86, "#aeb6bf"], [1, "#5e6771"]];
  for (const [p, c] of stops) g.addColorStop(p as number, c as string);
  ctx.fillStyle = g;
}

function seam(ctx: CanvasRenderingContext2D, y: number, half: number): void {
  ctx.strokeStyle = "rgba(40, 48, 58, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-half, y);
  ctx.lineTo(half, y);
  ctx.stroke();
}

type LinkSide = "left" | "right" | "both" | "none";

function neighborLink(parts: { kind: PartKind; x: number; y: number }[], p: { kind: PartKind; x: number; y: number }): LinkSide {
  if (p.kind !== "booster") return "none";
  const d = PARTS[p.kind];
  const overlapsY = (q: { kind: PartKind; y: number }): boolean => {
    const qd = PARTS[q.kind];
    return q.y < p.y + d.h && p.y < q.y + qd.h;
  };
  const right = parts.some((q) => q !== p && !PARTS[q.kind].booster && q.x === p.x + d.w && overlapsY(q));
  const left = parts.some((q) => q !== p && !PARTS[q.kind].booster && q.x + PARTS[q.kind].w === p.x && overlapsY(q));
  if (left && right) return "both";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

function drawOrder(kind: PartKind): number {
  if (kind === "engine_s" || kind === "engine_l") return 2;
  if (kind === "booster") return 1;
  return 0;
}

export function paintPart(
  ctx: CanvasRenderingContext2D,
  kind: PartKind,
  w: number,
  h: number,
  _art: Art,
  link: LinkSide = "none",
  nozzleClear = true,
): void {
  const tube = kind === "booster" ? w * 0.92 : w * 0.46;
  const bw = kind === "pod" ? w * 0.5 : kind === "legs" ? w * 0.5 : tube;
  const left = -bw / 2;
  const overlap = Math.max(2, h * 0.045);
  ctx.lineJoin = "round";
  if (kind === "shield") {
    ctx.fillStyle = "#c4552a";
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, -h * 0.15);
    ctx.quadraticCurveTo(0, h * 0.85, w * 0.42, -h * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = Math.max(1, h * 0.08);
    ctx.stroke();
    return;
  }
  if (kind === "pod") {
    metalFill(ctx, left, left + bw, "steel");
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.quadraticCurveTo(bw * 0.62, -h * 0.28, bw / 2, -h * 0.02);
    ctx.lineTo(bw / 2, h / 2 + overlap);
    ctx.lineTo(-bw / 2, h / 2 + overlap);
    ctx.lineTo(-bw / 2, -h * 0.02);
    ctx.quadraticCurveTo(-bw * 0.62, -h * 0.28, 0, -h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#243038";
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.02, bw * 0.1, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    seam(ctx, h * 0.22, bw / 2);
    return;
  }
  if (kind === "chute") {
    metalFill(ctx, left, left + bw, "steel");
    ctx.fillRect(left, -h / 2 - overlap * 0.4, bw, h + overlap * 0.8);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(left, -h * 0.12, bw, Math.max(2, h * 0.28));
    return;
  }
  if (kind === "tank_s" || kind === "tank_m" || kind === "tank_l") {
    metalFill(ctx, left, left + bw, "steel");
    ctx.fillRect(left, -h / 2 - overlap, bw, h + overlap * 2);
    seam(ctx, -h * 0.22, bw / 2);
    seam(ctx, h * 0.22, bw / 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(left + bw * 0.16, -h / 2, Math.max(2, bw * 0.08), h);
    return;
  }
  if (kind === "engine_s" || kind === "engine_l") {
    metalFill(ctx, left, left + bw, "steel");
    ctx.fillRect(left, -h / 2 - overlap, bw, h + overlap * 2);
    if (!nozzleClear) {
      ctx.fillStyle = "#1c2126";
      ctx.fillRect(left, -h * 0.05, bw, h / 2 + overlap + h * 0.05);
      ctx.strokeStyle = "rgba(210, 214, 218, 0.55)";
      ctx.lineWidth = Math.max(1, bw * 0.035);
      for (const x of [-bw * 0.28, 0, bw * 0.28]) {
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.02);
        ctx.lineTo(x, h * 0.42);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-bw / 2, h * 0.18);
      ctx.lineTo(bw / 2, h * 0.18);
      ctx.stroke();
      return;
    }
    const skirt = h * 0.05;
    const exitY = h / 2 + overlap * 0.15;
    const lip = bw * 0.9;
    const bell = ctx.createLinearGradient(-lip / 2, 0, lip / 2, 0);
    bell.addColorStop(0, "#14171b");
    bell.addColorStop(0.35, "#3a4148");
    bell.addColorStop(0.7, "#22272c");
    bell.addColorStop(1, "#0e1013");
    ctx.fillStyle = bell;
    ctx.beginPath();
    ctx.moveTo(-bw / 2, skirt);
    ctx.quadraticCurveTo(-lip * 0.55, h * 0.22, -lip / 2, exitY);
    ctx.lineTo(lip / 2, exitY);
    ctx.quadraticCurveTo(lip * 0.55, h * 0.22, bw / 2, skirt);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(186, 192, 198, 0.45)";
    ctx.lineWidth = Math.max(1, h * 0.025);
    for (const t of [0.28, 0.52, 0.76]) {
      const y = skirt + (exitY - skirt) * t;
      const half = bw / 2 + (lip / 2 - bw / 2) * t;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#070808";
    ctx.beginPath();
    ctx.ellipse(0, exitY - Math.max(1.5, h * 0.03), lip * 0.28, Math.max(1.8, h * 0.055), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (kind === "separator") {
    ctx.fillStyle = "#161b20";
    ctx.fillRect(left, -h / 2 - overlap, bw, h + overlap * 2);
    ctx.strokeStyle = "rgba(214, 218, 222, 0.7)";
    ctx.lineWidth = Math.max(1, bw * 0.04);
    for (const x of [-bw * 0.32, -bw * 0.08, bw * 0.16]) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#c6a15a";
    ctx.lineWidth = Math.max(1.5, h * 0.12);
    ctx.beginPath();
    ctx.moveTo(-bw / 2, 0);
    ctx.lineTo(bw / 2, 0);
    ctx.stroke();
    return;
  }
  if (kind === "legs") {
    ctx.strokeStyle = "#8b939c";
    ctx.lineWidth = Math.max(2, w * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w * 0.28, h / 2);
    ctx.moveTo(0, -h * 0.1);
    ctx.lineTo(-w * 0.05, h * 0.35);
    ctx.stroke();
    ctx.fillStyle = "#5c656e";
    ctx.fillRect(w * 0.18, h / 2 - 3, w * 0.22, 4);
    return;
  }
  const half = bw / 2;
  const nose = h * 0.2;
  const bell = h * 0.18;
  metalFill(ctx, -half, half, "steel");
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(half * 0.72, -h / 2 + nose * 0.55);
  ctx.lineTo(half, -h / 2 + nose);
  ctx.lineTo(half, h / 2 - bell);
  ctx.lineTo(-half, h / 2 - bell);
  ctx.lineTo(-half, -h / 2 + nose);
  ctx.lineTo(-half * 0.72, -h / 2 + nose * 0.55);
  ctx.closePath();
  ctx.fill();
  seam(ctx, -h * 0.12, half);
  seam(ctx, h * 0.08, half);
  ctx.fillStyle = "#243038";
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 + nose * 0.15);
  ctx.lineTo(half * 0.16, -h / 2 + nose * 0.55);
  ctx.lineTo(-half * 0.16, -h / 2 + nose * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1a1e22";
  ctx.beginPath();
  ctx.moveTo(-half * 0.78, h / 2 - bell);
  ctx.quadraticCurveTo(-half * 0.7, h * 0.42, -half * 0.9, h / 2);
  ctx.lineTo(half * 0.9, h / 2);
  ctx.quadraticCurveTo(half * 0.7, h * 0.42, half * 0.78, h / 2 - bell);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(186, 192, 198, 0.4)";
  ctx.lineWidth = Math.max(1, h * 0.012);
  ctx.beginPath();
  ctx.moveTo(-half * 0.84, h * 0.34);
  ctx.lineTo(half * 0.84, h * 0.34);
  ctx.stroke();
  const tab = (dir: number): void => {
    const x0 = dir * half * 0.72;
    const x1 = dir * (w * 0.5 + w * 0.42);
    ctx.fillStyle = "#9aa3ab";
    ctx.strokeStyle = "#4c545c";
    ctx.lineWidth = 1;
    const tabH = Math.max(3, h * 0.045);
    const drawAt = (top: number): void => {
      ctx.fillRect(Math.min(x0, x1), top, Math.abs(x1 - x0), tabH);
      ctx.strokeRect(Math.min(x0, x1), top, Math.abs(x1 - x0), tabH);
    };
    drawAt(-h * 0.16);
    drawAt(h * 0.08);
  };
  if (link === "left" || link === "both") tab(-1);
  if (link === "right" || link === "both") tab(1);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Closed ellipse is a solid line. Open paths stay dashed. The coast prediction is always dashed. */
export function orbitDash(kind: "ellipse" | "hyperbola" | "radial"): number[] {
  return kind === "ellipse" ? [] : [6, 6];
}

export const PREDICTION_DASH = [6, 6];

export function drawOrbit(ctx: CanvasRenderingContext2D, state: FlightState, cam: Camera, w: number, h: number): void {
  const pts = state.orbit.points;
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = worldToScreen(p, cam, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.strokeStyle = "rgba(255, 214, 120, 0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash(orbitDash(state.orbit.kind));
  ctx.stroke();
  ctx.setLineDash([]);
  if (state.orbit.kind === "radial") return;
  mark(ctx, state.orbit.apoPoint, "远", cam, w, h);
  mark(ctx, state.orbit.periPoint, "近", cam, w, h);
}

function mark(ctx: CanvasRenderingContext2D, p: Vec | null, label: string, cam: Camera, w: number, h: number): void {
  if (!p) return;
  const s = worldToScreen(p, cam, w, h);
  ctx.fillStyle = "#fff6ea";
  ctx.beginPath();
  ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff6ea";
  ctx.font = "14px ui-sans-serif, sans-serif";
  ctx.fillText(label, s.x + 8, s.y - 6);
}

export function drawParticles(ctx: CanvasRenderingContext2D, parts: Particle[], cam: Camera, w: number, h: number, _art: Art): void {
  for (const p of parts) {
    const s = worldToScreen(p, cam, w, h);
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    if (p.additive) ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = p.sprite === 9 ? "rgba(170,166,158,0.55)" : "#ffd27a";
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1.5, p.size / 8), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawWorkshop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#3e6298";
  ctx.fillRect(0, 0, w, h);
}

export interface GridGeom {
  cellW: number;
  cellH: number;
  originX: number;
  originY: number;
}

export function gridGeom(
  w: number,
  h: number,
  insets: { top: number; bottom: number; left: number; right: number },
  scale = 1,
): GridGeom {
  const aw = Math.max(40, w - insets.left - insets.right);
  const ah = Math.max(40, h - insets.top - insets.bottom);
  const aspect = CELL_H / CELL_W;
  const fit = Math.min(aw / 7.2, ah / (16 * aspect));
  const cellW = Math.max(12, Math.min(36, Math.floor(fit * scale)));
  const cellH = cellW * aspect;
  return {
    cellW,
    cellH,
    originX: insets.left + aw / 2 - 6 * cellW,
    originY: Math.max(insets.top + 6, Math.round(h * 0.06)),
  };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  geom: GridGeom,
  parts: Placed[],
  art: Art,
  selectedId: string | null,
  badIds: Set<string>,
  ghost: { kind: PartKind; x: number; y: number; ok: boolean } | null,
  w: number,
  h: number,
): void {
  const { cellW, cellH, originX, originY } = geom;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
  ctx.lineWidth = 1;
  const stepX = cellW / 2;
  const stepY = cellH / 2;
  const x0 = originX - Math.ceil(originX / stepX) * stepX;
  const y0 = originY - Math.ceil(originY / stepY) * stepY;
  for (let x = x0; x <= w + stepX; x += stepX) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = y0; y <= h + stepY; y += stepY) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const ordered = [...parts].sort((a, b) => drawOrder(a.kind) - drawOrder(b.kind));
  const strokePart = (kind: PartKind, slotW: number, slotH: number): void => {
    const bw = kind === "pod" ? slotW * 0.5 : kind === "booster" ? slotW * 0.92 : kind === "legs" ? slotW * 0.5 : slotW * 0.46;
    roundRect(ctx, -bw / 2, -slotH / 2, bw, slotH, 6);
    ctx.stroke();
  };
  for (const p of ordered) {
    const d = PARTS[p.kind];
    ctx.save();
    ctx.translate(originX + (p.x + d.w / 2) * cellW, originY + (p.y + d.h / 2) * cellH);
    paintPart(ctx, p.kind, d.w * cellW, d.h * cellH, art, neighborLink(parts, p), nozzleBlock(parts, p) === "clear");
    if (p.id === selectedId || badIds.has(p.id)) {
      ctx.strokeStyle = p.id === selectedId ? "#1f8f86" : "#d24b45";
      ctx.lineWidth = 3;
      strokePart(p.kind, d.w * cellW, d.h * cellH);
    }
    ctx.restore();
  }
  if (ghost) {
    const d = PARTS[ghost.kind];
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(originX + (ghost.x + d.w / 2) * cellW, originY + (ghost.y + d.h / 2) * cellH);
    paintPart(ctx, ghost.kind, d.w * cellW, d.h * cellH, art, neighborLink(parts, ghost), nozzleBlock([...parts, { ...ghost, id: "ghost" }], { ...ghost, id: "ghost" }) === "clear");
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ghost.ok ? "#1f8a4c" : "#d24b45";
    ctx.lineWidth = 3;
    strokePart(ghost.kind, d.w * cellW, d.h * cellH);
    ctx.restore();
  }
}

export function cellFromPoint(px: number, py: number, geom: GridGeom): { x: number; y: number } | null {
  const x = Math.floor((px - geom.originX) / geom.cellW);
  const y = Math.floor((py - geom.originY) / geom.cellH);
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return null;
  return { x, y };
}

export function mapCamera(
  w: number,
  h: number,
  userZoom = 12,
  center: { x: number; y: number } = { x: 0, y: 0 },
): Camera {
  const zoom = (Math.min(w, h) / (PLANET.radius * 2.6)) * (userZoom / 12);
  return { x: center.x, y: center.y, zoom };
}

export function drawMoon(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, time: number): void {
  const moon = moonAt(time);
  const center = worldToScreen(moon.pos, cam, w, h);
  const radius = Math.max(3, MOON.radius * cam.zoom);
  const disk = ctx.createRadialGradient(center.x - radius * 0.3, center.y - radius * 0.3, radius * 0.2, center.x, center.y, radius);
  disk.addColorStop(0, "#f3efe6");
  disk.addColorStop(0.55, "#c9c1b4");
  disk.addColorStop(1, "#8d867c");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(90, 84, 76, 0.45)";
  ctx.beginPath();
  ctx.arc(center.x + radius * 0.2, center.y + radius * 0.15, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  if (MOON.soi * cam.zoom > 8) {
    ctx.strokeStyle = "rgba(255, 214, 160, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, MOON.soi * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff6ea";
  ctx.font = "14px ui-sans-serif, sans-serif";
  ctx.fillText(MOON.name, center.x + radius + 6, center.y - 4);
}

/**
 * Arrow pieces use the measured sizes. The parent is placed beside the ship
 * by this code. Editor preview coordinates are not used, and there is no
 * altitude test because that comparison was not recovered.
 */
export function drawVelocityArrows(ctx: CanvasRenderingContext2D, pos: Vec, vel: Vec, cam: Camera, w: number, h: number): void {
  const origin = worldToScreen(pos, cam, w, h);
  const piece = (parentX: number, label: string, textX: number, textY: number): void => {
    ctx.save();
    ctx.translate(origin.x + parentX, origin.y);
    ctx.fillStyle = "#d7e4f2";
    ctx.fillRect(VELOCITY_ARROW.line.x, -VELOCITY_ARROW.line.h / 2, VELOCITY_ARROW.line.w, VELOCITY_ARROW.line.h);
    ctx.fillRect(VELOCITY_ARROW.base.x - VELOCITY_ARROW.base.w / 2, -VELOCITY_ARROW.base.h / 2, VELOCITY_ARROW.base.w, VELOCITY_ARROW.base.h);
    ctx.fillStyle = "#f4f7fb";
    ctx.beginPath();
    ctx.moveTo(-VELOCITY_ARROW.arrow.w / 2, 0);
    ctx.lineTo(VELOCITY_ARROW.arrow.w / 2, 0);
    ctx.lineTo(0, -VELOCITY_ARROW.arrow.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff6ea";
    ctx.translate(textX, -textY);
    ctx.scale(VELOCITY_ARROW.textX.scale, VELOCITY_ARROW.textX.scale);
    ctx.font = "16px ui-sans-serif, sans-serif";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  };
  piece(-70, `${Math.round(vel.x)}`, VELOCITY_ARROW.textX.x, VELOCITY_ARROW.textX.y);
  piece(70, `${Math.round(vel.y)}`, VELOCITY_ARROW.textY.x, VELOCITY_ARROW.textY.y);
}

/** A mark ahead of the ship along a chosen nose angle. */
export function drawDirectionMark(
  ctx: CanvasRenderingContext2D,
  pos: Vec,
  angle: number,
  cam: Camera,
  w: number,
  h: number,
): void {
  const dir = { x: Math.sin(angle), y: Math.cos(angle) };
  drawProgradeMark(ctx, pos, dir, cam, w, h);
}

/** A mark ahead of the ship along its velocity, so "顺向" is a thing on screen. */
export function drawProgradeMark(
  ctx: CanvasRenderingContext2D,
  pos: Vec,
  vel: Vec,
  cam: Camera,
  w: number,
  h: number,
): void {
  const sp = Math.hypot(vel.x, vel.y);
  if (sp < 40) return;
  const ux = vel.x / sp;
  const uy = vel.y / sp;
  const tip = worldToScreen({ x: pos.x + ux * 18, y: pos.y + uy * 18 }, cam, w, h);
  const tail = worldToScreen(pos, cam, w, h);
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = "#ffe08a";
  ctx.strokeStyle = "#3a2a12";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, 6.5);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, -6.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawPrediction(ctx: CanvasRenderingContext2D, approach: Approach, cam: Camera, w: number, h: number): void {
  if (approach.samples.length < 2) return;
  ctx.beginPath();
  approach.samples.forEach((p, i) => {
    const s = worldToScreen(p, cam, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.strokeStyle = "rgba(255, 214, 120, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash(PREDICTION_DASH);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!isEncounter(approach)) return;
  const mark = worldToScreen(approach.point, cam, w, h);
  ctx.fillStyle = "#ffe08a";
  ctx.font = "14px ui-sans-serif, sans-serif";
  ctx.fillText("交会", mark.x + 8, mark.y - 8);
}

export function emptyOrbitPreview(): ReturnType<typeof analyzeOrbit> {
  return analyzeOrbit({ x: 0, y: PLANET.radius + 10 }, { x: 0, y: 0 });
}
