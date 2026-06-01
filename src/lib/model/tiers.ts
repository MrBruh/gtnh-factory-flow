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

export const GT_OVERCLOCK_TIERS = GT_VOLTAGE_TIERS.filter((entry) => Number.isFinite(entry.maxEuT));

export function getHighestFiniteVoltageTier(): Exclude<MachineTier, "DEMO"> {
  return GT_OVERCLOCK_TIERS[GT_OVERCLOCK_TIERS.length - 1]?.tier ?? "OpV";
}

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

export function getVoltageTierIndex(tier: Exclude<MachineTier, "DEMO">): number {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

export function isVoltageTierAbove(
  tier: Exclude<MachineTier, "DEMO">,
  maxTier: Exclude<MachineTier, "DEMO">,
): boolean {
  return getVoltageTierIndex(tier) > getVoltageTierIndex(maxTier);
}
