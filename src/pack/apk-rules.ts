/** Pinned to the 1.7.0 debug certificate copied into android/debug.keystore. */
export const PINNED_CERT_SHA256 = "1f4641b88a0f9016cd33c9b07a5d84f3cac34a990d5ecf2ab7d8fb2e51af4050";
export const EXPECTED_APP_ID = "studio.qingya.gongfang";
export const INTERNET_PERMISSION = "android.permission.INTERNET";

export function normalizeCertSha256(value: string): string {
  return value.replace(/[:\s]/g, "").toLowerCase();
}

/** Only real uses-permission declarations count. A bare string in the AXML pool does not. */
export function declaredPermissions(dump: string): string[] {
  return dump
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^uses-permission:\s+name='([^']+)'/);
      return match?.[1] ?? "";
    })
    .filter((name) => name.length > 0);
}

export function inspectApkFacts(
  facts: { packageName?: string; declaredPermissions?: string[]; certSha256?: string },
  pinned = PINNED_CERT_SHA256,
): string[] {
  const errors: string[] = [];
  if (facts.packageName !== EXPECTED_APP_ID) {
    errors.push(`包名是 ${facts.packageName || "空"}，应为 ${EXPECTED_APP_ID}`);
  }
  const declared = facts.declaredPermissions ?? [];
  if (declared.includes(INTERNET_PERMISSION)) {
    errors.push("清单声明了 android.permission.INTERNET");
  }
  const cert = normalizeCertSha256(facts.certSha256 || "");
  const want = normalizeCertSha256(pinned);
  if (cert !== want) {
    errors.push(`签名证书 SHA-256 是 ${cert || "空"}，应为 ${want}`);
  }
  return errors;
}
