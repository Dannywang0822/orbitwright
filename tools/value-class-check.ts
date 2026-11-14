import { readFileSync } from "node:fs";
import { estimateLabelErrors } from "../src/pack/value-class.ts";

const estimates = readFileSync(new URL("../src/sim/estimates.ts", import.meta.url), "utf8");
const parts = readFileSync(new URL("../src/sim/parts.ts", import.meta.url), "utf8");
const errors = estimateLabelErrors(estimates, parts);
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log("数值分类检查通过");
