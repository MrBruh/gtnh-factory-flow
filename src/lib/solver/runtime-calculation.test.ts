import { describe, expect, it } from "vitest";

import { recipeSchema } from "@/lib/model/schemas";
import type { FactoryNode, Recipe, RuntimeCalculation } from "@/lib/model/types";

import {
  getRuntimeCalculationOutputs,
  selectRuntimeCalculationVariant,
} from "./runtime-calculation";

const node: Pick<
  FactoryNode,
  "machineHandlerId" | "overclockTier" | "coilTier" | "machineConfigTiers"
> = {
  overclockTier: "MV",
};

function recipeWith(runtimeCalculation: RuntimeCalculation): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 400,
    eut: 30,
    inputs: [{ kind: "item", id: "dust", amount: 1 }],
    outputs: [{ kind: "item", id: "plate", amount: 1, displayName: "Plate" }],
    runtimeCalculation,
  };
}

const baseRuntimeCalculation = {
  sourceKind: "gregtech-overclock-calculator",
  recipeMap: "Assembler",
  status: "computed",
  oracleEligible: true,
  strict: true,
} satisfies Partial<RuntimeCalculation>;

describe("compact runtime calculation encoding", () => {
  it("resolves outputs hoisted to the runtime calculation when variants share them", () => {
    const recipe = recipeWith({
      ...baseRuntimeCalculation,
      outputs: [{ kind: "item", id: "plate", amount: 3, chance: 0.5 }],
      parallel: 1,
      variants: [
        { overclockTier: "LV", durationTicks: 14, eut: 30 },
        { overclockTier: "MV", durationTicks: 7, eut: 123 },
      ],
    });

    const variant = selectRuntimeCalculationVariant(recipe, node);

    expect(variant?.durationTicks).toBe(7);
    expect(variant?.parallel).toBe(1);
    expect(getRuntimeCalculationOutputs(recipe, node)).toEqual([
      expect.objectContaining({ kind: "item", id: "plate", amount: 3, chance: 0.5 }),
    ]);
  });

  it("carries the hoisted display metadata of the recipe output through the resolved variant", () => {
    const recipe = recipeWith({
      ...baseRuntimeCalculation,
      outputs: [{ kind: "item", id: "plate", amount: 3 }],
      variants: [{ overclockTier: "MV", durationTicks: 7, eut: 123 }],
    });

    expect(getRuntimeCalculationOutputs(recipe, node)?.[0]?.displayName).toBe("Plate");
  });

  it("lets a variant that genuinely differs override the hoisted outputs, inputs and parallel", () => {
    const recipe = recipeWith({
      ...baseRuntimeCalculation,
      outputs: [{ kind: "item", id: "plate", amount: 1 }],
      inputs: [{ kind: "item", id: "dust", amount: 1 }],
      parallel: 1,
      variants: [
        { overclockTier: "LV", durationTicks: 14, eut: 30 },
        {
          overclockTier: "MV",
          durationTicks: 7,
          eut: 123,
          parallel: 4,
          inputs: [{ kind: "item", id: "dust", amount: 4 }],
          outputs: [{ kind: "item", id: "plate", amount: 8, chance: 0.75 }],
        },
      ],
    });

    const variant = selectRuntimeCalculationVariant(recipe, node);

    expect(variant?.parallel).toBe(4);
    expect(variant?.inputs).toEqual([{ kind: "item", id: "dust", amount: 4 }]);
    expect(getRuntimeCalculationOutputs(recipe, node)).toEqual([
      expect.objectContaining({ id: "plate", amount: 8, chance: 0.75 }),
    ]);

    // The non-overriding sibling still inherits the hoisted values.
    const lvVariant = selectRuntimeCalculationVariant(recipe, { overclockTier: "LV" });
    expect(lvVariant?.parallel).toBe(1);
    expect(lvVariant?.outputs).toEqual([{ kind: "item", id: "plate", amount: 1 }]);
  });

  it("validates against the recipe schema", () => {
    const parsed = recipeSchema.safeParse(
      recipeWith({
        ...baseRuntimeCalculation,
        outputs: [{ kind: "item", id: "plate", amount: 3 }],
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        parallel: 1,
        variants: [
          { overclockTier: "LV", durationTicks: 14, eut: 30 },
          { overclockTier: "MV", durationTicks: 7, eut: 123, parallel: 4 },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.runtimeCalculation?.outputs).toEqual([
      { kind: "item", id: "plate", amount: 3 },
    ]);
    expect(parsed.data?.runtimeCalculation?.variants[0]?.id).toBeUndefined();
  });

  it("does not let a hoisted value leak into a variant that declares an empty override", () => {
    const recipe = recipeWith({
      ...baseRuntimeCalculation,
      outputs: [{ kind: "item", id: "plate", amount: 1 }],
      variants: [{ overclockTier: "MV", durationTicks: 7, eut: 123, outputs: [] }],
    });

    expect(selectRuntimeCalculationVariant(recipe, node)?.outputs).toEqual([]);
    expect(getRuntimeCalculationOutputs(recipe, node)).toBeUndefined();
  });
});

describe("legacy verbose runtime calculation encoding", () => {
  // A plan saved before the compact encoding repeats outputs/inputs/parallel on every variant and
  // carries id/label/notes. It must keep validating and resolving to exactly the same numbers.
  const legacyRuntimeCalculation = {
    ...baseRuntimeCalculation,
    sourceClass: "gregtech.api.util.OverclockCalculator",
    generatedAt: "2025-01-01T00:00:00.000Z",
    variants: [
      {
        id: "tier-lv",
        label: "LV",
        notes: "GTNH runtime profile: perfect-oc.",
        overclockTier: "LV",
        durationTicks: 14,
        eut: 30,
        parallel: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 3 }],
      },
      {
        id: "tier-mv",
        label: "MV",
        notes: "GTNH runtime profile: perfect-oc.",
        overclockTier: "MV",
        durationTicks: 7,
        eut: 123,
        parallel: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 3, chance: 0.5 }],
      },
    ],
  } satisfies RuntimeCalculation;

  it("still validates against the recipe schema", () => {
    const parsed = recipeSchema.safeParse(recipeWith(legacyRuntimeCalculation));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.runtimeCalculation?.variants[0]?.id).toBe("tier-lv");
    expect(parsed.data?.runtimeCalculation?.outputs).toBeUndefined();
  });

  it("still resolves per-variant outputs when no hoisted field exists", () => {
    const recipe = recipeWith(legacyRuntimeCalculation);
    const variant = selectRuntimeCalculationVariant(recipe, node);

    expect(variant?.durationTicks).toBe(7);
    expect(variant?.parallel).toBe(1);
    expect(variant?.inputs).toEqual([{ kind: "item", id: "dust", amount: 1 }]);
    expect(getRuntimeCalculationOutputs(recipe, node)).toEqual([
      expect.objectContaining({ id: "plate", amount: 3, chance: 0.5 }),
    ]);
  });

  it("leaves a variant with no parallel undefined so the machine config multiplier still applies", () => {
    const recipe = recipeWith({
      ...baseRuntimeCalculation,
      variants: [
        {
          overclockTier: "MV",
          durationTicks: 7,
          eut: 123,
          outputs: [{ kind: "item", id: "plate", amount: 3 }],
        },
      ],
    });

    expect(selectRuntimeCalculationVariant(recipe, node)?.parallel).toBeUndefined();
  });
});
