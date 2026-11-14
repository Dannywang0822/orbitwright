import { MOON_SCALE } from "../sim/world.ts";

/** Back + Mask. Left strip, width 100, left 10, anchoredPosition.y -78, sizeDelta.y -322. */
export const PARTS_BAR = { width: 100, left: 10, anchoredY: -78, sizeDeltaY: -322, icon: 80 };
/** Open Select Button. Not the 46×6 hamburger stroke. */
export const OPEN_SELECT = { w: 100, h: 60 };
/** The old 46×6 mark is only the hamburger stroke, not the parts column. */
export const HAMBURGER_LINE = { w: 46, h: 6 };
/** Left Menus sizeDelta.x. Not the pick-grid width. */
export const LEFT_MENUS_W = 90;

/** Throttle holder, bottom-right pivot (1,0), 70×605 at (0,0). */
export const THROTTLE_HOLDER = { w: 70, h: 605, x: 0, y: 0 };
/** Throttle bar, bottom-center pivot, (0, 140), 38×320. */
export const THROTTLE_BAR = { w: 38, h: 320, x: 0, y: 140 };
/** Slider under the bar, (0, -160), 38×320. */
export const THROTTLE_SLIDER = { w: 38, h: 320, x: 0, y: -160 };
/** Percent control, (0, 480), 70×55. */
export const THROTTLE_PERCENT = { w: 70, h: 55, x: 0, y: 480 };
/** Toggle height. Serialized width 0 is content-sized, not a design width. */
export const THROTTLE_TOGGLE_H = 55;
/** Tick positions were not in the extract. */
export const THROTTLE_TICKS_NOTE = "未还原，未套用";

/** End-mission bottom row. Button widths are laid out, not fixed coordinates. */
export const END_MISSION_ROW = { h: 60, bottom: 15, insetX: 15, spacing: 10 };
export const END_MISSION_BUTTON_H = 60;

export const VELOCITY_ARROW = {
  arrow: { w: 24, h: 20 },
  line: { w: 60, h: 5, x: -20, y: 0 },
  base: { w: 10, h: 10, x: 3, y: 0 },
  textX: { x: 0, y: 30, scale: 0.25 },
  textY: { x: 0, y: 75, scale: 0.25 },
};
/** Editor preview spots. Not runtime positions. */
export const VELOCITY_ARROW_PREVIEW = { x: { x: 600, y: 600 }, y: { x: 350, y: 850 } };

export const EARTH_VELOCITY_ARROW_HEIGHT = 5_000;
/**
 * 5000 m times the existing length ratio. A scaled trend only.
 * Whether arrows show above or below this height was not recovered.
 */
export const VELOCITY_ARROW_HEIGHT_SCALED = EARTH_VELOCITY_ARROW_HEIGHT * MOON_SCALE.length;
export const VELOCITY_ARROW_COMPARE_NOTE = "未还原，未套用";
