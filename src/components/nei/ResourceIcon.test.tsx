// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceIcon } from "./ResourceIcon";

describe("ResourceIcon", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("hides generated bee species internals from tooltips", async () => {
    render(
      <ResourceIcon
        resource={{
          kind: "item",
          id: "factoryflow:bee_species:gregtech-explosive",
          amount: 1,
          displayName: "Explosive Bee",
          iconPath: "/textures/rendered/explosive_bee.png",
          tooltip: [
            "Bee species",
            "gregtech.bee.speciesExplosive",
            "gregtech.common.bees.GTAlleleBeeSpecies",
          ],
          consumed: false,
        }}
      />,
    );

    fireEvent.mouseMove(screen.getByAltText("Explosive Bee").parentElement as HTMLElement, {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Explosive Bee")).toBeTruthy();
    expect(screen.queryByText("Bee species")).toBeNull();
    expect(screen.queryByText("gregtech.bee.speciesExplosive")).toBeNull();
    expect(screen.queryByText("gregtech.common.bees.GTAlleleBeeSpecies")).toBeNull();
    expect(screen.queryByText("Not consumed")).toBeNull();
  });
});
