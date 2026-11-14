import type { PartKind } from "../sim/parts.ts";
import podUrl from "../assets/parts/command_capsule.png";
import tankSUrl from "../assets/parts/fuel_tank_s.png";
import tankMUrl from "../assets/parts/fuel_tank_m.png";
import tankLUrl from "../assets/parts/fuel_tank_l.png";
import engineSUrl from "../assets/parts/vacuum_engine.png";
import engineLUrl from "../assets/parts/main_engine.png";
import boosterUrl from "../assets/parts/solid_booster.png";
import legsUrl from "../assets/parts/landing_leg.png";
import flame1 from "../assets/fx/flame1.png";
import flame2 from "../assets/fx/flame2.png";
import flame3 from "../assets/fx/flame3.png";
import flame4 from "../assets/fx/flame4.png";
import spark1 from "../assets/fx/spark1.png";
import spark2 from "../assets/fx/spark2.png";
import spark3 from "../assets/fx/spark3.png";
import spark4 from "../assets/fx/spark4.png";
import iconIgnition from "../assets/icons/ignition.png";
import iconStaging from "../assets/icons/staging.png";
import iconMap from "../assets/icons/map.png";
import iconPause from "../assets/icons/pause.png";
import iconFuel from "../assets/icons/fuel.png";
import iconThrottle from "../assets/icons/throttle.png";
import iconPitch from "../assets/icons/pitch.png";
import iconWarp from "../assets/icons/timewarp.png";
import iconWarn from "../assets/icons/warning.png";

export const partUrl: Partial<Record<PartKind, string>> = {
  pod: podUrl,
  tank_s: tankSUrl,
  tank_m: tankMUrl,
  tank_l: tankLUrl,
  engine_s: engineSUrl,
  engine_l: engineLUrl,
  booster: boosterUrl,
  legs: legsUrl,
};

export const iconUrl = {
  ignition: iconIgnition,
  staging: iconStaging,
  map: iconMap,
  pause: iconPause,
  fuel: iconFuel,
  throttle: iconThrottle,
  pitch: iconPitch,
  warp: iconWarp,
  warn: iconWarn,
};

export interface Art {
  parts: Partial<Record<PartKind, HTMLImageElement>>;
  flames: HTMLImageElement[];
  sparks: HTMLImageElement[];
  icons: Record<keyof typeof iconUrl, HTMLImageElement | null>;
}

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadArt(): Promise<Art> {
  const kinds = Object.keys(partUrl) as PartKind[];
  const partImgs = await Promise.all(kinds.map(async (k) => [k, await load(partUrl[k]!)] as const));
  const flames = (await Promise.all([flame1, flame2, flame3, flame4].map(load))).filter((x): x is HTMLImageElement => !!x);
  const sparks = (await Promise.all([spark1, spark2, spark3, spark4].map(load))).filter((x): x is HTMLImageElement => !!x);
  const iconEntries = await Promise.all(
    (Object.keys(iconUrl) as (keyof typeof iconUrl)[]).map(async (k) => [k, await load(iconUrl[k])] as const),
  );
  return {
    parts: Object.fromEntries(partImgs.filter(([, img]) => img)) as Art["parts"],
    flames,
    sparks,
    icons: Object.fromEntries(iconEntries) as Art["icons"],
  };
}
