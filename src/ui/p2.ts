/** Recover button from World_Mobile: top center, pos (0,-15), size 200×60, hidden until landed. */
export const RECOVER_BUTTON = { w: 200, h: 60, top: 15 };

/** Right Text (Side): pivot (1,1), pos (-220,-15). Width was not in that line. */
export const RIGHT_TEXT = { top: 15, right: 220 };

/**
 * A separate quick-save button rectangle was not in the extract.
 * 未还原，未套用.
 */
export const QUICKSAVE_NOTE = "未还原，未套用";

/** Tick marks and the above/below test for velocity arrows stay unrecovered. See measured.ts. */

export function recoverVisible(phase: string): boolean {
  return phase === "landed";
}

export function overPartsRail(
  x: number,
  y: number,
  rail: { left: number; top: number; right: number; bottom: number },
): boolean {
  return x >= rail.left && x <= rail.right && y >= rail.top && y <= rail.bottom;
}

/**
 * Canopy size for deploy states 0 / 1 / 2.
 * The radii are our drawing, not an original sprite. A bare chuteOpen still counts as full.
 */
export function canopyScale(stage: number, open: boolean): number | null {
  const live = stage > 0 ? stage : open ? 2 : 0;
  if (live <= 0) return null;
  if (live === 1) return 0.45;
  return 1;
}

export function attitudeText(angle: number): string {
  const turn = (angle * 180) / Math.PI;
  const wrapped = ((turn % 360) + 540) % 360 - 180;
  return `${Math.round(wrapped)}°`;
}

export const MISSION_LABELS = ["飞上天空", "平安回家", "绕上青芽星"] as const;

export function missionMarks(flags: { sky: boolean; home: boolean; orbit: boolean }): { label: string; on: boolean }[] {
  return [
    { label: MISSION_LABELS[0], on: flags.sky },
    { label: MISSION_LABELS[1], on: flags.home },
    { label: MISSION_LABELS[2], on: flags.orbit },
  ];
}

/** The four home blocks named in the difference list. No original home-canvas rectangle was extracted. */
export const HOME_BLOCKS = [
  { id: "continue", label: "继续飞" },
  { id: "build", label: "造火箭" },
  { id: "missions", label: "任务" },
  { id: "help", label: "说明" },
] as const;

export const SETTINGS_ITEMS = ["朝向", "简单", "声音", "说明"] as const;
