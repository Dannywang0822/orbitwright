import { describe, expect, it } from "vitest";
import { INTERNET_PERMISSION, PINNED_CERT_SHA256, declaredPermissions, inspectApkFacts } from "../src/pack/apk-rules.ts";

const good = {
  packageName: "studio.qingya.gongfang",
  declaredPermissions: ["studio.qingya.gongfang.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"],
  certSha256: PINNED_CERT_SHA256,
};

describe("apk inspect rules", () => {
  it("accepts the pinned package without an internet permission", () => {
    expect(inspectApkFacts(good)).toEqual([]);
  });

  it("stops on the wrong certificate", () => {
    const errors = inspectApkFacts({ ...good, certSha256: "ab".repeat(32) });
    expect(errors.join("\n")).toContain("签名证书");
  });

  it("stops only when INTERNET is a declared permission", () => {
    const declared = declaredPermissions([
      "package: studio.qingya.gongfang",
      "uses-permission: name='android.permission.INTERNET'",
    ].join("\n"));
    expect(declared).toContain(INTERNET_PERMISSION);
    expect(inspectApkFacts({ ...good, declaredPermissions: declared }).join("\n")).toContain("INTERNET");

    const poolOnly = declaredPermissions("binary mentions android.permission.INTERNET inside the pool\n");
    expect(poolOnly).toEqual([]);
    expect(inspectApkFacts({ ...good, declaredPermissions: poolOnly })).toEqual([]);
  });
});
