// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { NeiRecipeWindow } from "./NeiRecipeWindow";

describe("NeiRecipeWindow", () => {
  it("renders Thaumcraft native layouts without GT stats and with aspect icons", () => {
    render(
      <NeiRecipeWindow
        recipe={{
          id: "thaumcraft-infusion",
          name: "Thaumcraft Infusion",
          machineType: "Thaumcraft Infusion",
          minimumTier: "NONE",
          durationTicks: 90,
          eut: 0,
          inputs: [
            { kind: "item", id: "central", amount: 1, neiSlot: { x: 75, y: 58 } },
            {
              kind: "aspect",
              id: "thaumcraft:aspect:ordo",
              amount: 8,
              displayName: "Ordo",
              neiSlot: { x: 75, y: 114 },
            },
          ],
          outputs: [{ kind: "item", id: "result", amount: 1, neiSlot: { x: 75, y: 1 } }],
          source: { recipeMap: "Thaumcraft Infusion" },
          nei: {
            slots: [
              { side: "input", kind: "item", slotIndex: 0, x: 75, y: 58 },
              { side: "input", kind: "aspect", slotIndex: 0, x: 75, y: 114 },
              { side: "output", kind: "item", slotIndex: 0, x: 75, y: 1 },
            ],
            progressBars: [],
          },
        }}
        compact
      />,
    );

    expect(screen.queryByText(/Total:/)).toBeNull();
    expect(screen.getByAltText("Ordo").getAttribute("src")).toBe(
      "/nei/thaumcraft/aspects/ordo.png",
    );
  });
});
