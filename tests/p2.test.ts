import { describe, expect, it } from "vitest";
import { menuGroups } from "../src/game.ts";
import {
  HOME_BLOCKS,
  QUICKSAVE_NOTE,
  RECOVER_BUTTON,
  RIGHT_TEXT,
  SETTINGS_ITEMS,
  attitudeText,
  canopyScale,
  missionMarks,
  overPartsRail,
  recoverVisible,
} from "../src/ui/p2.ts";
import {
  EARTH_VELOCITY_ARROW_HEIGHT,
  END_MISSION_BUTTON_H,
  END_MISSION_ROW,
  THROTTLE_BAR,
  THROTTLE_HOLDER,
  THROTTLE_PERCENT,
  THROTTLE_SLIDER,
  THROTTLE_TICKS_NOTE,
  THROTTLE_TOGGLE_H,
  VELOCITY_ARROW,
  VELOCITY_ARROW_COMPARE_NOTE,
  VELOCITY_ARROW_HEIGHT_SCALED,
  VELOCITY_ARROW_PREVIEW,
} from "../src/ui/measured.ts";

describe("build drag and the parachute shape", () => {
  it("treats a drop on the parts column as a delete", () => {
    const rail = { left: 0, top: 0, right: 46, bottom: 400 };
    expect(overPartsRail(10, 80, rail)).toBe(true);
    expect(overPartsRail(80, 80, rail)).toBe(false);
  });

  it("draws a small canopy when reefed and a full one when open", () => {
    expect(canopyScale(0, false)).toBeNull();
    expect(canopyScale(1, true)).toBeLessThan(1);
    expect(canopyScale(2, true)).toBe(1);
    expect(canopyScale(0, true)).toBe(1);
  });
});

describe("recover, home, settings, and attitude", () => {
  it("shows the measured recover button only after landing", () => {
    expect(RECOVER_BUTTON).toEqual({ w: 200, h: 60, top: 15 });
    expect(recoverVisible("landed")).toBe(true);
    expect(recoverVisible("flight")).toBe(false);
    expect(QUICKSAVE_NOTE).toBe("未还原，未套用");
  });

  it("uses the four home blocks and a separate settings list", () => {
    expect(HOME_BLOCKS.map((block) => block.label)).toEqual(["继续飞", "造火箭", "任务", "说明"]);
    expect(SETTINGS_ITEMS).toEqual(["朝向", "简单", "声音", "说明"]);
    expect(menuGroups("flight").find((group) => group.label === "设置")?.items).toEqual(["设置"]);
    expect(menuGroups("flight")[0]?.items.at(-1)).toBe("取消");
  });

  it("reads attitude and the three saved mission flags", () => {
    expect(RIGHT_TEXT).toEqual({ top: 15, right: 220 });
    expect(attitudeText(0)).toBe("0°");
    expect(attitudeText(Math.PI)).toBe("-180°");
    const marks = missionMarks({ sky: true, home: false, orbit: true });
    expect(marks.map((item) => item.label)).toEqual(["飞上天空", "平安回家", "绕上青芽星"]);
    expect(marks.map((item) => item.on)).toEqual([true, false, true]);
  });
});

describe("layouts that were not recovered", () => {
  it("uses the measured throttle, end row, and arrow pieces without a show/hide guess", () => {
    expect(THROTTLE_HOLDER).toEqual({ w: 70, h: 605, x: 0, y: 0 });
    expect(THROTTLE_BAR).toEqual({ w: 38, h: 320, x: 0, y: 140 });
    expect(THROTTLE_SLIDER).toEqual({ w: 38, h: 320, x: 0, y: -160 });
    expect(THROTTLE_PERCENT).toEqual({ w: 70, h: 55, x: 0, y: 480 });
    expect(THROTTLE_TOGGLE_H).toBe(55);
    expect(THROTTLE_TICKS_NOTE).toBe("未还原，未套用");
    expect(END_MISSION_ROW).toEqual({ h: 60, bottom: 15, insetX: 15, spacing: 10 });
    expect(END_MISSION_BUTTON_H).toBe(60);
    expect(VELOCITY_ARROW.arrow).toEqual({ w: 24, h: 20 });
    expect(VELOCITY_ARROW.line).toEqual({ w: 60, h: 5, x: -20, y: 0 });
    expect(VELOCITY_ARROW_PREVIEW.x).toEqual({ x: 600, y: 600 });
    expect(VELOCITY_ARROW_COMPARE_NOTE).toBe("未还原，未套用");
    expect(EARTH_VELOCITY_ARROW_HEIGHT).toBe(5_000);
    expect(VELOCITY_ARROW_HEIGHT_SCALED).toBeCloseTo(5_000 * 0.133346, 1);
  });
});
