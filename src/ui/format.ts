export function formatAlt(m: number): string {
  if (!Number.isFinite(m)) return "—";
  const neg = m < 0;
  const a = Math.abs(m);
  const body = a < 1000 ? `${Math.round(a)} 米` : `${(a / 1000).toFixed(a < 20_000 ? 2 : 1)} 千米`;
  return neg ? `地面下 ${body}` : body;
}

export function formatVs(v: number): string {
  const a = Math.abs(v);
  const n = a < 100 ? a.toFixed(1) : a.toFixed(0);
  if (v > 1.5) return `上升 ${n}`;
  if (v < -1.5) return `下降 ${n}`;
  return `垂速 ${n}`;
}

export function formatHudAlt(m: number): string {
  if (!Number.isFinite(m)) return "—";
  const a = Math.max(0, m);
  if (a >= 1000) return `${(a / 1000).toFixed(1)}km`;
  return `${a.toFixed(1)}m`;
}

export function formatHudSpeed(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${Math.abs(v).toFixed(1)}m/s`;
}

export function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
