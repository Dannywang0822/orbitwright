import { describe, expect, it } from "vitest";
import { createFlight, debugPlace, stepFlight } from "../src/sim/flight.ts";
import { FlightHistory } from "../src/sim/history.ts";
import { starterRocket } from "../src/sim/parts.ts";
import {
  LOAD_MENU_BUTTONS,
  defaultSave,
  findDesign,
  forgetDesign,
  parseSave,
  rememberDesign,
  renameDesign,
} from "../src/save.ts";
import { FAILURE_MENU, SELECT_ROWS, TIMEWARP_TO, nextTarget } from "../src/ui/select-menu.ts";
import { menuGroups } from "../src/game.ts";

describe("load menu", () => {
  it("keeps designs on the same save and offers a local import", () => {
    expect(LOAD_MENU_BUTTONS).toEqual(["返回", "删除", "改名", "导入", "打开", "导出", "保存当前"]);
    expect(LOAD_MENU_BUTTONS).toContain("导入");
    const old = parseSave(JSON.stringify({ v: 1, parts: [] }));
    expect(old.designs).toEqual([]);
    let data = rememberDesign(defaultSave(), "回家", starterRocket());
    const id = data.designs?.[0]?.id ?? "";
    expect(findDesign(data, id)?.name).toBe("回家");
    data = renameDesign(data, id, "远行");
    expect(findDesign(data, id)?.name).toBe("远行");
    expect(findDesign(data, id)?.parts.some((p) => p.kind === "pod")).toBe(true);
    data = forgetDesign(data, id);
    expect(findDesign(data, id)).toBeNull();
  });

  it("enters from the menu, not the build lower-left tools", () => {
    const groups = menuGroups("build");
    const items = groups.flatMap((group) => group.items);
    expect(items).toContain("图纸");
    expect(groups[0]?.items.at(-1)).toBe("取消");
    expect(items).not.toContain("降落伞");
    expect(items).not.toContain("存档");
  });
});

describe("failure menu snapshots", () => {
  it("lists revert 30s, revert to build, and resume", () => {
    expect(FAILURE_MENU.map((item) => item.label)).toEqual(["回到 30 秒前", "回到组装", "继续"]);
  });

  it("restores the snapshot from 30 seconds earlier", () => {
    const history = new FlightHistory();
    const state = createFlight(starterRocket(), true);
    debugPlace(state, 1_000, { x: 40, y: 10 });
    state.time = 0;
    history.note(state);
    for (let t = 1; t <= 40; t++) {
      state.time = t;
      state.vessel.pos.x = t;
      history.note(state);
    }
    const back = history.revert(40, 30);
    expect(back).not.toBeNull();
    expect(back!.time).toBeGreaterThanOrEqual(9);
    expect(back!.time).toBeLessThanOrEqual(10.05);
    expect(back!.vessel.pos.x).toBeCloseTo(back!.time, 5);
    const young = createFlight(starterRocket(), true);
    young.time = 4;
    const tooSoon = new FlightHistory();
    tooSoon.note(young);
    expect(tooSoon.revert(4, 30)).toBeNull();
    stepFlight(state, { throttle: 0, steer: 0, stage: false, chute: false }, 1 / 60);
  });
});

describe("select menu", () => {
  it("uses 250×60 rows and a timewarp action", () => {
    expect(SELECT_ROWS.map((row) => row.label)).toEqual(["飞向它", "聚焦", "切换", "改名", "回收"]);
    for (const row of SELECT_ROWS) {
      expect(row.w).toBe(250);
      expect(row.h).toBe(60);
    }
    expect(TIMEWARP_TO.w).toBe(300);
    expect(TIMEWARP_TO.h).toBe(60);
    expect(TIMEWARP_TO.label).toBe("加速到这里");
    expect(nextTarget("moon")).toBe("planet");
    expect(nextTarget("planet")).toBe("ship");
    expect(nextTarget("ship")).toBe("moon");
  });
});
