import { describe, expect, it } from "vitest";
import { getVoltageTierForEuT } from "./tiers";

describe("GT voltage tiers", () => {
  it("selects the first tier that can cover a recipe EU/t", () => {
    expect(getVoltageTierForEuT(0)).toBe("ULV");
    expect(getVoltageTierForEuT(8)).toBe("ULV");
    expect(getVoltageTierForEuT(16)).toBe("LV");
    expect(getVoltageTierForEuT(32)).toBe("LV");
    expect(getVoltageTierForEuT(33)).toBe("MV");
    expect(getVoltageTierForEuT(512)).toBe("HV");
    expect(getVoltageTierForEuT(2048)).toBe("EV");
    expect(getVoltageTierForEuT(8192)).toBe("IV");
  });
});
