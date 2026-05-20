import type { MachineTier, Recipe } from "./types";

export const GT_VOLTAGE_TIERS: Array<{ tier: Exclude<MachineTier, "DEMO">; maxEuT: number }> = [
  { tier: "ULV", maxEuT: 8 },
  { tier: "LV", maxEuT: 32 },
  { tier: "MV", maxEuT: 128 },
  { tier: "HV", maxEuT: 512 },
  { tier: "EV", maxEuT: 2048 },
  { tier: "IV", maxEuT: 8192 },
  { tier: "LuV", maxEuT: 32768 },
  { tier: "ZPM", maxEuT: 131072 },
  { tier: "UV", maxEuT: 524288 },
  { tier: "UHV", maxEuT: 2097152 },
  { tier: "UEV", maxEuT: 8388608 },
  { tier: "UIV", maxEuT: 33554432 },
  { tier: "UXV", maxEuT: 134217728 },
  { tier: "OpV", maxEuT: 536870912 },
  { tier: "MAX", maxEuT: Number.POSITIVE_INFINITY },
];

export function getVoltageTierForEuT(euT: number): Exclude<MachineTier, "DEMO"> {
  if (!Number.isFinite(euT) || euT <= 0) {
    return "ULV";
  }

  const absEuT = Math.abs(euT);
  return GT_VOLTAGE_TIERS.find((entry) => absEuT <= entry.maxEuT)?.tier ?? "MAX";
}

export function getRecipePowerTier(recipe: Pick<Recipe, "eut">): Exclude<MachineTier, "DEMO"> {
  return getVoltageTierForEuT(recipe.eut);
}
