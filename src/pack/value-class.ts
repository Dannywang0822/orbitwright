export function estimateLabelErrors(estimatesSource: string, partsSource: string): string[] {
  const errors: string[] = [];
  if (!estimatesSource.includes('export const VALUE_CLASS = "unverified-estimate"')) {
    errors.push("估计表没有标成 unverified-estimate");
  }
  if (estimatesSource.includes("confirmed-extracted")) {
    errors.push("估计值被标成了已提取");
  }
  if (partsSource.includes('from "./confirmed.ts"') || partsSource.includes("boosterMassTonnes")) {
    errors.push("飞行零件引用了未批准的提取表");
  }
  if (!partsSource.includes('from "./estimates.ts"')) {
    errors.push("飞行零件没有从估计表取值");
  }
  return errors;
}
